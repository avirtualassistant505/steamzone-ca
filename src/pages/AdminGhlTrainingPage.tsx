import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Database, ExternalLink, Loader2, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { parseJsonResponse, type SafeJsonResult } from '../lib/responseParsing';

type KnowledgeBaseSummary = {
  id: string;
  name: string;
  locationId?: string;
};

type GhlTrainingItem = {
  id?: string;
  question: string;
  answer: string;
  knowledgeBaseId?: string;
  locationId?: string;
  createdAt?: string;
  updatedAt?: string;
};

type GhlChatAgentPrompt = {
  agentId: string;
  name: string;
  locationId?: string;
  goal: string;
  personality: string;
  instructions: string;
  knowledgeBaseIds: string[];
  actionTypes: string[];
};

type GhlVoiceAgentPrompt = {
  agentId: string;
  locationId?: string;
  agentName: string;
  businessName: string;
  welcomeMessage: string;
  agentPrompt: string;
  timezone: string;
};

type GhlAgentPromptBundle = {
  locationId: string;
  chatAgent: GhlChatAgentPrompt;
  voiceAgent: GhlVoiceAgentPrompt;
};

type GhlTrainingGetPayload = {
  locationId?: string;
  knowledgeBases?: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId?: string;
  items?: GhlTrainingItem[];
  agentPrompts?: GhlAgentPromptBundle;
  message?: string;
};

type GhlTrainingSavePayload = {
  items?: GhlTrainingItem[];
  knowledgeBaseId?: string;
  counts?: {
    created?: number;
    updated?: number;
    deleted?: number;
  };
  agentPrompts?: GhlAgentPromptBundle;
  previousPrompts?: GhlAgentPromptBundle;
  message?: string;
};

type TrainingAssistantProposedAction = {
  type: 'none' | 'add' | 'update';
  target_index: number | null;
  reason: string;
  entry: {
    question: string;
    answer: string;
    topic?: string;
    subtopic?: string;
    status?: string;
  } | null;
};

type TrainingAssistantResponse = {
  assistant_message?: string;
  result_indexes?: number[];
  suggested_jump_index?: number | null;
  proposed_action?: TrainingAssistantProposedAction;
  source?: 'llm' | 'fallback';
  message?: string;
};

type PromptAssistantResponse = {
  assistant_message?: string;
  drafted_value?: string;
  source?: 'llm' | 'fallback';
  message?: string;
};

type TrainingAssistantMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
};

type PromptFieldKey = 'chat.goal' | 'chat.personality' | 'chat.instructions' | 'voice.welcomeMessage' | 'voice.agentPrompt';

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm';
const PROMPT_BACKUP_STORAGE_KEY = 'steamzone-ghl-agent-prompt-backup-v1';

function previewPromptText(value: string, max = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No value loaded.';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
}

function parsePayloadError<T>(result: SafeJsonResult<T>): string {
  return result.textError ?? `Unable to parse response (HTTP ${result.status}).`;
}

function sanitizeItems(items: GhlTrainingItem[]): Array<{ id?: string; question: string; answer: string }> {
  return items.map((item) => ({
    id: item.id?.trim() || undefined,
    question: item.question.trim(),
    answer: item.answer.trim(),
  }));
}

function sanitizeAgentPrompts(bundle: GhlAgentPromptBundle | null): Record<string, unknown> | null {
  if (!bundle) return null;
  return {
    chatAgent: {
      goal: bundle.chatAgent.goal.trim(),
      personality: bundle.chatAgent.personality.trim(),
      instructions: bundle.chatAgent.instructions.trim(),
    },
    voiceAgent: {
      welcomeMessage: bundle.voiceAgent.welcomeMessage.trim(),
      agentPrompt: bundle.voiceAgent.agentPrompt.trim(),
    },
  };
}

function itemMatchesFilter(item: GhlTrainingItem, filter: string): boolean {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  return `${item.question} ${item.answer}`.toLowerCase().includes(normalizedFilter);
}

function getPromptFieldLabel(field: PromptFieldKey): string {
  switch (field) {
    case 'chat.goal':
      return 'Website Chat Goal';
    case 'chat.personality':
      return 'Website Chat Personality';
    case 'chat.instructions':
      return 'Website Chat Instructions';
    case 'voice.welcomeMessage':
      return 'Voice Welcome Message';
    case 'voice.agentPrompt':
      return 'Voice Agent Prompt';
    default:
      return field;
  }
}

function getPromptFieldValue(bundle: GhlAgentPromptBundle | null, field: PromptFieldKey): string {
  if (!bundle) return '';
  switch (field) {
    case 'chat.goal':
      return bundle.chatAgent.goal;
    case 'chat.personality':
      return bundle.chatAgent.personality;
    case 'chat.instructions':
      return bundle.chatAgent.instructions;
    case 'voice.welcomeMessage':
      return bundle.voiceAgent.welcomeMessage;
    case 'voice.agentPrompt':
      return bundle.voiceAgent.agentPrompt;
    default:
      return '';
  }
}

function setPromptFieldValue(bundle: GhlAgentPromptBundle | null, field: PromptFieldKey, value: string): GhlAgentPromptBundle | null {
  if (!bundle) return bundle;
  switch (field) {
    case 'chat.goal':
      return { ...bundle, chatAgent: { ...bundle.chatAgent, goal: value } };
    case 'chat.personality':
      return { ...bundle, chatAgent: { ...bundle.chatAgent, personality: value } };
    case 'chat.instructions':
      return { ...bundle, chatAgent: { ...bundle.chatAgent, instructions: value } };
    case 'voice.welcomeMessage':
      return { ...bundle, voiceAgent: { ...bundle.voiceAgent, welcomeMessage: value } };
    case 'voice.agentPrompt':
      return { ...bundle, voiceAgent: { ...bundle.voiceAgent, agentPrompt: value } };
    default:
      return bundle;
  }
}

function parseStoredPromptBackup(raw: string | null): GhlAgentPromptBundle | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prompts = (parsed?.prompts ?? parsed) as GhlAgentPromptBundle;
    if (!prompts?.chatAgent?.instructions || !prompts?.voiceAgent?.agentPrompt) {
      return null;
    }
    return prompts;
  } catch {
    return null;
  }
}

export default function AdminGhlTrainingPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [items, setItems] = useState<GhlTrainingItem[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const [agentPrompts, setAgentPrompts] = useState<GhlAgentPromptBundle | null>(null);
  const [lastPromptBackup, setLastPromptBackup] = useState<GhlAgentPromptBundle | null>(null);
  const [locationId, setLocationId] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantPendingJumpIndex, setAssistantPendingJumpIndex] = useState<number | null>(null);
  const [assistantHighlightIndex, setAssistantHighlightIndex] = useState<number | null>(null);
  const [assistantPendingAction, setAssistantPendingAction] = useState<TrainingAssistantProposedAction | null>(null);
  const [assistantMessages, setAssistantMessages] = useState<TrainingAssistantMessage[]>([
    {
      id: 'ghl-training-assistant-welcome',
      role: 'assistant',
      content:
        'I can search the active GoHighLevel knowledge base, suggest FAQ edits, and draft new entries. Ask naturally, then confirm any proposed change before saving.',
    },
  ]);
  const [promptAssistantTarget, setPromptAssistantTarget] = useState<PromptFieldKey>('chat.instructions');
  const [promptAssistantInput, setPromptAssistantInput] = useState('');
  const [promptAssistantBusy, setPromptAssistantBusy] = useState(false);
  const [promptAssistantMessage, setPromptAssistantMessage] = useState('');
  const [promptAssistantDraft, setPromptAssistantDraft] = useState('');
  const [manualPromptEditorField, setManualPromptEditorField] = useState<PromptFieldKey | null>(null);

  const savedSnapshotRef = useRef('');
  const itemRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const assistantMessageCounter = useRef(0);

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((entry) => entry.id === selectedKnowledgeBaseId) ?? null,
    [knowledgeBases, selectedKnowledgeBaseId]
  );

  const filteredItems = useMemo(
    () => items.map((item, index) => ({ item, index })).filter(({ item }) => itemMatchesFilter(item, filter)),
    [filter, items]
  );

  const promptFieldOptions = useMemo<Array<{ value: PromptFieldKey; label: string }>>(
    () => [
      { value: 'chat.goal', label: 'Website Chat Goal' },
      { value: 'chat.personality', label: 'Website Chat Personality' },
      { value: 'chat.instructions', label: 'Website Chat Instructions' },
      { value: 'voice.welcomeMessage', label: 'Voice Welcome Message' },
      { value: 'voice.agentPrompt', label: 'Voice Agent Prompt' },
    ],
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setLastPromptBackup(parseStoredPromptBackup(window.localStorage.getItem(PROMPT_BACKUP_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    const snapshot = JSON.stringify({
      items: sanitizeItems(items),
      deletedIds: [...deletedIds].sort(),
      agentPrompts: sanitizeAgentPrompts(agentPrompts),
    });
    setDirty(loaded && snapshot !== savedSnapshotRef.current);
  }, [agentPrompts, deletedIds, items, loaded]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (lastPromptBackup) {
      window.localStorage.setItem(
        PROMPT_BACKUP_STORAGE_KEY,
        JSON.stringify({ savedAt: new Date().toISOString(), prompts: lastPromptBackup })
      );
      return;
    }
    window.localStorage.removeItem(PROMPT_BACKUP_STORAGE_KEY);
  }, [lastPromptBackup]);

  async function loadData(nextKnowledgeBaseId?: string): Promise<void> {
    const requestedKnowledgeBaseId = (nextKnowledgeBaseId ?? selectedKnowledgeBaseId).trim();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const query = requestedKnowledgeBaseId ? `?knowledgeBaseId=${encodeURIComponent(requestedKnowledgeBaseId)}` : '';
      const response = await parseJsonResponse<GhlTrainingGetPayload>(await fetch(`/api/ghl-training-get${query}`));
      const payload = response.payload;
      if (!response.ok || !payload) {
        setError(payload?.message ?? parsePayloadError(response));
        return;
      }

      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      const nextKnowledgeBases = Array.isArray(payload.knowledgeBases) ? payload.knowledgeBases : [];
      const nextAgentPrompts = payload.agentPrompts ?? null;
      setKnowledgeBases(nextKnowledgeBases);
      setSelectedKnowledgeBaseId(payload.selectedKnowledgeBaseId ?? nextKnowledgeBases[0]?.id ?? '');
      setItems(nextItems);
      setDeletedIds([]);
      setAgentPrompts(nextAgentPrompts);
      setLocationId(payload.locationId ?? nextAgentPrompts?.locationId ?? '');
      setLoaded(true);
      savedSnapshotRef.current = JSON.stringify({
        items: sanitizeItems(nextItems),
        deletedIds: [],
        agentPrompts: sanitizeAgentPrompts(nextAgentPrompts),
      });
      setDirty(false);
      setMessage(payload.message ?? `Loaded ${nextItems.length} FAQ entries from GoHighLevel.`);
      setAssistantPendingAction(null);
      setAssistantPendingJumpIndex(null);
      setAssistantHighlightIndex(null);
      setPromptAssistantMessage('');
      setPromptAssistantDraft('');
    } catch {
      setError('Unable to load GoHighLevel training data. Ensure /api/ghl-training-get is deployed and GHL env vars are set.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function scrollToItem(index: number): void {
    const node = itemRefs.current[index];
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setAssistantHighlightIndex(index);
    window.setTimeout(() => {
      setAssistantHighlightIndex((current) => (current === index ? null : current));
    }, 2400);
  }

  async function saveChanges(): Promise<void> {
    if (!selectedKnowledgeBaseId) {
      setError('Select a knowledge base before saving.');
      return;
    }
    if (!agentPrompts) {
      setError('Agent prompts have not loaded yet. Sync from GHL and try again.');
      return;
    }

    setSaving(true);
    setError('');
    setMessage('Saving GoHighLevel knowledge base and prompt changes...');

    try {
      const response = await parseJsonResponse<GhlTrainingSavePayload>(
        await fetch('/api/ghl-training-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            knowledgeBaseId: selectedKnowledgeBaseId,
            items: sanitizeItems(items),
            deletedIds,
            agentPrompts: sanitizeAgentPrompts(agentPrompts),
          }),
        })
      );
      const payload = response.payload;
      if (!response.ok || !payload) {
        setError(payload?.message ?? parsePayloadError(response));
        setMessage('');
        return;
      }

      const refreshedItems = Array.isArray(payload.items) ? payload.items : items;
      const refreshedPrompts = payload.agentPrompts ?? agentPrompts;
      setItems(refreshedItems);
      setDeletedIds([]);
      setAgentPrompts(refreshedPrompts);
      if (payload.previousPrompts) {
        setLastPromptBackup(payload.previousPrompts);
      }
      savedSnapshotRef.current = JSON.stringify({
        items: sanitizeItems(refreshedItems),
        deletedIds: [],
        agentPrompts: sanitizeAgentPrompts(refreshedPrompts),
      });
      setDirty(false);
      setMessage(payload.message ?? 'GoHighLevel training data saved.');
    } catch {
      setError('Unable to save GoHighLevel training data.');
      setMessage('');
    } finally {
      setSaving(false);
    }
  }

  function addItem(): void {
    setItems((previous) => [...previous, { question: '', answer: '' }]);
  }

  function updateItem(index: number, patch: Partial<GhlTrainingItem>): void {
    setItems((previous) => previous.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number): void {
    setItems((previous) => {
      const target = previous[index];
      if (target?.id) {
        setDeletedIds((current) => (current.includes(target.id!) ? current : [...current, target.id!]));
      }
      return previous.filter((_, itemIndex) => itemIndex !== index);
    });
  }

  function updatePromptField(field: PromptFieldKey, value: string): void {
    setAgentPrompts((current) => setPromptFieldValue(current, field, value));
  }

  function restorePromptBackup(): void {
    if (!lastPromptBackup) return;
    setAgentPrompts(lastPromptBackup);
    setPromptAssistantMessage('Last saved prompt backup restored locally. Save to push it back to GHL.');
    setPromptAssistantDraft('');
  }

  async function switchKnowledgeBase(nextKnowledgeBaseId: string): Promise<void> {
    if (!nextKnowledgeBaseId || nextKnowledgeBaseId === selectedKnowledgeBaseId) {
      return;
    }
    if (dirty) {
      const confirmed = window.confirm('You have unsaved changes. Switching knowledge bases will discard them. Continue?');
      if (!confirmed) return;
    }
    setSelectedKnowledgeBaseId(nextKnowledgeBaseId);
    await loadData(nextKnowledgeBaseId);
  }

  async function refreshFromGhl(): Promise<void> {
    if (dirty) {
      const confirmed = window.confirm('You have unsaved changes. Refreshing will discard them and reload from GoHighLevel. Continue?');
      if (!confirmed) return;
    }
    await loadData(selectedKnowledgeBaseId);
  }

  function pushAssistantMessage(role: 'assistant' | 'user', content: string): void {
    assistantMessageCounter.current += 1;
    setAssistantMessages((previous) => [...previous, { id: `ghl-training-assistant-${assistantMessageCounter.current}`, role, content }]);
  }

  async function runAssistant(): Promise<void> {
    const query = assistantInput.trim();
    if (!query || assistantBusy) return;

    const nextHistory = [...assistantMessages, { id: 'pending-user', role: 'user' as const, content: query }];
    setAssistantInput('');
    pushAssistantMessage('user', query);
    setAssistantBusy(true);
    setAssistantPendingAction(null);
    setAssistantPendingJumpIndex(null);

    try {
      const response = await parseJsonResponse<TrainingAssistantResponse>(
        await fetch('/api/training-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            items: items.map((item) => ({ question: item.question, answer: item.answer, status: 'READY' })),
            history: nextHistory.map((entry) => ({ role: entry.role, content: entry.content })),
          }),
        })
      );
      const payload = response.payload;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? parsePayloadError(response));
      }

      pushAssistantMessage('assistant', payload.assistant_message?.trim() || 'No assistant response returned.');
      setAssistantPendingJumpIndex(typeof payload.suggested_jump_index === 'number' ? payload.suggested_jump_index : null);
      setAssistantPendingAction(payload.proposed_action ?? null);
      const highlightIndex = payload.result_indexes?.[0];
      setAssistantHighlightIndex(typeof highlightIndex === 'number' ? highlightIndex : null);
    } catch (caughtError) {
      pushAssistantMessage('assistant', caughtError instanceof Error ? caughtError.message : 'Assistant request failed.');
    } finally {
      setAssistantBusy(false);
    }
  }

  async function runPromptAssistant(): Promise<void> {
    const request = promptAssistantInput.trim();
    const currentValue = getPromptFieldValue(agentPrompts, promptAssistantTarget).trim();
    if (!request || !currentValue || promptAssistantBusy) return;

    setPromptAssistantBusy(true);
    setPromptAssistantMessage('');
    setPromptAssistantDraft('');

    try {
      const response = await parseJsonResponse<PromptAssistantResponse>(
        await fetch('/api/ghl-prompt-assistant', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promptType: promptAssistantTarget.startsWith('chat.') ? 'chat' : 'voice',
            fieldLabel: getPromptFieldLabel(promptAssistantTarget),
            currentValue,
            request,
          }),
        })
      );
      const payload = response.payload;
      if (!response.ok || !payload) {
        throw new Error(payload?.message ?? parsePayloadError(response));
      }
      setPromptAssistantMessage(payload.assistant_message?.trim() || 'Draft ready. Review it before applying.');
      setPromptAssistantDraft(payload.drafted_value?.trim() || currentValue);
    } catch (caughtError) {
      setPromptAssistantMessage(caughtError instanceof Error ? caughtError.message : 'Prompt assistant request failed.');
    } finally {
      setPromptAssistantBusy(false);
    }
  }

  function applyAssistantAction(): void {
    if (!assistantPendingAction?.entry) return;

    if (assistantPendingAction.type === 'add') {
      setItems((previous) => [
        {
          question: assistantPendingAction.entry?.question ?? '',
          answer: assistantPendingAction.entry?.answer ?? '',
        },
        ...previous,
      ]);
      pushAssistantMessage('assistant', 'Draft applied locally as a new FAQ entry. Save to push it to GoHighLevel.');
      setAssistantPendingAction(null);
      setAssistantPendingJumpIndex(0);
      window.setTimeout(() => scrollToItem(0), 40);
      return;
    }

    if (assistantPendingAction.type === 'update' && assistantPendingAction.target_index !== null) {
      const targetIndex = assistantPendingAction.target_index;
      setItems((previous) =>
        previous.map((item, index) => {
          if (index !== targetIndex) return item;
          return {
            ...item,
            question: assistantPendingAction.entry?.question ?? item.question,
            answer: assistantPendingAction.entry?.answer ?? item.answer,
          };
        })
      );
      pushAssistantMessage('assistant', `Draft applied locally to FAQ #${targetIndex + 1}. Save to push it to GoHighLevel.`);
      setAssistantPendingAction(null);
      setAssistantPendingJumpIndex(targetIndex);
      window.setTimeout(() => scrollToItem(targetIndex), 40);
    }
  }

  function applyPromptAssistantDraft(): void {
    if (!promptAssistantDraft.trim()) return;
    setAgentPrompts((current) => setPromptFieldValue(current, promptAssistantTarget, promptAssistantDraft));
    setPromptAssistantMessage(`${getPromptFieldLabel(promptAssistantTarget)} draft applied locally. Save to push it to GoHighLevel.`);
  }

  const assistantMatchCount = assistantPendingJumpIndex !== null ? 1 : 0;

  return (
    <main className="bg-slate-50 pb-20 pt-28">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 sm:px-6 lg:px-8">
        <section className={`${cardClass} flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between`}>
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700">
              <Database className="h-4 w-4" />
              GoHighLevel Training Data
            </div>
            <div>
              <h1 className="text-3xl font-semibold text-gray-900">GHL Knowledge Base Editor</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                This page edits the live GoHighLevel knowledge base and the live website chat and voice prompts. Load from GHL, make changes manually or with the assistant, then save them back.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
              <span className="rounded-full bg-gray-100 px-3 py-1">Knowledge bases: {knowledgeBases.length}</span>
              <span className="rounded-full bg-gray-100 px-3 py-1">FAQs loaded: {items.length}</span>
              <span className={`rounded-full px-3 py-1 ${dirty ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                {dirty ? 'Unsaved changes' : 'In sync with current load'}
              </span>
              {locationId ? <span className="rounded-full bg-gray-100 px-3 py-1">Location: {locationId}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/admin"
              className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
            >
              Back To Admin
            </a>
            <a
              href="https://app.gohighlevel.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
            >
              Open GHL
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section className={cardClass}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="grid flex-1 gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                Knowledge Base
                <select
                  value={selectedKnowledgeBaseId}
                  onChange={(event) => void switchKnowledgeBase(event.target.value)}
                  className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {knowledgeBases.length === 0 ? <option value="">No knowledge bases found</option> : null}
                  {knowledgeBases.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                Filter FAQs
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Search questions or answers"
                  className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void refreshFromGhl()}
                disabled={loading || saving}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Sync From GHL
              </button>
              <button
                type="button"
                onClick={addItem}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                <Plus className="h-4 w-4" />
                Add FAQ
              </button>
              <button
                type="button"
                onClick={() => void saveChanges()}
                disabled={saving || loading || !dirty}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save To GHL
              </button>
            </div>
          </div>

          {message ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p> : null}
          {error ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          {selectedKnowledgeBase ? (
            <p className="mt-4 text-sm text-gray-600">
              Editing <span className="font-semibold text-gray-900">{selectedKnowledgeBase.name}</span>. FAQ and prompt changes stay local until you click <span className="font-semibold">Save To GHL</span>.
            </p>
          ) : null}
        </section>

        <section className={`${cardClass} space-y-6`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Agent Prompts</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
                Use this section for manual prompt editing. Use Prompt Assistant below when you want an AI rewrite before you apply the change.
              </p>
            </div>
            {lastPromptBackup ? (
              <button
                type="button"
                onClick={restorePromptBackup}
                className="inline-flex h-fit items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
              >
                Restore Last Prompt Backup
              </button>
            ) : null}
          </div>

          {!agentPrompts ? (
            <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-10 text-sm text-gray-500">
              Agent prompts have not loaded yet. Use Sync From GHL.
            </div>
          ) : (
            <>
              <div className="grid gap-6 xl:grid-cols-2">
                <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-white px-2 py-1 font-semibold text-gray-700">Website Chat</span>
                    <span className="rounded-full bg-white px-2 py-1">ID: {agentPrompts.chatAgent.agentId}</span>
                    <span className="rounded-full bg-white px-2 py-1">KBs: {agentPrompts.chatAgent.knowledgeBaseIds.length}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-gray-900">{agentPrompts.chatAgent.name || 'Conversation AI Agent'}</h3>
                  <p className="mt-1 text-sm text-gray-600">This is the live Conversation AI config used by the website chat widget.</p>
                  <div className="mt-4 space-y-4">
                    {([
                      { key: 'chat.goal', label: 'Goal' },
                      { key: 'chat.personality', label: 'Personality' },
                      { key: 'chat.instructions', label: 'Instructions' },
                    ] as Array<{ key: PromptFieldKey; label: string }>).map((field) => (
                      <div key={field.key} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{field.label}</p>
                            <p className="mt-1 text-sm text-gray-600">{previewPromptText(getPromptFieldValue(agentPrompts, field.key), field.key === 'chat.instructions' ? 280 : 180)}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPromptAssistantTarget(field.key);
                                setPromptAssistantDraft('');
                                setPromptAssistantMessage('');
                              }}
                              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                            >
                              Rewrite With Assistant
                            </button>
                            <button
                              type="button"
                              onClick={() => setManualPromptEditorField((current) => (current === field.key ? null : field.key))}
                              className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              {manualPromptEditorField === field.key ? 'Hide Manual Editor' : 'Edit Manually'}
                            </button>
                          </div>
                        </div>
                        {manualPromptEditorField === field.key ? (
                          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-gray-700">
                            Manual edit
                            <textarea
                              value={getPromptFieldValue(agentPrompts, field.key)}
                              onChange={(event) => updatePromptField(field.key, event.target.value)}
                              rows={field.key === 'chat.instructions' ? 14 : 5}
                              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-slate-50 p-5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span className="rounded-full bg-white px-2 py-1 font-semibold text-gray-700">Voice AI</span>
                    <span className="rounded-full bg-white px-2 py-1">ID: {agentPrompts.voiceAgent.agentId}</span>
                    {agentPrompts.voiceAgent.timezone ? <span className="rounded-full bg-white px-2 py-1">TZ: {agentPrompts.voiceAgent.timezone}</span> : null}
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-gray-900">{agentPrompts.voiceAgent.agentName || 'Voice Agent'}</h3>
                  <p className="mt-1 text-sm text-gray-600">Business: {agentPrompts.voiceAgent.businessName || 'Steam Zone'}</p>
                  <div className="mt-4 space-y-4">
                    {([
                      { key: 'voice.welcomeMessage', label: 'Welcome Message' },
                      { key: 'voice.agentPrompt', label: 'Agent Prompt' },
                    ] as Array<{ key: PromptFieldKey; label: string }>).map((field) => (
                      <div key={field.key} className="rounded-xl border border-gray-200 bg-white p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-gray-900">{field.label}</p>
                            <p className="mt-1 text-sm text-gray-600">{previewPromptText(getPromptFieldValue(agentPrompts, field.key), field.key === 'voice.agentPrompt' ? 280 : 180)}</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setPromptAssistantTarget(field.key);
                                setPromptAssistantDraft('');
                                setPromptAssistantMessage('');
                              }}
                              className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                            >
                              Rewrite With Assistant
                            </button>
                            <button
                              type="button"
                              onClick={() => setManualPromptEditorField((current) => (current === field.key ? null : field.key))}
                              className="inline-flex items-center rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                            >
                              {manualPromptEditorField === field.key ? 'Hide Manual Editor' : 'Edit Manually'}
                            </button>
                          </div>
                        </div>
                        {manualPromptEditorField === field.key ? (
                          <label className="mt-4 flex flex-col gap-2 text-sm font-medium text-gray-700">
                            Manual edit
                            <textarea
                              value={getPromptFieldValue(agentPrompts, field.key)}
                              onChange={(event) => updatePromptField(field.key, event.target.value)}
                              rows={field.key === 'voice.agentPrompt' ? 18 : 4}
                              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            />
                          </label>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Bot className="h-5 w-5 text-blue-600" />
                  Prompt Assistant
                </div>
                <p className="mt-2 text-sm leading-6 text-gray-600">
                  Draft changes for any live prompt field, review the rewrite, then apply the draft back into the manual field before saving to GHL.
                </p>
                <div className="mt-4 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
                  <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                    Target Field
                    <select
                      value={promptAssistantTarget}
                      onChange={(event) => {
                        setPromptAssistantTarget(event.target.value as PromptFieldKey);
                        setPromptAssistantDraft('');
                        setPromptAssistantMessage('');
                      }}
                      className="rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    >
                      {promptFieldOptions.map((entry) => (
                        <option key={entry.value} value={entry.value}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                    Change Request
                    <textarea
                      value={promptAssistantInput}
                      onChange={(event) => setPromptAssistantInput(event.target.value)}
                      placeholder="Example: Make this shorter, keep the serviceType mapping exact, and make the tone more direct."
                      rows={4}
                      className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => void runPromptAssistant()}
                    disabled={promptAssistantBusy || !agentPrompts}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                  >
                    {promptAssistantBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    Draft Rewrite
                  </button>
                  {promptAssistantDraft ? (
                    <button
                      type="button"
                      onClick={applyPromptAssistantDraft}
                      className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                    >
                      Apply Draft
                    </button>
                  ) : null}
                </div>
                {promptAssistantMessage ? (
                  <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{promptAssistantMessage}</p>
                ) : null}
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                    Current Value
                    <textarea
                      value={getPromptFieldValue(agentPrompts, promptAssistantTarget)}
                      readOnly
                      rows={10}
                      className="w-full rounded-xl border border-gray-200 bg-slate-50 px-4 py-3 font-mono text-sm text-gray-700"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                    Drafted Value
                    <textarea
                      value={promptAssistantDraft}
                      onChange={(event) => setPromptAssistantDraft(event.target.value)}
                      rows={10}
                      placeholder="Assistant draft will appear here."
                      className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 font-mono text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className={`${cardClass} h-fit`}>
            <div className="flex items-center gap-2 text-lg font-semibold text-gray-900">
              <Bot className="h-5 w-5 text-blue-600" />
              AI Training Assistant
            </div>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              Use the same assistant pattern as the local training editor. It can search, draft edits, and propose new FAQ entries against the currently loaded GHL data.
            </p>

            <div className="mt-4 max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-gray-200 bg-slate-50 p-4">
              {assistantMessages.map((entry) => (
                <div
                  key={entry.id}
                  className={`rounded-2xl px-4 py-3 text-sm leading-6 ${entry.role === 'assistant' ? 'bg-white text-gray-700' : 'ml-auto max-w-[90%] bg-blue-600 text-white'}`}
                >
                  {entry.content}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <textarea
                value={assistantInput}
                onChange={(event) => setAssistantInput(event.target.value)}
                placeholder="Example: Update the phone-number FAQ so it says customers can call (236) 506-6570."
                rows={4}
                className="w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
              />
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void runAssistant()}
                  disabled={assistantBusy || loading || items.length === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
                >
                  {assistantBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                  Ask Assistant
                </button>
                {assistantPendingJumpIndex !== null ? (
                  <button
                    type="button"
                    onClick={() => scrollToItem(assistantPendingJumpIndex)}
                    className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:border-gray-400 hover:text-gray-900"
                  >
                    Jump To Match
                  </button>
                ) : null}
                {assistantPendingAction?.type && assistantPendingAction.type !== 'none' ? (
                  <button
                    type="button"
                    onClick={applyAssistantAction}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                  >
                    Apply Draft
                  </button>
                ) : null}
              </div>
              {assistantPendingAction?.type && assistantPendingAction.type !== 'none' ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Proposed action: <span className="font-semibold">{assistantPendingAction.type}</span>
                  {assistantPendingAction.target_index !== null ? ` on FAQ #${assistantPendingAction.target_index + 1}` : ''}. {assistantPendingAction.reason}
                </div>
              ) : null}
              {assistantMatchCount > 0 ? <p className="text-xs text-gray-500">Assistant match ready. Use “Jump To Match” to inspect the target row.</p> : null}
            </div>
          </div>

          <div className={`${cardClass} min-h-[560px]`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">FAQ Entries</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Edit rows directly here. Existing GHL FAQ IDs are preserved and deleted rows are removed on save.
                </p>
              </div>
              <div className="text-sm text-gray-500">Showing {filteredItems.length} of {items.length}</div>
            </div>

            <div className="mt-6 space-y-4">
              {filteredItems.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500">
                  {items.length === 0 ? 'No FAQs are loaded for this knowledge base yet.' : 'No rows match the current filter.'}
                </div>
              ) : null}

              {filteredItems.map(({ item, index }) => {
                const highlighted = assistantHighlightIndex === index;
                return (
                  <div
                    key={item.id ?? `draft-${index}`}
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                    className={`rounded-2xl border p-4 transition ${highlighted ? 'border-blue-400 bg-blue-50/60 shadow-sm' : 'border-gray-200 bg-slate-50'}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                        <span className="rounded-full bg-white px-2 py-1 font-semibold text-gray-700">FAQ #{index + 1}</span>
                        {item.id ? <span className="rounded-full bg-white px-2 py-1">ID: {item.id}</span> : <span className="rounded-full bg-white px-2 py-1">New row</span>}
                        {item.updatedAt ? <span className="rounded-full bg-white px-2 py-1">Updated: {new Date(item.updatedAt).toLocaleString()}</span> : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(index)}
                        className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>

                    <div className="mt-4 grid gap-4">
                      <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                        Question
                        <textarea
                          value={item.question}
                          onChange={(event) => updateItem(index, { question: event.target.value })}
                          rows={2}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                      <label className="flex flex-col gap-2 text-sm font-medium text-gray-700">
                        Answer
                        <textarea
                          value={item.answer}
                          onChange={(event) => updateItem(index, { answer: event.target.value })}
                          rows={5}
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                        />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
