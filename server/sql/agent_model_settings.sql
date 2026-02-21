-- Model selection for /api/estimate-agent chat + postagent
create table if not exists public.agent_model_settings (
  id text primary key,
  model text not null,
  prompt_text text,
  updated_at timestamptz not null default now()
);

create index if not exists agent_model_settings_updated_at_idx on public.agent_model_settings (updated_at desc);
