-- Squad Phase 0 (2/4): matching-engine tables, students.interest_tags, deny-all RLS.
-- Spec §9. RLS = enabled with ZERO policies → anon/authenticated denied, service-role bypasses.
-- These tables hold the interest graph (CEO D7 privacy); only API routes may expose scoped reads.

alter table public.students
  add column if not exists interest_tags text[] not null default '{}';
create index if not exists students_interest_tags_gin on public.students using gin (interest_tags);

create table if not exists public.user_interest_vectors (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  label text not null,
  vector vector(1536) not null,
  source text not null default 'profile',
  updated_at timestamptz not null default now(),
  unique (student_id, label)
);
create index if not exists uiv_student_idx on public.user_interest_vectors (student_id);
create index if not exists uiv_vector_idx on public.user_interest_vectors
  using ivfflat (vector vector_cosine_ops) with (lists = 10);

create table if not exists public.user_match_prefs (
  student_id uuid primary key references public.students(id) on delete cascade,
  pings_enabled boolean not null default false,           -- CEO D5: pure opt-in
  allowed_categories text[],                              -- null = all (when enabled)
  weekly_ping_cap int not null default 3,
  quiet_start_hour smallint not null default 23,          -- LA-local, Phase 2 enforces
  quiet_end_hour smallint not null default 9,
  channel text not null default 'imessage',
  updated_at timestamptz not null default now()
);

create table if not exists public.squad_pings (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.squad_posts(id) on delete cascade,
  recipient_student_id uuid not null references public.students(id) on delete cascade,
  score double precision not null,
  channel text not null default 'imessage',
  status text not null check (status in
    ('sent','suppressed_no_channel','suppressed_cap','suppressed_quiet_hours','suppressed_muted')),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  response text check (response in ('joined','declined')),
  unique (post_id, recipient_student_id)
);
create index if not exists squad_pings_recipient_idx
  on public.squad_pings (recipient_student_id, created_at desc);

-- Deny-all (eng E6-RLS): enable RLS, define NO policies.
alter table public.user_interest_vectors enable row level security;
alter table public.user_match_prefs enable row level security;
alter table public.squad_pings enable row level security;
