-- Krayam — member profile fields + governance audit coverage.
--
-- team_members gains the personal profile fields shown on the
-- Settings → My Profile page. Role/team/organization changes are written
-- to the existing audit_log (0005) by the API routes with the acting
-- user's identity — RLS gives authenticated clients read-only access to
-- team_members, so every write necessarily passes through an audited route.

alter table team_members add column if not exists phone       text;
alter table team_members add column if not exists department  text;
alter table team_members add column if not exists updated_at  timestamptz not null default now();

-- Fast lookup of governance history (role changes, invites, removals,
-- org profile edits) for the team activity log.
create index if not exists audit_log_governance
  on audit_log (created_at desc)
  where entity_type in ('team_member', 'company_settings');
