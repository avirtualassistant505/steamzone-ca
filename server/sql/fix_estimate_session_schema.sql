-- One-time compatibility patch for existing Supabase projects.
-- Run this if diagnostics reports missing columns or missing training/model tables.

create table if not exists public.estimate_sessions (
  session_id text primary key,
  answers jsonb not null default '{}'::jsonb,
  asked_keys jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  last_question_key text,
  mode text not null default 'support',
  processed_turn_ids jsonb not null default '[]'::jsonb,
  finalized_record_id text,
  finalized_quote_hash text,
  finalized_at timestamptz,
  review_notes text,
  review_status text not null default 'unprocessed',
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.estimate_sessions
  add column if not exists review_notes text;

alter table public.estimate_sessions
  add column if not exists review_status text not null default 'unprocessed';

alter table public.estimate_sessions
  add column if not exists version bigint not null default 0;

alter table public.estimate_sessions
  add column if not exists mode text not null default 'support';

alter table public.estimate_sessions
  add column if not exists processed_turn_ids jsonb not null default '[]'::jsonb;

alter table public.estimate_sessions
  add column if not exists finalized_record_id text;

alter table public.estimate_sessions
  add column if not exists finalized_quote_hash text;

alter table public.estimate_sessions
  add column if not exists finalized_at timestamptz;

create index if not exists estimate_sessions_updated_at_idx on public.estimate_sessions (updated_at desc);

create table if not exists public.training_data (
  id text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists training_data_updated_at_idx on public.training_data (updated_at desc);

create table if not exists public.agent_model_settings (
  id text primary key,
  model text not null,
  voice_model text,
  prompt_text text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_model_settings_updated_at_idx on public.agent_model_settings (updated_at desc);

