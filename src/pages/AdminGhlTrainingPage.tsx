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

type GhlTrainingGetPayload = {
  locationId?: string;
  knowledgeBases?: KnowledgeBaseSummary[];
  selectedKnowledgeBaseId?: string;
  items?: GhlTrainingItem[];
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

type TrainingAssistantMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
};

const cardClass = 'rounded-2xl border border-gray-200 bg-white p-6 shadow-sm';

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

function itemMatchesFilter(item: GhlTrainingItem, filter: string): boolean {
  const normalizedFilter = filter.trim().toLowerCase();
  if (!normalizedFilter) return true;
  return `${item.question} ${item.answer}`.toLowerCase().includes(normalizedFilter);
}

export default function AdminGhlTrainingPage() {
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBaseSummary[]>([]);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [items, setItems] = useState<GhlTrainingItem[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
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

  useEffect(() => {
    const snapshot = JSON.stringify({ items: sanitizeItems(items), deletedIds: [...deletedIds].sort() });
    setDirty(loaded && snapshot !== savedSnapshotRef.current);
  }, [deletedIds, items, loaded]);

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
      setKnowledgeBases(nextKnowledgeBases);
      setSelectedKnowledgeBaseId(payload.selectedKnowledgeBaseId ?? nextKnowledgeBases[0]?.id ?? '');
      setItems(nextItems);
      setDeletedIds([]);
      setLocationId(payload.locationId ?? '');
      setLoaded(true);
      savedSnapshotRef.current = JSON.stringify({ items: sanitizeItems(nextItems), deletedIds: [] });
      setDirty(false);
      setMessage(payload.message ?? `Loaded ${nextItems.length} FAQ entries from GoHighLevel.`);
      setAssistantPendingAction(null);
      setAssistantPendingJumpIndex(null);
      setAssistantHighlightIndex(null);
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

    setSaving(true);
    setError('');
    setMessage('Saving GoHighLevel knowledge base changes...');

    try {
      const response = await parseJsonResponse<GhlTrainingSavePayload>(
        await fetch('/api/ghl-training-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            knowledgeBaseId: selectedKnowledgeBaseId,
            items: sanitizeItems(items),
            deletedIds,
          }),
        })
      );
      const payload = response.payload;
      if (!response.ok || !payload) {
        setError(payload?.message ?? parsePayloadError(response));
        setMessage('');
        return;
      }

      const refreshedItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(refreshedItems);
      setDeletedIds([]);
      savedSnapshotRef.current = JSON.stringify({ items: sanitizeItems(refreshedItems), deletedIds: [] });
      setDirty(false);
      setMessage(payload.message ?? 'GoHighLevel knowledge base saved.');
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
      setItems((previous) => previous.map((item, index) => {
        if (index !== targetIndex) return item;
        return {
          ...item,
          question: assistantPendingAction.entry?.question ?? item.question,
          answer: assistantPendingAction.entry?.answer ?? item.answer,
        };
      }));
      pushAssistantMessage('assistant', `Draft applied locally to FAQ #${targetIndex + 1}. Save to push it to GoHighLevel.`);
      setAssistantPendingAction(null);
      setAssistantPendingJumpIndex(targetIndex);
      window.setTimeout(() => scrollToItem(targetIndex), 40);
    }
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
                This page mirrors the website training editor, but the source of truth is the live GoHighLevel knowledge base. Load a knowledge base, edit FAQs manually or with the assistant, then save changes back to GHL.
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
              Editing <span className="font-semibold text-gray-900">{selectedKnowledgeBase.name}</span>. Changes stay local until you click <span className="font-semibold">Save To GHL</span>.
            </p>
          ) : null}
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
                  {items.length === 0
                    ? 'No FAQs are loaded for this knowledge base yet.'
                    : 'No rows match the current filter.'}
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
