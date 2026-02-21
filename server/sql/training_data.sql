-- Training data for Steam Zone FAQ/agent answers.
create table if not exists public.training_data (
  id text primary key,
  items jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists training_data_updated_at_idx on public.training_data (updated_at desc);
