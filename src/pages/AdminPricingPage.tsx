import { useEffect, useMemo, useState } from 'react';
import { Clock3, Database, Plus, Save, Trash2 } from 'lucide-react';
import {
  createDefaultPricingConfig,
  formatBookingMode,
  formatConfidence,
  formatCurrency,
  formatServiceLabel,
  type EstimateRecord,
  type PricingConfig,
  type WindowZone,
} from '../lib/estimateEngine';
import { AGENT_DEFAULT_MODEL, AGENT_MODEL_OPTIONS, type AgentModelOption } from '../estimate/core/agentModelConfig';
import { parseJsonResponse, type SafeJsonResult } from '../lib/responseParsing';

interface AdminPricingPageProps {
  pricingConfig: PricingConfig;
  onPricingConfigChange: (nextConfig: PricingConfig) => void;
  pricingStatus: 'loading' | 'ready' | 'error';
}

interface TrainingItem {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  status?: string;
}

interface AgentModelResponse {
  model: string;
  source: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
  available_models?: AgentModelOption[];
}

type TrainingGetPayload = {
  items?: Array<unknown>;
  source?: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
};

type TrainingSavePayload = {
  items?: Array<TrainingItem>;
  source?: 'db' | 'fallback';
  updatedAt?: string;
  message?: string;
};

type PricingSavePayload = {
  config?: PricingConfig;
  message?: string;
};

function parsePayloadError<T>(result: SafeJsonResult<T>): string {
  return result.textError ?? `Unable to parse response (HTTP ${result.status}).`;
}

const STORAGE_KEY = 'steamzone_training_admin_tab';

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm';

function NumberField({
  label,
  value,
  onChange,
  step = '1',
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: string;
  min?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
      />
    </label>
  );
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

export default function AdminPricingPage({ pricingConfig, onPricingConfigChange, pricingStatus }: AdminPricingPageProps) {
  const [activeTab, setActiveTab] = useState<'pricing' | 'training'>('pricing');
  const [draftConfig, setDraftConfig] = useState<PricingConfig>(pricingConfig);
  const [saveMessage, setSaveMessage] = useState('');
  const [saveToken, setSaveToken] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [agentModel, setAgentModel] = useState(AGENT_DEFAULT_MODEL);
  const [agentModelOptions, setAgentModelOptions] = useState<AgentModelOption[]>(AGENT_MODEL_OPTIONS);
  const [agentModelSource, setAgentModelSource] = useState<'db' | 'fallback'>('fallback');
  const [agentModelUpdatedAt, setAgentModelUpdatedAt] = useState('');
  const [agentModelLoading, setAgentModelLoading] = useState(false);
  const [agentModelSaving, setAgentModelSaving] = useState(false);
  const [agentModelMessage, setAgentModelMessage] = useState('');
  const [records] = useState<EstimateRecord[]>([]);
  const [trainingItems, setTrainingItems] = useState<TrainingItem[]>([]);
  const [trainingSource, setTrainingSource] = useState('fallback');
  const [trainingUpdatedAt, setTrainingUpdatedAt] = useState('');
  const [trainingMessage, setTrainingMessage] = useState('');
  const [trainingLoading, setTrainingLoading] = useState(false);
  const [trainingError, setTrainingError] = useState('');
  const [trainingLoaded, setTrainingLoaded] = useState(false);
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [newTopic, setNewTopic] = useState('');
  const [newSubtopic, setNewSubtopic] = useState('');
  const [newStatus, setNewStatus] = useState('READY');

  useEffect(() => {
    setDraftConfig(pricingConfig);
  }, [pricingConfig]);

  useEffect(() => {
    const tab = localStorage.getItem(STORAGE_KEY);
    if (tab === 'training' || tab === 'pricing') {
      setActiveTab(tab);
    }
  }, []);

  useEffect(() => {
    async function loadModelConfig(): Promise<void> {
      setAgentModelLoading(true);
      setAgentModelMessage('');

      try {
        const response = await parseJsonResponse<AgentModelResponse>(await fetch('/api/agent-model'));
        const payload = response.payload;

        if (!response.ok || !payload?.model) {
          setAgentModelMessage(payload?.message ?? parsePayloadError(response));
          return;
        }

        setAgentModel(payload.model);
        setAgentModelOptions(
          Array.isArray(payload.available_models) && payload.available_models.length > 0 ? payload.available_models : AGENT_MODEL_OPTIONS
        );
        setAgentModelSource(payload.source ?? 'fallback');
        setAgentModelUpdatedAt(payload.updatedAt ?? '');
        setAgentModelMessage(payload.message ?? `Loaded model ${payload.model}.`);
      } catch {
        setAgentModelMessage('Unable to reach /api/agent-model. Ensure endpoint is deployed.');
      } finally {
        setAgentModelLoading(false);
      }
    }

    void loadModelConfig();
  }, []);

  useEffect(() => {
    if (agentModelOptions.length > 0) {
      const optionExists = agentModelOptions.some((option) => option.value === agentModel);
      if (!optionExists) {
        setAgentModel(agentModelOptions[0].value);
      }
    }
  }, [agentModel, agentModelOptions]);

  async function loadTrainingData(): Promise<void> {
    setTrainingLoading(true);
    setTrainingError('');
    setTrainingMessage('');

    try {
      const response = await parseJsonResponse<TrainingGetPayload>(await fetch('/api/training-get'));
      const payload = response.payload;

      if (!response.ok || !payload) {
        setTrainingError(payload?.message ?? parsePayloadError(response));
        return;
      }

      const rawItems = Array.isArray(payload.items) ? payload.items : [];
      const nextItems: TrainingItem[] = rawItems
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }

          const typed = item as Record<string, unknown>;
          const question = String(typed.question ?? '').trim();
          const answer = String(typed.answer ?? '').trim();

          if (!question || !answer) {
            return null;
          }

          return {
            question,
            answer,
            topic: typeof typed.topic === 'string' ? typed.topic.trim() : undefined,
            subtopic: typeof typed.subtopic === 'string' ? typed.subtopic.trim() : undefined,
            status: typeof typed.status === 'string' ? typed.status.trim() : 'READY',
          } as TrainingItem;
        })
        .filter((item): item is TrainingItem => item !== null);

      setTrainingItems(nextItems);
      setTrainingSource(payload.source ?? 'fallback');
      setTrainingUpdatedAt(payload.updatedAt ?? '');
      setTrainingLoaded(true);
      setTrainingMessage(`Loaded ${nextItems.length} FAQ entries from ${payload.source === 'db' ? 'database' : 'fallback'}.`);
    } catch {
      setTrainingError('Unable to load training data. Ensure /api/training-get is deployed.');
    } finally {
      setTrainingLoading(false);
    }
  }

  function setTab(nextTab: 'pricing' | 'training'): void {
    setActiveTab(nextTab);
    localStorage.setItem(STORAGE_KEY, nextTab);

    if (nextTab === 'training' && !trainingLoaded && !trainingLoading) {
      void loadTrainingData();
    }
  }

  function updateTrainingItem(index: number, patch: Partial<TrainingItem>): void {
    setTrainingItems((previous) => {
      const next = [...previous];
      const existing = next[index];
      if (!existing) {
        return previous;
      }

      const normalizedQuestion = patch.question !== undefined ? String(patch.question).trimStart() : existing.question;
      const normalizedAnswer = patch.answer !== undefined ? String(patch.answer).trimStart() : existing.answer;

      next[index] = {
        ...existing,
        ...patch,
        question: normalizedQuestion,
        answer: normalizedAnswer,
      };
      return next;
    });
  }

  function removeTrainingItem(index: number): void {
    setTrainingItems((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  }

  function resetNewTrainingForm(): void {
    setNewQuestion('');
    setNewAnswer('');
    setNewTopic('');
    setNewSubtopic('');
    setNewStatus('READY');
  }

  function addTrainingItem(): void {
    const question = newQuestion.trim();
    const answer = newAnswer.trim();

    if (!question || !answer) {
      setTrainingMessage('Question and answer are both required to add a new training entry.');
      return;
    }

    setTrainingItems((previous) => [
      ...previous,
      {
        question,
        answer,
        topic: newTopic.trim() || undefined,
        subtopic: newSubtopic.trim() || undefined,
        status: newStatus.trim() || 'READY',
      },
    ]);

    resetNewTrainingForm();
    setTrainingMessage('Training question added. Click Save Training Data to persist.');
  }

  async function saveTrainingData(): Promise<void> {
    if (!saveToken.trim()) {
      setTrainingMessage('Enter the admin token to save training data.');
      return;
    }

    const sanitized = trainingItems
      .map((item) => ({
        question: item.question.trim(),
        answer: item.answer.trim(),
        topic: item.topic?.trim() || undefined,
        subtopic: item.subtopic?.trim() || undefined,
        status: item.status?.trim() || 'READY',
      }))
      .filter((item) => item.question && item.answer);

    setTrainingItems(sanitized);
    setTrainingLoading(true);
    setTrainingError('');
    setTrainingMessage('Saving training data...');

    try {
      const response = await parseJsonResponse<TrainingSavePayload>(
        await fetch('/api/training-save', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${saveToken.trim()}`,
            'x-admin-training-token': saveToken.trim(),
          },
          body: JSON.stringify({ items: sanitized }),
        })
      );
      const payload = response.payload;

      if (!payload) {
        setTrainingError('Unable to save training data. Response was not valid JSON.');
        return;
      }

      if (!response.ok) {
        setTrainingError(payload.message ?? parsePayloadError(response));
        return;
      }

      if (Array.isArray(payload.items)) {
        setTrainingItems(payload.items);
      }

      setTrainingSource(payload.source ?? 'db');
      setTrainingUpdatedAt(payload.updatedAt ?? '');
      setTrainingMessage(payload.message ?? 'Training data saved. Both web and voice agents now use this content.');
      setTrainingLoaded(true);
    } catch {
      setTrainingError('Unable to reach training-save endpoint. Deploy serverless routes and set env variables in Vercel.');
    } finally {
      setTrainingLoading(false);
    }
  }

  async function saveAgentModel(): Promise<void> {
    if (!saveToken.trim()) {
      setAgentModelMessage('Enter the admin token to save model settings.');
      return;
    }

    if (!agentModel.trim()) {
      setAgentModelMessage('Select a model before saving.');
      return;
    }

    setAgentModelSaving(true);
    setAgentModelMessage('Saving model settings...');

    try {
      const response = await parseJsonResponse<AgentModelResponse>(
        await fetch('/api/agent-model', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${saveToken.trim()}`,
            'x-admin-training-token': saveToken.trim(),
          },
          body: JSON.stringify({ model: agentModel.trim() }),
        })
      );
      const payload = response.payload;

      if (!response.ok || !payload?.model) {
        setAgentModelMessage(payload?.message ?? parsePayloadError(response));
        return;
      }

      setAgentModel(payload.model);
      setAgentModelSource(payload.source ?? 'fallback');
      setAgentModelUpdatedAt(payload.updatedAt ?? '');
      setAgentModelMessage(payload.message ?? 'Model setting saved. Active for next chat turns.');
    } catch {
      setAgentModelMessage('Unable to reach /api/agent-model.');
    } finally {
      setAgentModelSaving(false);
    }
  }

  useEffect(() => {
    if (activeTab === 'training' && !trainingLoaded && !trainingLoading) {
      void loadTrainingData();
    }
  }, [activeTab]);

  const latestRecords = useMemo(() => records.slice(0, 15), [records]);

  async function handleSave(): Promise<void> {
    if (!saveToken.trim()) {
      setSaveMessage('Enter the admin token to save pricing rules.');
      return;
    }

    setIsSaving(true);
    setSaveMessage('Saving pricing rules to Supabase...');

    try {
      const response = await fetch('/api/pricing-save', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${saveToken.trim()}`,
        },
        body: JSON.stringify({ config: draftConfig }),
      });

      const responsePayload = await parseJsonResponse<PricingSavePayload>(response);
      const payload = responsePayload.payload;

      if (!responsePayload.ok || !payload?.config) {
        const message = parsePayloadError(responsePayload);
        setSaveMessage(payload?.message ?? message);
        setIsSaving(false);
        return;
      }

      onPricingConfigChange(payload.config);
      setSaveMessage('Pricing rules saved. All new quotes now use this configuration.');
      setIsSaving(false);
    } catch {
      setSaveMessage('Unable to reach pricing-save endpoint. Deploy serverless routes and set env variables in Vercel.');
      setIsSaving(false);
    }
  }

  function handleReset(): void {
    const defaults = createDefaultPricingConfig();
    setDraftConfig(defaults);
    setSaveMessage('Draft reset to defaults. Click Save to publish defaults to Supabase.');
  }

  function updateTravelFee(zone: WindowZone, value: number): void {
    setDraftConfig((previous) => ({
      ...previous,
      travelFees: {
        ...previous.travelFees,
        [zone]: value,
      },
    }));
  }

  return (
    <main className="bg-slate-50 pb-20 pt-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">Estimate Admin</h1>
            <p className="mt-3 max-w-3xl text-gray-600">
              {activeTab === 'pricing'
                ? 'Full pricing control for Steinbach routes: travel zones, per-service base rates, multipliers, add-ons, red flags, and estimate range behavior.'
                : 'Update shared training questions/answers used by both web and voice agents.'}
            </p>
            <p className="mt-2 text-sm text-gray-500">Last updated: {new Date(draftConfig.updatedAt).toLocaleString()}</p>
          </div>
        </div>

        <section className={cardClass}>
          <h2 className="text-xl font-bold text-gray-900">Admin Credentials</h2>
          <p className="mt-2 text-sm text-gray-600">
            The same token is used to edit both pricing and training data.
          </p>

          <label className="mt-4 block max-w-xl">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              Admin token (server env: ADMIN_TRAINING_TOKEN or ADMIN_PRICING_TOKEN)
            </span>
            <input
              type="password"
              value={saveToken}
              onChange={(event) => setSaveToken(event.target.value)}
              placeholder="Paste token to enable saving"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </label>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Estimate Agent Model</h2>
          <p className="mt-2 text-sm text-gray-600">Choose the model used by both web and voice agents for estimate conversations.</p>
          <p className="mt-2 text-sm text-gray-500">
            Source: {agentModelSource} {agentModelUpdatedAt ? `• Updated ${new Date(agentModelUpdatedAt).toLocaleString()}` : '• Not saved yet'}
          </p>

          <label className="mt-4 block max-w-2xl">
            <span className="mb-1 block text-sm font-medium text-gray-700">Active model</span>
            <select
              value={agentModel}
              onChange={(event) => setAgentModel(event.target.value)}
              disabled={agentModelLoading || agentModelOptions.length === 0}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {agentModelLoading && (
                <option value={agentModel}>{agentModel}</option>
              )}
              {!agentModelLoading &&
                agentModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </select>
          </label>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={saveAgentModel}
              disabled={agentModelSaving}
              className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {agentModelSaving ? 'Saving...' : 'Save Model'}
            </button>
          </div>

          {agentModelMessage && (
            <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{agentModelMessage}</p>
          )}
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setTab('pricing')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'pricing' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Pricing Configuration
          </button>
          <button
            type="button"
            onClick={() => setTab('training')}
            className={`rounded-lg border px-4 py-2 text-sm font-semibold transition ${
              activeTab === 'training' ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
            }`}
          >
            Training Data
          </button>
        </div>

        {activeTab === 'pricing' && (
          <>
            {saveMessage && <p className="mt-6 mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{saveMessage}</p>}
            <section className={`${cardClass} mt-6`}>
              <h2 className="text-xl font-bold text-gray-900">Supabase Pricing Storage</h2>
              <p className="mt-2 text-sm text-gray-600">
                Pricing rules are loaded from <code className="rounded bg-slate-100 px-1 py-0.5">/api/pricing-get</code>. To publish changes, enter your admin
                token and click Save.
              </p>
              <p className="mt-2 text-sm text-gray-500">Pricing load status: {pricingStatus}</p>

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving}
                  className="inline-flex items-center rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {isSaving ? 'Saving...' : 'Save Pricing Rules'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-lg border border-gray-300 px-5 py-2.5 font-semibold text-gray-700 transition hover:bg-gray-100"
                >
                  Reset Defaults
                </button>
              </div>
            </section>

            <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Global Estimate Range + Travel Zones</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <NumberField
              label="Low range multiplier"
              step="0.01"
              value={draftConfig.estimateRange.lowMultiplier}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  estimateRange: { ...previous.estimateRange, lowMultiplier: value },
                }))
              }
            />
            <NumberField
              label="High range multiplier"
              step="0.01"
              value={draftConfig.estimateRange.highMultiplier}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  estimateRange: { ...previous.estimateRange, highMultiplier: value },
                }))
              }
            />

            <NumberField label="Zone A fee" value={draftConfig.travelFees.zoneA} onChange={(value) => updateTravelFee('zoneA', value)} />
            <NumberField label="Zone B fee" value={draftConfig.travelFees.zoneB} onChange={(value) => updateTravelFee('zoneB', value)} />
            <NumberField label="Zone C fee" value={draftConfig.travelFees.zoneC} onChange={(value) => updateTravelFee('zoneC', value)} />
            <NumberField label="Zone D fee" value={draftConfig.travelFees.zoneD} onChange={(value) => updateTravelFee('zoneD', value)} />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Residential Window Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.window.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, window: { ...previous.window, minimumCharge: value } }))
              }
            />
            <NumberField
              label="Per pane rate"
              step="0.01"
              value={draftConfig.window.perPaneRate}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, window: { ...previous.window, perPaneRate: value } }))
              }
            />
            <NumberField
              label="Yellow threshold"
              value={draftConfig.window.yellowComplexityThreshold}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, yellowComplexityThreshold: value },
                }))
              }
            />

            <NumberField
              label="Screens (some)"
              value={draftConfig.window.addOns.screensSome}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, screensSome: value } },
                }))
              }
            />
            <NumberField
              label="Screens per pane"
              step="0.01"
              value={draftConfig.window.addOns.screensPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, screensPerPane: value } },
                }))
              }
            />
            <NumberField
              label="Tracks detailed"
              value={draftConfig.window.addOns.tracksDetailed}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, tracksDetailed: value } },
                }))
              }
            />
            <NumberField
              label="Hard water add-on"
              value={draftConfig.window.addOns.hardWaterRemoval}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, hardWaterRemoval: value } },
                }))
              }
            />
            <NumberField
              label="Construction debris add-on"
              value={draftConfig.window.addOns.constructionDebris}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, addOns: { ...previous.window.addOns, constructionDebris: value } },
                }))
              }
            />

            <NumberField
              label="Panes: 1000-1500"
              value={draftConfig.window.estimatedPanes['1000to1500']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '1000to1500': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 1500-2000"
              value={draftConfig.window.estimatedPanes['1500to2000']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '1500to2000': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 2000-2500"
              value={draftConfig.window.estimatedPanes['2000to2500']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '2000to2500': value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes: 2500-3000"
              value={draftConfig.window.estimatedPanes['2500to3000']}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    estimatedPanes: { ...previous.window.estimatedPanes, '2500to3000': value },
                  },
                }))
              }
            />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ToggleField
              label="3000+ requires quote"
              checked={draftConfig.window.redFlags.over3000RequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, redFlags: { ...previous.window.redFlags, over3000RequiresQuote: checked } },
                }))
              }
            />
            <ToggleField
              label="3-storey + French lots requires quote"
              checked={draftConfig.window.redFlags.threeStoreyFrenchLotsRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    redFlags: { ...previous.window.redFlags, threeStoreyFrenchLotsRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Hard water requires confirmation"
              checked={draftConfig.window.redFlags.hardWaterNeedsConfirmation}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: { ...previous.window, redFlags: { ...previous.window.redFlags, hardWaterNeedsConfirmation: checked } },
                }))
              }
            />
            <ToggleField
              label="Construction debris requires quote"
              checked={draftConfig.window.redFlags.constructionDebrisNeedsQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  window: {
                    ...previous.window,
                    redFlags: { ...previous.window.redFlags, constructionDebrisNeedsQuote: checked },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Commercial Window Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.commercialWindow.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: { ...previous.commercialWindow, minimumCharge: value },
                }))
              }
            />
            <NumberField
              label="Yellow threshold"
              value={draftConfig.commercialWindow.yellowComplexityThreshold}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: { ...previous.commercialWindow, yellowComplexityThreshold: value },
                }))
              }
            />

            <NumberField
              label="Storefront exterior / pane"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.exteriorPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, exteriorPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Storefront in+out / pane"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.bothSidesPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, bothSidesPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Storefront glass door"
              step="0.01"
              value={draftConfig.commercialWindow.storefront.perGlassDoor}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, perGlassDoor: value },
                  },
                }))
              }
            />
            <NumberField
              label="Panes per frontage foot"
              step="0.1"
              value={draftConfig.commercialWindow.storefront.panesPerFrontageFoot}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    storefront: { ...previous.commercialWindow.storefront, panesPerFrontageFoot: value },
                  },
                }))
              }
            />

            <NumberField
              label="Low-rise per pane min"
              step="0.01"
              value={draftConfig.commercialWindow.lowRise.perPaneMin}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, perPaneMin: value },
                  },
                }))
              }
            />
            <NumberField
              label="Low-rise per pane max"
              step="0.01"
              value={draftConfig.commercialWindow.lowRise.perPaneMax}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, perPaneMax: value },
                  },
                }))
              }
            />
            <NumberField
              label="Low-rise upper storey premium %"
              step="0.1"
              value={draftConfig.commercialWindow.lowRise.upperStoreyPremiumPercent}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    lowRise: { ...previous.commercialWindow.lowRise, upperStoreyPremiumPercent: value },
                  },
                }))
              }
            />

            <NumberField
              label="Monthly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.monthly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      monthly: value,
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Biweekly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.biweekly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      biweekly: value,
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Weekly discount %"
              step="0.1"
              value={draftConfig.commercialWindow.recurringDiscountPercent.weekly}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    recurringDiscountPercent: {
                      ...previous.commercialWindow.recurringDiscountPercent,
                      weekly: value,
                    },
                  },
                }))
              }
            />

            <NumberField
              label="After-hours premium %"
              step="0.1"
              value={draftConfig.commercialWindow.addOns.afterHoursPercent}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, afterHoursPercent: value },
                  },
                }))
              }
            />
            <NumberField
              label="Overspray / pane"
              step="0.01"
              value={draftConfig.commercialWindow.addOns.oversprayPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, oversprayPerPane: value },
                  },
                }))
              }
            />
            <NumberField
              label="Hard water / pane"
              step="0.01"
              value={draftConfig.commercialWindow.addOns.hardWaterPerPane}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    addOns: { ...previous.commercialWindow.addOns, hardWaterPerPane: value },
                  },
                }))
              }
            />
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ToggleField
              label="Mid-rise requires quote"
              checked={draftConfig.commercialWindow.redFlags.midRiseRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, midRiseRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="High-rise requires quote"
              checked={draftConfig.commercialWindow.redFlags.highRiseRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, highRiseRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Lift required => quote"
              checked={draftConfig.commercialWindow.redFlags.liftRequiredRequiresQuote}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, liftRequiredRequiresQuote: checked },
                  },
                }))
              }
            />
            <ToggleField
              label="Overspray needs confirmation"
              checked={draftConfig.commercialWindow.redFlags.oversprayNeedsConfirmation}
              onChange={(checked) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  commercialWindow: {
                    ...previous.commercialWindow,
                    redFlags: { ...previous.commercialWindow.redFlags, oversprayNeedsConfirmation: checked },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Carpet Cleaning Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.carpet.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, minimumCharge: value } }))
              }
            />
            <NumberField
              label="Base rate / sq ft"
              step="0.01"
              value={draftConfig.carpet.baseRatePerSqft}
              onChange={(value) =>
                setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, baseRatePerSqft: value } }))
              }
            />
            <NumberField
              label="2 rooms"
              value={draftConfig.carpet.roomPackages.twoRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, twoRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="3 rooms"
              value={draftConfig.carpet.roomPackages.threeRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, threeRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="4 rooms"
              value={draftConfig.carpet.roomPackages.fourRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, fourRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="5 rooms"
              value={draftConfig.carpet.roomPackages.fiveRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, fiveRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="6 rooms"
              value={draftConfig.carpet.roomPackages.sixRooms}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, sixRooms: value },
                  },
                }))
              }
            />
            <NumberField
              label="Additional room"
              value={draftConfig.carpet.roomPackages.additionalRoom}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: {
                    ...previous.carpet,
                    roomPackages: { ...previous.carpet.roomPackages, additionalRoom: value },
                  },
                }))
              }
            />

            <NumberField
              label="Stairs / step"
              step="0.01"
              value={draftConfig.carpet.stairsPerStep}
              onChange={(value) => setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, stairsPerStep: value } }))}
            />
            <NumberField
              label="Hallway price"
              value={draftConfig.carpet.hallwayPrice}
              onChange={(value) => setDraftConfig((previous) => ({ ...previous, carpet: { ...previous.carpet, hallwayPrice: value } }))}
            />
            <NumberField
              label="Advanced stain add-on"
              value={draftConfig.carpet.addOns.advancedStainRemoval}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: { ...previous.carpet, addOns: { ...previous.carpet.addOns, advancedStainRemoval: value } },
                }))
              }
            />
            <NumberField
              label="Odor add-on"
              value={draftConfig.carpet.addOns.odorElimination}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  carpet: { ...previous.carpet, addOns: { ...previous.carpet.addOns, odorElimination: value } },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <h2 className="text-xl font-bold text-gray-900">Post-Construction Rules</h2>

          <div className="mt-4 grid gap-4 md:grid-cols-3 xl:grid-cols-4">
            <NumberField
              label="Minimum charge"
              value={draftConfig.postConstruction.minimumCharge}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: { ...previous.postConstruction, minimumCharge: value },
                }))
              }
            />

            <NumberField
              label="Rough stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.rough}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, rough: value },
                  },
                }))
              }
            />
            <NumberField
              label="Light stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.light}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, light: value },
                  },
                }))
              }
            />
            <NumberField
              label="Final stage $/sq ft"
              step="0.01"
              value={draftConfig.postConstruction.stageRates.final}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    stageRates: { ...previous.postConstruction.stageRates, final: value },
                  },
                }))
              }
            />

            <NumberField
              label="Dust medium multiplier"
              step="0.01"
              value={draftConfig.postConstruction.dustMultipliers.medium}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    dustMultipliers: { ...previous.postConstruction.dustMultipliers, medium: value },
                  },
                }))
              }
            />
            <NumberField
              label="Dust heavy multiplier"
              step="0.01"
              value={draftConfig.postConstruction.dustMultipliers.heavy}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    dustMultipliers: { ...previous.postConstruction.dustMultipliers, heavy: value },
                  },
                }))
              }
            />
            <NumberField
              label="Interior windows (small)"
              value={draftConfig.postConstruction.addOns.interiorWindows.small}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    addOns: {
                      ...previous.postConstruction.addOns,
                      interiorWindows: { ...previous.postConstruction.addOns.interiorWindows, small: value },
                    },
                  },
                }))
              }
            />
            <NumberField
              label="Floor detail (small)"
              value={draftConfig.postConstruction.addOns.floorDetailing.small}
              onChange={(value) =>
                setDraftConfig((previous) => ({
                  ...previous,
                  postConstruction: {
                    ...previous.postConstruction,
                    addOns: {
                      ...previous.postConstruction.addOns,
                      floorDetailing: { ...previous.postConstruction.addOns.floorDetailing, small: value },
                    },
                  },
                }))
              }
            />
          </div>
        </section>

        <section className={`${cardClass} mt-6`}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-gray-900">Recent Estimate Records</h2>
          </div>

          {latestRecords.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-gray-600">
              Quote history is now stored server-side in Supabase. Add an admin endpoint to list records if you want this
              table populated again.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-3 py-3">Time</th>
                    <th className="px-3 py-3">Quote #</th>
                    <th className="px-3 py-3">Service</th>
                    <th className="px-3 py-3">Contact</th>
                    <th className="px-3 py-3">Estimate</th>
                    <th className="px-3 py-3">Confidence</th>
                    <th className="px-3 py-3">Next step</th>
                    <th className="px-3 py-3">Zone</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {latestRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      <td className="px-3 py-3 text-gray-600">
                        <div className="flex items-center gap-2">
                          <Clock3 className="h-4 w-4 text-gray-400" />
                          {new Date(record.createdAt).toLocaleString()}
                        </div>
                      </td>
                      <td className="px-3 py-3 font-semibold text-gray-800">{record.quoteNumber}</td>
                      <td className="px-3 py-3 font-medium text-gray-800">{formatServiceLabel(record.serviceType)}</td>
                      <td className="px-3 py-3 text-gray-700">
                        <div className="font-medium">{record.contact.fullName || 'N/A'}</div>
                        <div className="text-xs text-gray-500">{record.contact.phone || record.contact.email || 'No contact'}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-700">
                        {formatCurrency(record.result.estimateLow)} - {formatCurrency(record.result.estimateHigh)}
                      </td>
                      <td className="px-3 py-3 text-gray-700">{formatConfidence(record.result.confidence)}</td>
                      <td className="px-3 py-3 text-gray-700">{formatBookingMode(record.result.bookingMode)}</td>
                      <td className="px-3 py-3 text-gray-700">{record.zone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            <p className="font-semibold">Storage note</p>
            <p className="mt-1 inline-flex items-center">
              <Database className="mr-2 h-4 w-4" />
              Pricing and estimate creation now run server-side. Pricing loads from Supabase and estimates are stored in
              the <code className="mx-1 rounded bg-blue-100 px-1 py-0.5">estimate_records</code> table.
            </p>
          </div>
        </section>
          </>
        )}

        {activeTab === 'training' && (
          <>
            {trainingMessage && <p className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{trainingMessage}</p>}
            {trainingError && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{trainingError}</p>}

            <section className={cardClass}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">Training Data</h2>
                  <p className="mt-2 text-sm text-gray-600">
                    Source: {trainingSource}. Updated: {trainingUpdatedAt || 'never'} · Loaded: {trainingItems.length} entries.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void loadTrainingData()}
                    disabled={trainingLoading}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Reload Training Data
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveTrainingData()}
                    disabled={trainingLoading}
                    className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {trainingLoading ? 'Saving...' : 'Save Training Data'}
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 p-3">
                <h3 className="font-semibold text-gray-900">Add new FAQ entry</h3>
                <div className="mt-3 grid gap-3">
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Question</span>
                    <input
                      type="text"
                      value={newQuestion}
                      onChange={(event) => setNewQuestion(event.target.value)}
                      placeholder="What is your question?"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm font-medium text-gray-700">Answer</span>
                    <textarea
                      value={newAnswer}
                      onChange={(event) => setNewAnswer(event.target.value)}
                      rows={4}
                      placeholder="Paste the response text..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>

                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Topic</span>
                      <input
                        type="text"
                        value={newTopic}
                        onChange={(event) => setNewTopic(event.target.value)}
                        placeholder="Residential Carpet Cleaning"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Subtopic</span>
                      <input
                        type="text"
                        value={newSubtopic}
                        onChange={(event) => setNewSubtopic(event.target.value)}
                        placeholder="Process"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
                      <input
                        type="text"
                        value={newStatus}
                        onChange={(event) => setNewStatus(event.target.value)}
                        placeholder="READY"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      />
                    </label>
                  </div>

                  <button
                    type="button"
                    onClick={addTrainingItem}
                    className="inline-flex w-fit items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Entry
                  </button>
                </div>
              </div>

              <div className="mt-6">
                {trainingLoading ? (
                  <p className="text-sm text-gray-500">Loading training entries...</p>
                ) : (
                  <div className="space-y-3">
                    {trainingItems.length === 0 && (
                      <p className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-4 text-sm text-gray-600">No training items loaded yet.</p>
                    )}

                    {trainingItems.map((item, index) => (
                      <div key={`${item.question}-${index}`} className="rounded-lg border border-gray-200 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-800">#{index + 1}</p>
                          <button
                            type="button"
                            onClick={() => removeTrainingItem(index)}
                            className="inline-flex items-center rounded border border-red-200 px-3 py-1.5 text-sm text-red-700 transition hover:bg-red-50"
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Remove
                          </button>
                        </div>

                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">Question</span>
                          <input
                            type="text"
                            value={item.question}
                            onChange={(event) => updateTrainingItem(index, { question: event.target.value })}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>
                        <label className="mt-3 block">
                          <span className="mb-1 block text-sm font-medium text-gray-700">Answer</span>
                          <textarea
                            value={item.answer}
                            onChange={(event) => updateTrainingItem(index, { answer: event.target.value })}
                            rows={4}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                          />
                        </label>

                        <div className="mt-3 grid gap-3 md:grid-cols-3">
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Topic</span>
                            <input
                              type="text"
                              value={item.topic ?? ''}
                              onChange={(event) => updateTrainingItem(index, { topic: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Subtopic</span>
                            <input
                              type="text"
                              value={item.subtopic ?? ''}
                              onChange={(event) => updateTrainingItem(index, { subtopic: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-sm font-medium text-gray-700">Status</span>
                            <input
                              type="text"
                              value={item.status ?? 'READY'}
                              onChange={(event) => updateTrainingItem(index, { status: event.target.value })}
                              className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
