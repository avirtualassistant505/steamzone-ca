-- Session store for /api/estimate-agent/chat
create table if not exists public.estimate_sessions (
  session_id text primary key,
  answers jsonb not null default '{}'::jsonb,
  asked_keys jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  last_question_key text,
  review_notes text,
  review_status text not null default 'unprocessed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_sessions_updated_at_idx on public.estimate_sessions (updated_at desc);
