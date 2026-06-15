-- Approval routing + audit trail.
--
-- approval_rules: maps cost center + estimated PR value to the approver.
-- NULL cost_center = wildcard (any). Highest matching min_amount wins, so
-- a ₹50,000 PR in CC-1010 picks the plant head rule over the supervisor rule.
--
-- audit_log: append-only record of who did what, when. The approval flow
-- replaces phone calls precisely because those leave no trail; this table
-- is the trail.

create table if not exists approval_rules (
  id              uuid primary key default gen_random_uuid(),
  cost_center     text,                       -- null = applies to all cost centers
  min_amount      numeric not null default 0, -- rule applies when estimate >= this, INR
  approver_email  text not null,
  approver_name   text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table approval_rules enable row level security;
create policy "auth read approval rules" on approval_rules for select to authenticated using (true);

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null,        -- 'purchase_request', 'purchase_order', …
  entity_id   uuid not null,
  action      text not null,        -- 'submitted', 'approved', 'rejected', …
  actor       text,                 -- email or name of who acted
  detail      jsonb,                -- action-specific context (note, sap number, …)
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_entity on audit_log (entity_type, entity_id, created_at);

alter table audit_log enable row level security;
create policy "auth read audit log" on audit_log for select to authenticated using (true);

-- Estimated PR value (from material master prices) — drives approval routing
-- and is recorded so the audit shows what number the routing decision used.
alter table purchase_requests add column if not exists estimated_value numeric;

-- Sample rules: supervisor for small purchases, plant head above 25k,
-- works manager above 2L regardless of cost center.
insert into approval_rules (cost_center, min_amount, approver_email, approver_name) values
  (null,      0,      'supervisor@example.com',    'Shift Supervisor'),
  (null,      25000,  'planthead@example.com',     'Plant Head'),
  (null,      200000, 'worksmanager@example.com',  'Works Manager')
on conflict do nothing;
