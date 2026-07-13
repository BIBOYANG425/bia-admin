-- Agent message-observability schema (obs_messages / obs_contacts + read RPCs).
--
-- Source: the imessage-agent-observability boilerplate
-- (github.com/patrick201936395/imessage-agent-observability-boilerplate,
-- packages/core/schema.sql). Recorded here because bia-admin owns the Supabase
-- schema; george (the consumer) ships no migrations. ALREADY APPLIED to the live
-- project (ujkaregrwrppaehvbahf) via the Supabase MCP on 2026-07-13 — this file
-- is the provenance record. Idempotent (IF NOT EXISTS / CREATE OR REPLACE), so
-- re-applying is a no-op.
--
-- Design: append-only messages, idempotent external_id, RLS-sealed (service-role
-- only). `platform` = network (imessage); `channel` = sub-transport (iMessage /
-- SMS / RCS), registry-driven in the dashboard so adding one needs no migration.
-- `agent_id` partitions rows so one dashboard can watch multiple agents.

create table if not exists obs_messages (
  id              bigserial primary key,
  external_id     text,
  agent_id        text not null default 'default',
  conversation_id text not null,
  direction       text not null check (direction in ('inbound','outbound')),
  platform        text not null,
  channel         text not null default 'unknown',
  content_type    text not null default 'text',
  text            text,
  media_url       text,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);

create index if not exists obs_messages_created      on obs_messages (created_at desc);
create index if not exists obs_messages_conv_created on obs_messages (agent_id, conversation_id, created_at desc);
create index if not exists obs_messages_chan_created on obs_messages (channel, created_at);
create unique index if not exists obs_messages_external on obs_messages (external_id) where external_id is not null;

create table if not exists obs_contacts (
  agent_id        text not null default 'default',
  handle          text not null,
  display_name    text,
  platform        text,
  channel         text,
  opted_out       timestamptz,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz,
  last_message_at timestamptz,
  metadata        jsonb not null default '{}',
  primary key (agent_id, handle)
);

create index if not exists obs_contacts_last_msg on obs_contacts (agent_id, last_message_at desc nulls last);

-- RLS deny-all + revoke Data API grants: matches this project's internal-table
-- pattern (service-role bypasses RLS and keeps full access; anon/authenticated
-- get neither rows nor privilege).
alter table obs_messages enable row level security;
alter table obs_contacts enable row level security;
revoke all on table public.obs_messages from anon, authenticated;
revoke all on table public.obs_contacts from anon, authenticated;
grant select, insert, update, delete on table public.obs_messages to service_role;
grant select, insert, update, delete on table public.obs_contacts to service_role;
grant usage, select on sequence public.obs_messages_id_seq to service_role;

create or replace function obs_message_stats(since timestamptz, agent text default 'default')
returns table (channel text, inbound bigint, outbound bigint, total bigint, conversations bigint)
language sql stable as $$
  select
    m.channel,
    count(*) filter (where m.direction = 'inbound')::bigint,
    count(*) filter (where m.direction = 'outbound')::bigint,
    count(*)::bigint,
    count(distinct m.conversation_id)::bigint
  from obs_messages m
  where m.created_at >= since and m.agent_id = agent
  group by m.channel
  order by count(*) desc;
$$;

create or replace function obs_conversation_count(since timestamptz, agent text default 'default')
returns bigint
language sql stable as $$
  select count(distinct conversation_id)::bigint
  from obs_messages
  where created_at >= since and agent_id = agent;
$$;

create or replace function obs_message_series(since timestamptz, bucket text, agent text default 'default')
returns table (ts timestamptz, inbound bigint, outbound bigint, total bigint)
language sql stable as $$
  select
    date_trunc(bucket, created_at) as ts,
    count(*) filter (where direction = 'inbound')::bigint,
    count(*) filter (where direction = 'outbound')::bigint,
    count(*)::bigint
  from obs_messages
  where created_at >= since and agent_id = agent
  group by 1
  order by 1;
$$;

create or replace function obs_conversations(search text default null, lim int default 200, agent text default 'default')
returns table (
  conversation_id text,
  display_name    text,
  channel         text,
  last_text       text,
  last_direction  text,
  last_at         timestamptz,
  opted_out       timestamptz
)
language sql stable as $$
  select
    c.handle,
    c.display_name,
    coalesce(c.channel, lm.channel),
    lm.text,
    lm.direction,
    c.last_message_at,
    c.opted_out
  from obs_contacts c
  left join lateral (
    select m.text, m.direction, m.channel
    from obs_messages m
    where m.agent_id = c.agent_id and m.conversation_id = c.handle
    order by m.created_at desc
    limit 1
  ) lm on true
  where c.agent_id = agent
    and c.last_message_at is not null
    and (
      search is null
      or c.handle       ilike '%' || search || '%'
      or c.display_name ilike '%' || search || '%'
    )
  order by c.last_message_at desc
  limit greatest(1, least(lim, 500));
$$;
