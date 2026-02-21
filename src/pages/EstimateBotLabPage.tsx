import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RotateCcw, SendHorizonal } from 'lucide-react';
import { formatCurrency } from '../lib/estimateEngine';
import { parseJsonResponse } from '../lib/responseParsing';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

interface QuoteLineItem {
  label: string;
  amount: number;
}

interface QuotePayload {
  quote_id: string;
  total: number;
  currency: 'CAD';
  line_items: QuoteLineItem[];
  assumptions: string[];
  answers_echo: Record<string, unknown>;
  version: 'v1';
}

interface AgentState {
  answers: Record<string, unknown>;
  asked_keys: string[];
  last_question_key: string | null;
}

interface InputUiHint {
  type: string;
  options?: Array<{ value: string; label: string }>;
  min?: number;
  max?: number;
  placeholder?: string;
}

interface AgentResponse {
  assistant_message: string;
  state: AgentState;
  quote?: QuotePayload;
  done: boolean;
  next_question?: {
    key?: string;
    question_text?: string;
    input_ui_hint?: InputUiHint;
  };
}

const SESSION_STORAGE_KEY = 'steamzone_estimate_bot_lab_session_id';
const WARM_OPENER = 'Hello';

const ESTIMATE_INTENT_REGEX = /\b(estimate|quote|pricing|price|cost|book|booking|schedule|appointment)\b/i;

function sanitizeMessageText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/(\d{3,4})to(\d{3,4})/gi, '$1 to $2')
    .replace(/\bunder(\d{3,5})/gi, 'under $1')
    .replace(/\bover(\d{3,5})/gi, 'over $1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function hasEstimateIntent(input: string): boolean {
  return ESTIMATE_INTENT_REGEX.test(input);
}

function newMessageId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSessionId(): string {
  if (typeof window === 'undefined') return newSessionId();
  const existing = window.localStorage.getItem(SESSION_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const id = newSessionId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, id);
  return id;
}

function saveSessionId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SESSION_STORAGE_KEY, id);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function getPreThinkingDelayMs(inputText: string): number {
  const normalizedLength = inputText.trim().length;
  if (!normalizedLength) {
    return 400;
  }

  const baseDelay = 300;
  const sizeDelay = Math.min(normalizedLength * 12, 550);
  const jitter = Math.floor(Math.random() * 200);
  return baseDelay + sizeDelay + jitter;
}

function getResponseDelayMs(replyText: string): number {
  const length = replyText.trim().length;
  if (length <= 120) {
    return 5000;
  }

  if (length <= 240) {
    return 7000;
  }

  return 10000;
}

export default function EstimateBotLabPage() {
  const [sessionId, setSessionId] = useState<string>(() => readSessionId());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [state, setState] = useState<AgentState | null>(null);
  const [quote, setQuote] = useState<QuotePayload | null>(null);
  const [done, setDone] = useState(false);
  const [hint, setHint] = useState<InputUiHint | null>(null);
  const [lastQuestionText, setLastQuestionText] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const [hasUserTurn, setHasUserTurn] = useState(false);
  const [estimateEngaged, setEstimateEngaged] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [typingTick, setTypingTick] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isBusy, typingTick]);

  useEffect(() => {
    if (!isThinking) {
      setTypingTick(0);
      return;
    }

    const timer = window.setInterval(() => {
      setTypingTick((prev) => (prev + 1) % 4);
    }, 450);

    return () => {
      window.clearInterval(timer);
    };
  }, [isThinking]);

  async function sendMessage(userText: string, options?: { silentUserBubble?: boolean }): Promise<void> {
    const trimmed = userText.trim();
    if (!trimmed && !options?.silentUserBubble) {
      return;
    }

    setErrorMessage('');
    setIsBusy(true);
    const startedAt = Date.now();
    const preThinkingMs = getPreThinkingDelayMs(trimmed);

    if (!options?.silentUserBubble && trimmed) {
      setMessages((prev) => [...prev, { id: newMessageId(), role: 'user', content: trimmed }]);
      setHasUserTurn(true);
      if (hasEstimateIntent(trimmed)) {
        setEstimateEngaged(true);
      }
    }

    try {
      const responsePromise = fetch('/api/postagent/estimate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          input_text: trimmed || WARM_OPENER,
        }),
      });

      await sleep(preThinkingMs);
      setIsThinking(true);

      const response = await responsePromise;
      const parsed = await parseJsonResponse<AgentResponse & { message?: string }>(response);
      const payload = parsed.payload;
      if (!parsed.ok || !response.ok || !payload) {
        throw new Error(parsed.textError ?? payload?.message ?? 'Unable to reach estimate agent.');
      }

      const assistantText = sanitizeMessageText(payload.assistant_message);
      const thinkingDelay = Math.max(0, getResponseDelayMs(assistantText) - (Date.now() - startedAt));
      await sleep(thinkingDelay);

      setMessages((prev) => [...prev, { id: newMessageId(), role: 'assistant', content: assistantText }]);
      setState(payload.state);
      setQuote(payload.quote ?? null);
      setDone(Boolean(payload.done));
      setHint(payload.next_question?.input_ui_hint ?? null);
      setLastQuestionText(payload.next_question?.question_text ?? '');
      if (payload.state?.answers?.serviceType || payload.done || payload.quote) {
        setEstimateEngaged(true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to reach estimate agent.');
    } finally {
      setIsThinking(false);
      setIsBusy(false);
    }
  }

  useEffect(() => {
    if (messages.length === 0 && !isBusy) {
      void sendMessage(WARM_OPENER, { silentUserBubble: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function onSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isBusy) return;
    const value = input;
    setInput('');
    void sendMessage(value);
  }

  function startOver(): void {
    const id = newSessionId();
    saveSessionId(id);
    setSessionId(id);
    setMessages([]);
    setInput('');
    setErrorMessage('');
    setState(null);
    setQuote(null);
    setDone(false);
    setHint(null);
    setLastQuestionText('');
    setCopyStatus('');
    setHasUserTurn(false);
    setEstimateEngaged(false);
  }

  async function copyQuoteSummary(): Promise<void> {
    if (!quote) {
      setCopyStatus('No quote to copy yet.');
      return;
    }

    const answers = state?.answers ?? {};
    const answerLines = Object.entries(answers)
      .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`)
      .join('\n');

    const summary = [
      `Quote ID: ${quote.quote_id}`,
      `Total: ${formatCurrency(quote.total)}`,
      '',
      'Line items:',
      ...quote.line_items.map((item) => `- ${item.label}: ${formatCurrency(item.amount)}`),
      '',
      'Assumptions:',
      ...quote.assumptions.map((item) => `- ${item}`),
      '',
      'Answers:',
      answerLines,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus('Quote summary copied.');
    } catch {
      setCopyStatus('Unable to copy to clipboard.');
    }
  }

  const quickActions = useMemo(() => {
    if (!hint || isBusy || done || !estimateEngaged) return [] as Array<{ label: string; value: string }>;

    if (hint.type === 'boolean') {
      return [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ];
    }

    if (hint.type === 'select' && hint.options) {
      return hint.options.map((opt) => ({ label: opt.label, value: opt.value }));
    }

    return [] as Array<{ label: string; value: string }>;
  }, [done, estimateEngaged, hint, isBusy]);

  const showPrompt = hasUserTurn && estimateEngaged && !done && Boolean(lastQuestionText);
  const inputPlaceholder = estimateEngaged ? hint?.placeholder ?? 'Type your answer...' : 'Ask a question or request an estimate...';
  const statusLabel = done ? 'Complete' : estimateEngaged ? 'Collecting estimate details' : 'Waiting for your question';

  return (
    <main className="bg-gradient-to-br from-slate-50 via-cyan-50 to-white pb-20 pt-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Sandbox Route</p>
            <h1 className="text-3xl font-bold text-gray-900">Agentic Estimate Bot Lab</h1>
            <p className="mt-1 text-sm text-gray-600">New OpenAI-powered intake flow isolated from the existing estimate page and GHL bot.</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startOver}
              className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Start Over
            </button>
            <button
              type="button"
              onClick={() => {
                void copyQuoteSummary();
              }}
              className="inline-flex items-center rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100"
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy Quote Summary
            </button>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
            <div className="h-[56vh] overflow-y-auto rounded-xl border border-gray-100 bg-slate-50 p-3">
              {messages.length === 0 && (
                <p className="text-sm text-gray-500">Loading assistant...</p>
              )}

              <div className="space-y-3">
                {messages.map((message) => (
                  <div key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                        message.role === 'user' ? 'bg-cyan-600 text-white' : 'border border-gray-200 bg-white text-gray-800'
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>

              {isBusy && !isThinking && <p className="mt-3 text-xs text-gray-500">Preparing reply...</p>}
              {isThinking && (
                <p className="mt-2 text-xs text-gray-500" aria-live="polite" aria-atomic="true">
                  Assistant is typing
                  {Array.from({ length: typingTick + 1 }, () => '.').join('')}
                </p>
              )}
              <div ref={endRef} />
            </div>

            {showPrompt && (
              <p className="mt-3 text-xs text-gray-600">Current prompt: {lastQuestionText}</p>
            )}

            {quickActions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <button
                    key={`${action.label}:${action.value}`}
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      void sendMessage(action.value);
                    }}
                    className="rounded-full border border-cyan-300 bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-60"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-4 flex gap-2">
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={inputPlaceholder}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-200"
                disabled={isBusy}
              />
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                className="inline-flex items-center rounded-lg bg-cyan-600 px-4 py-2 font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
              >
                <SendHorizonal className="h-4 w-4" />
              </button>
            </form>

            {errorMessage && <p className="mt-2 text-sm text-rose-700">{errorMessage}</p>}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Session</h2>
              <p className="mt-1 break-all text-xs text-gray-600">{sessionId}</p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Status</h2>
              <p className="mt-2 text-sm text-gray-700">{statusLabel}</p>
              {copyStatus && <p className="mt-2 text-xs text-cyan-700">{copyStatus}</p>}
            </div>

            {quote && (
              <div className="rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">Quote</h2>
                <p className="mt-1 text-xs text-gray-500">{quote.quote_id}</p>
                <p className="mt-2 text-2xl font-bold text-cyan-800">{formatCurrency(quote.total)}</p>

                <ul className="mt-3 space-y-1 text-sm text-gray-700">
                  {quote.line_items.map((item) => (
                    <li key={`${item.label}-${item.amount}`} className="flex items-center justify-between gap-2">
                      <span>{item.label}</span>
                      <span className="font-semibold">{formatCurrency(item.amount)}</span>
                    </li>
                  ))}
                </ul>

                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">
                  {quote.assumptions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
