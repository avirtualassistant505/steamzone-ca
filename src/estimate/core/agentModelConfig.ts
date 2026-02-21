export type AgentModelProvider = 'openrouter' | 'openai';

export interface AgentModelOption {
  value: string;
  label: string;
  provider: AgentModelProvider;
}

export const AGENT_MODEL_OPTIONS: AgentModelOption[] = [
  {
    value: 'z-ai/glm-5',
    label: 'GLM5 (OpenRouter)',
    provider: 'openrouter',
  },
  {
    value: 'z-ai/glm-4.5-air',
    label: 'GLM 4.5 Air (OpenRouter)',
    provider: 'openrouter',
  },
  {
    value: 'openai/gpt-5.2',
    label: 'GPT-5.2 (OpenRouter route)',
    provider: 'openrouter',
  },
  {
    value: 'google/gemini-2.0-flash-001',
    label: 'Gemini 2.0 Flash (OpenRouter)',
    provider: 'openrouter',
  },
];

export const AGENT_DEFAULT_MODEL = 'z-ai/glm-5';

export const AGENT_DEFAULT_MODEL_LABEL = 'GLM5';

export const AGENT_VOICE_MODEL_OPTIONS: AgentModelOption[] = [
  {
    value: 'openai/gpt-4o-mini-realtime-preview',
    label: 'GPT-4o Mini Realtime (OpenRouter)',
    provider: 'openrouter',
  },
  {
    value: 'openai/gpt-4o-realtime-preview',
    label: 'GPT-4o Realtime (OpenRouter)',
    provider: 'openrouter',
  },
];

export const AGENT_DEFAULT_VOICE_MODEL = 'openai/gpt-4o-mini-realtime-preview';
