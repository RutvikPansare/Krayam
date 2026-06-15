-- Conversational procurement assistant: conversation history.

create table if not exists assistant_conversations (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'active' check (status in ('active','completed')),
  pr_id       uuid references purchase_requests(id) on delete set null,  -- set when the chat produces a PR
  created_at  timestamptz not null default now()
);

create table if not exists assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         jsonb not null,   -- full provider-agnostic ChatMessage (text + tool calls/results)
  created_at      timestamptz not null default now()
);

create index if not exists assistant_messages_conv on assistant_messages (conversation_id, created_at);

alter table assistant_conversations enable row level security;
alter table assistant_messages      enable row level security;
create policy "auth read assistant convs" on assistant_conversations for select to authenticated using (true);
create policy "auth read assistant msgs"  on assistant_messages      for select to authenticated using (true);
