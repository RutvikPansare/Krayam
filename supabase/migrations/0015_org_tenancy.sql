-- Krayam — shared-DB multi-tenancy. "customer" IS the organization.
--
-- Converts the single-tenant schema to org-scoped SaaS: every domain table
-- gains org_id, teams belong to an org, and RLS limits each authenticated
-- user to rows in the org(s) they are a member of. Service-role routes
-- (public PR search, vendor quote links, cron) bypass RLS and MUST filter by
-- the resolved org_id in code — RLS here is the second layer.
--
-- Existing data all belongs to one implicit tenant, so everything backfills to
-- the 'default' organization created in 0013 (renamed from customers below).

-- ── 1. customers → organizations (the tenant root) ───────────────
alter table customers rename to organizations;
alter table organizations add column if not exists plan        text not null default 'standard';
alter table organizations add column if not exists plan_status text not null default 'active';

-- ── 1b. Default-org helper, used as a column DEFAULT so existing insert
--    paths that don't yet pass org_id keep working (rows land in the default
--    org) while NOT NULL still holds. Pages adopt explicit org context
--    incrementally; nothing breaks on day one. ──────────────────────
create or replace function krayam_default_org()
returns uuid
language sql
stable
as $$
  select id from organizations where slug = coalesce(current_setting('app.org_slug', true), 'default') limit 1;
$$;

-- ── 2. Membership helper — the org(s) the current user belongs to.
--    SECURITY DEFINER so it bypasses RLS on team_members and cannot recurse
--    when used inside team_members' own policy. ────────────────────
create or replace function auth_org_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select org_id from team_members where user_id = auth.uid();
$$;

-- ── 3. materials: customer_id → org_id, recreate index/RPC/policy ─
alter table materials rename column customer_id to org_id;
alter table materials alter column org_id set default krayam_default_org();
alter index if exists materials_customer_code_uniq rename to materials_org_code_uniq;
alter index if exists materials_customer_idx       rename to materials_org_idx;
alter table material_sync_state rename column customer_id to org_id;

-- Cosine match RPC — now org-scoped, and takes the embedding as TEXT cast to
-- vector inside (robust: avoids relying on PostgREST coercing a JSON value to
-- the vector type at the call boundary). Threshold default 0.82, top 3.
drop function if exists match_materials(uuid, vector, float, int);
create or replace function match_materials(
  p_org            uuid,
  query_embedding  text,
  match_threshold  float default 0.82,
  match_count      int default 3
)
returns table (
  material_code text, description text, unit text,
  unit_price numeric, stock jsonb, score real
)
language sql stable as $$
  with q as (select (query_embedding)::vector(1536) as e)
  select m.material_code, m.description, m.unit, m.unit_price, m.stock,
         (1 - (m.embedding <=> q.e))::real as score
  from materials m, q
  where m.org_id = p_org
    and m.embedding is not null
    and (1 - (m.embedding <=> q.e)) >= match_threshold
  order by m.embedding <=> q.e
  limit match_count;
$$;

drop function if exists search_materials(uuid, text, int);
create or replace function search_materials(p_org uuid, q text, max_results int default 3)
returns table (
  material_code text, description text, unit text,
  unit_price numeric, stock jsonb, score real
)
language sql stable as $$
  select m.material_code, m.description, m.unit, m.unit_price, m.stock,
         greatest(similarity(m.description, q), word_similarity(q, m.description)) as score
  from materials m
  where m.org_id = p_org
    and (m.description % q
      or word_similarity(q, m.description) > 0.25
      or m.description ilike '%' || q || '%'
      or m.material_code ilike '%' || q || '%')
  order by score desc
  limit max_results;
$$;

drop policy if exists "tenant read materials" on materials;
create policy "materials_org" on materials for all to authenticated
  using (org_id in (select auth_org_ids()))
  with check (org_id in (select auth_org_ids()));

-- ── 4. Add org_id to every other tenant table, backfill, lock down ─
do $$
declare
  t text;
  default_org uuid;
  tenant_tables text[] := array[
    'purchase_requests','pr_items','vendors','rfqs','rfq_vendors','rfq_log',
    'quotes','quote_items','purchase_orders','po_items','invoices','invoice_items',
    'grns','grn_items','pr_attachments','approval_rules','cost_centers','budgets',
    'audit_log','assistant_conversations','assistant_messages','notifications'
  ];
begin
  select id into default_org from organizations where slug = 'default';

  foreach t in array tenant_tables loop
    execute format('alter table %I add column if not exists org_id uuid references organizations(id) on delete cascade', t);
    execute format('update %I set org_id = %L where org_id is null', t, default_org);
    execute format('alter table %I alter column org_id set default krayam_default_org()', t);
    execute format('alter table %I alter column org_id set not null', t);
    execute format('create index if not exists %I on %I (org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- ── 5. RLS: generic per-org policy. Replaces the old broad "auth read"
--    policies for tables whose every row belongs to exactly one org and
--    where any org member may access it. (notifications/team_members/
--    company_settings have bespoke policies below and are excluded.) ──
do $$
declare
  t text;
  pol record;
  generic_tables text[] := array[
    'purchase_requests','pr_items','vendors','rfqs','rfq_vendors','rfq_log',
    'quotes','quote_items','purchase_orders','po_items','invoices','invoice_items',
    'grns','grn_items','pr_attachments','approval_rules','cost_centers','budgets',
    'audit_log','assistant_conversations','assistant_messages'
  ];
begin
  foreach t in array generic_tables loop
    for pol in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on %I', pol.policyname, t);
    end loop;
    execute format(
      'create policy %I on %I for all to authenticated using (org_id in (select auth_org_ids())) with check (org_id in (select auth_org_ids()))',
      t || '_org', t
    );
  end loop;
end $$;

-- ── 6. Per-org document numbers — unique within an org, not globally ─
alter table purchase_requests drop constraint if exists purchase_requests_pr_number_key;
create unique index if not exists pr_number_org_uniq  on purchase_requests (org_id, pr_number);
alter table rfqs              drop constraint if exists rfqs_rfq_number_key;
create unique index if not exists rfq_number_org_uniq on rfqs (org_id, rfq_number);
alter table purchase_orders   drop constraint if exists purchase_orders_po_number_key;
create unique index if not exists po_number_org_uniq  on purchase_orders (org_id, po_number);

-- ── 7. team_members belong to an org ─────────────────────────────
alter table team_members add column if not exists org_id uuid references organizations(id) on delete cascade;
update team_members set org_id = (select id from organizations where slug = 'default') where org_id is null;
alter table team_members alter column org_id set default krayam_default_org();
alter table team_members alter column org_id set not null;
-- email is unique per org, not globally (same person can exist in two orgs).
alter table team_members drop constraint if exists team_members_email_key;
create unique index if not exists team_members_org_email_uniq on team_members (org_id, email);
create index if not exists team_members_org_idx on team_members (org_id);

drop policy if exists "auth read team" on team_members;
-- A member can read the roster of their own org(s).
create policy "team_members_org" on team_members for select to authenticated
  using (org_id in (select auth_org_ids()));

-- ── 8. company_settings: one row PER ORG (was a single id=1 row) ──
alter table company_settings add column if not exists org_id uuid references organizations(id) on delete cascade;
update company_settings set org_id = (select id from organizations where slug = 'default') where org_id is null;
alter table company_settings alter column org_id set default krayam_default_org();
alter table company_settings alter column org_id set not null;
-- Drop the single-row guard and let id auto-generate for new orgs.
alter table company_settings drop constraint if exists company_settings_id_check;
alter table company_settings alter column id drop default;
do $$ begin
  alter table company_settings alter column id add generated by default as identity;
exception when others then null; -- already identity on re-run
end $$;
-- Advance the new identity sequence past existing ids so the next org's
-- settings row doesn't collide with the legacy id=1 row.
select setval(
  pg_get_serial_sequence('company_settings', 'id'),
  greatest((select coalesce(max(id), 1) from company_settings), 1)
);
create unique index if not exists company_settings_org_uniq on company_settings (org_id);

drop policy if exists "auth read company" on company_settings;
create policy "company_settings_org" on company_settings for select to authenticated
  using (org_id in (select auth_org_ids()));

-- ── 9. notifications: keep OWN-USER visibility, add org scope column.
--    (A user must not see teammates' notifications, so this is not the
--    generic org-wide policy.) ─────────────────────────────────────
drop policy if exists "own notifications read"   on notifications;
drop policy if exists "own notifications update" on notifications;
create policy "own notifications read" on notifications for select to authenticated
  using (user_id = auth.uid() and org_id in (select auth_org_ids()));
create policy "own notifications update" on notifications for update to authenticated
  using (user_id = auth.uid() and org_id in (select auth_org_ids()));
