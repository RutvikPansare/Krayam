-- Krayam — Feature 11 hardening: spec-sheet attachments.
-- Soft-delete (file kept in storage for audit), richer metadata, and the
-- org/PR-prefixed storage path is enforced in application code at upload time.

alter table pr_attachments add column if not exists deleted_at        timestamptz;  -- soft delete
alter table pr_attachments add column if not exists uploaded_by       text;
alter table pr_attachments add column if not exists checksum_verified  boolean not null default false; -- server-side magic-byte check passed

-- size_bytes is int (max ~2GB) — fine for a 10MB cap, leave as-is.

-- The bucket is already private (0003). Confirm idempotently.
update storage.buckets set public = false where id = 'attachments';

-- Active (non-deleted) attachments are the common read; index for it.
create index if not exists pr_attachments_pr_active_idx
  on pr_attachments (pr_id) where deleted_at is null;
