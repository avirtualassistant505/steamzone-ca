import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
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
  session_id?: string;
  assistant_message: string;
  state: AgentState;
  quote?: QuotePayload;
  done: boolean;
  finalize?: {
    done: boolean;
    already_finalized: boolean;
    quote_hash: string | null;
    quote_number: string | null;
    record_id: string | null;
    email_message: string | null;
    email_success: boolean | null;
  };
  next_question?: {
    key?: string;
    question_text?: string;
    input_ui_hint?: InputUiHint;
  };
}

interface ResetResponse {
  session_id: string;
  deleted: boolean;
  storage_mode: 'database' | 'memory_fallback';
  message: string;
}

type SupportedChannel = 'web' | 'voice' | 'sms' | 'test';
type SendMessageOptions = {
  silentUserBubble?: boolean;
  channel?: SupportedChannel;
  sessionId?: string;
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionLikeErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionLikeEvent) => void) | null;
  stop: () => void;
  abort: () => void;
  start: () => void;
}

interface SpeechRecognitionLikeEvent {
  results: {
    length: number;
    [index: number]: {
      [index: number]: {
        transcript: string;
      };
    };
  };
}

interface SpeechRecognitionLikeErrorEvent {
  error?: string;
}

interface WindowWithSpeechApi extends Window {
  SpeechRecognition?: {
    prototype: SpeechRecognitionLike;
    new (): SpeechRecognitionLike;
  };
  webkitSpeechRecognition?: {
    prototype: SpeechRecognitionLike;
    new (): SpeechRecognitionLike;
  };
}

function getSpeechRecognitionCtor(): {
  prototype: SpeechRecognitionLike;
  new (): SpeechRecognitionLike;
} | null {
  const win = window as unknown as WindowWithSpeechApi;
  if (win.SpeechRecognition) {
    return win.SpeechRecognition;
  }
  if (win.webkitSpeechRecognition) {
    return win.webkitSpeechRecognition;
  }
  return null;
}

const SESSION_STORAGE_KEY = 'steamzone_estimate_bot_lab_session_id';
const VOICE_SESSION_STORAGE_KEY = 'steamzone_estimate_bot_lab_voice_session_id';
const WARM_OPENER = 'Hello';

const ESTIMATE_INTENT_REGEX = /\b(estimate|quote|pricing|price|cost|book|booking|schedule|appointment)\b/i;

function sanitizeMessageText(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/(\d+)to(\d+)/gi, '$1 to $2')
    .replace(/\bunder(\d{3,5})/gi, 'under $1')
    .replace(/\bover(\d{3,5})/gi, 'over $1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeAssistantText(text: string): string {
  const sanitized = sanitizeMessageText(text);
  if (sanitized) {
    return sanitized;
  }

  const fallback = text.trim();
  if (fallback) {
    return sanitizeMessageText(fallback);
  }

  return 'Sorry, I am ready for your next message.';
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

function readSessionId(storageKey: string): string {
  if (typeof window === 'undefined') return newSessionId();
  const existing = window.localStorage.getItem(storageKey)?.trim();
  if (existing) return existing;
  const id = newSessionId();
  window.localStorage.setItem(storageKey, id);
  return id;
}

function saveSessionId(storageKey: string, id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, id);
}

async function resetPostagentSession(sessionId?: string): Promise<boolean> {
  const target = sessionId?.trim() ?? '';
  if (!target) {
    return true;
  }

  try {
    const response = await fetch('/api/postagent/reset', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ session_id: target }),
    });
    const parsed = await parseJsonResponse<ResetResponse>(response);
    if (!parsed.ok || !response.ok || !parsed.payload) {
      return false;
    }
    return parsed.payload.deleted;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function speechRecognitionErrorMessage(errorCode: string): string {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked. Allow microphone permission in Chrome site settings, then start voice mode again.';
    case 'audio-capture':
      return 'No microphone was detected. Connect a microphone and try voice mode again.';
    case 'network':
      return 'Speech recognition had a network issue. Please try voice mode again.';
    default:
      return 'Voice recognition could not start. Try again or use text mode.';
  }
}

function getPreThinkingDelayMs(inputText: string, isVoiceTurn: boolean): number {
  if (!isVoiceTurn) {
    return 0;
  }

  const normalizedLength = inputText.trim().length;
  if (!normalizedLength) {
    return 400;
  }

  const baseDelay = 300;
  const sizeDelay = Math.min(normalizedLength * 12, 550);
  const jitter = Math.floor(Math.random() * 200);
  return baseDelay + sizeDelay + jitter;
}

function getResponseDelayMs(replyText: string, isVoiceTurn: boolean): number {
  if (isVoiceTurn) {
    const length = replyText.trim().length;
    if (length <= 120) {
      return 5000;
    }

    if (length <= 240) {
      return 7000;
    }

    return 10000;
  }

  const length = replyText.trim().length;
  if (length <= 120) {
    return 250;
  }

  if (length <= 240) {
    return 450;
  }

  return 800;
}

export default function EstimateBotLabPage() {
  const [sessionId, setSessionId] = useState<string>(() => readSessionId(SESSION_STORAGE_KEY));
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
  const [finalizeStatus, setFinalizeStatus] = useState('');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [hasUserTurn, setHasUserTurn] = useState(false);
  const [estimateEngaged, setEstimateEngaged] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [typingTick, setTypingTick] = useState(0);
  const [isVoiceCallActive, setIsVoiceCallActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const requestSequenceRef = useRef(0);
  const sessionIdRef = useRef(sessionId);
  const activeRequestRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const speechRecognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const voiceSessionIdRef = useRef<string>(readSessionId(VOICE_SESSION_STORAGE_KEY));
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioAbortRef = useRef<AbortController | null>(null);
  const finalizedSessionRef = useRef<Set<string>>(new Set());
  const isBusyRef = useRef(false);
  const isVoiceCallActiveRef = useRef(false);
  const isSpeechRecognitionSupported =
    typeof window !== 'undefined' && getSpeechRecognitionCtor() !== null;
  const isSpeechSynthesisSupported =
    typeof window !== 'undefined' &&
    typeof window.speechSynthesis === 'object' &&
    typeof window.speechSynthesis.speak === 'function';
  const isAudioPlaybackSupported = typeof window !== 'undefined' && typeof Audio !== 'undefined';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, isBusy, typingTick]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

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

  useEffect(() => {
    isBusyRef.current = isBusy;
    isVoiceCallActiveRef.current = isVoiceCallActive;
  }, [isBusy, isVoiceCallActive]);

  useEffect(() => {
    if (!isVoiceCallActive && isListening) {
      stopListening();
    }
  }, [isListening, isVoiceCallActive]);

  function stopListening(): void {
    const recognition = speechRecognitionRef.current;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onend = null;
    recognition.onerror = null;
    try {
      recognition.stop();
    } catch {
      try {
        recognition.abort();
      } catch {
        // Ignore.
      }
    }
    speechRecognitionRef.current = null;
    setIsListening(false);
  }

  function startListening(): void {
    if (!isSpeechRecognitionSupported || !isVoiceCallActiveRef.current || isBusyRef.current) {
      return;
    }

    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    try {
      const recognition = new Ctor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 3;
      recognition.continuous = false;
      recognition.onstart = () => {
        setIsListening(true);
      };
      recognition.onerror = (event: SpeechRecognitionLikeErrorEvent) => {
        setIsListening(false);
        const errorCode = typeof event?.error === 'string' ? event.error : '';
        if (errorCode && errorCode !== 'aborted' && errorCode !== 'no-speech') {
          setErrorMessage(speechRecognitionErrorMessage(errorCode));
        }
        if (errorCode === 'not-allowed' || errorCode === 'service-not-allowed' || errorCode === 'audio-capture') {
          setIsVoiceCallActive(false);
          stopListening();
        }
      };
      recognition.onresult = (event: SpeechRecognitionLikeEvent) => {
        const lastResult = event.results[event.results.length - 1];
        const transcript = (lastResult?.[0]?.transcript ?? '').trim();
        if (!transcript) return;
        setInput(transcript);
        setIsListening(false);
        stopListening();
        void sendMessage(transcript, { channel: 'voice' });
      };
      recognition.onend = () => {
        setIsListening(false);
        if (isVoiceCallActiveRef.current && !isBusyRef.current) {
          window.setTimeout(() => {
            startListening();
          }, 250);
        }
      };
      speechRecognitionRef.current = recognition;
      recognition.start();
    } catch {
      setIsListening(false);
      setErrorMessage('Voice recognition could not start. Please check microphone permissions and try again.');
      setIsVoiceCallActive(false);
    }
  }

  async function speakText(text: string): Promise<void> {
    const safeText = text.trim();
    if (!safeText) return;
    stopSpeaking();
    setIsSpeaking(true);
    const controller = new AbortController();
    audioAbortRef.current = controller;

    try {
      const response = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          text: safeText,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || `Voice synthesis failed (${response.status}).`);
      }

      const voiceBlob = await response.blob();
      if (!isAudioPlaybackSupported) {
        throw new Error('Audio playback is not available in this browser.');
      }

      const objectUrl = URL.createObjectURL(voiceBlob);
      await new Promise<void>((resolve) => {
        const audio = new Audio(objectUrl);
        activeAudioRef.current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
      URL.revokeObjectURL(objectUrl);
      activeAudioRef.current = null;
    } catch {
      // Fallback: browser speech synthesis if server voice model is unavailable.
      if (isSpeechSynthesisSupported) {
        await new Promise<void>((resolve) => {
          const utterance = new window.SpeechSynthesisUtterance(safeText);
          utterance.rate = 1.02;
          utterance.pitch = 1;
          utterance.volume = 1;
          utterance.lang = 'en-US';
          utterance.onend = () => resolve();
          utterance.onerror = () => resolve();
          window.speechSynthesis.speak(utterance);
          window.setTimeout(resolve, Math.max(700, Math.min(12000, safeText.length * 80)));
        });
      }
    } finally {
      if (audioAbortRef.current === controller) {
        audioAbortRef.current = null;
      }
      setIsSpeaking(false);
    }
  }

  function stopSpeaking(): void {
    if (audioAbortRef.current) {
      audioAbortRef.current.abort();
      audioAbortRef.current = null;
    }
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.currentTime = 0;
      activeAudioRef.current = null;
    }
    if (isSpeechSynthesisSupported) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }

  async function sendMessage(
    userText: string,
    options?: SendMessageOptions
  ): Promise<void> {
    const requestId = ++requestSequenceRef.current;
    const trimmed = userText.trim();
    if (!trimmed && !options?.silentUserBubble) {
      return;
    }

    setErrorMessage('');
    setIsBusy(true);
    stopSpeaking();
    stopListening();
    if (activeRequestRef.current) {
      activeRequestRef.current.abort();
    }
    const requestController = new AbortController();
    activeRequestRef.current = requestController;
    const startedAt = Date.now();
    const requestedChannel =
      options?.channel === 'voice' || options?.channel === 'test' || options?.channel === 'sms'
        ? options.channel
        : 'web';
    const isVoiceTurn = requestedChannel === 'voice' || requestedChannel === 'test';
    const preThinkingMs = getPreThinkingDelayMs(trimmed, isVoiceTurn);
    const explicitSessionId = typeof options?.sessionId === 'string' ? options.sessionId.trim() : '';
    const effectiveSessionId = explicitSessionId || (isVoiceTurn ? voiceSessionIdRef.current : sessionIdRef.current);
    if (!effectiveSessionId) {
      throw new Error('Missing session id for message.');
    }

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
          session_id: effectiveSessionId,
          input_text: trimmed || WARM_OPENER,
          channel: requestedChannel,
          turn_id: newMessageId(),
          metadata: {
            request_id: requestId,
          },
        }),
        signal: requestController.signal,
      });

      if (preThinkingMs > 0) {
        await sleep(preThinkingMs);
        setIsThinking(true);
      }

      const response = await responsePromise;
      const parsed = await parseJsonResponse<AgentResponse & { message?: string }>(response);
      const payload = parsed.payload;
      if (!parsed.ok || !response.ok || !payload) {
        throw new Error(parsed.textError ?? payload?.message ?? 'Unable to reach estimate agent.');
      }

      if (requestId !== requestSequenceRef.current || requestController.signal.aborted) {
        return;
      }

      const expectedSessionId = isVoiceTurn ? voiceSessionIdRef.current : sessionIdRef.current;
      if (payload.session_id && payload.session_id !== expectedSessionId) {
        setSessionId(payload.session_id);
        saveSessionId(SESSION_STORAGE_KEY, payload.session_id);
      }

      const assistantText = normalizeAssistantText(payload.assistant_message);
      const elapsedMs = Date.now() - startedAt;
      const delayMs = Math.max(0, getResponseDelayMs(assistantText, isVoiceTurn) - elapsedMs);
      const cappedDelayMs = isVoiceTurn ? delayMs : Math.min(delayMs, 900);
      if (cappedDelayMs > 0) {
        await sleep(cappedDelayMs);
      }

      setMessages((prev) => [...prev, { id: newMessageId(), role: 'assistant', content: assistantText }]);
      setState(payload.state);
      setQuote(payload.quote ?? null);
      setDone(Boolean(payload.done));
      setHint(payload.next_question?.input_ui_hint ?? null);
      setLastQuestionText(payload.next_question?.question_text ?? '');
      if (payload.state?.answers?.serviceType || payload.done || payload.quote) {
        setEstimateEngaged(true);
      }

      if (payload.finalize) {
        setFinalizeStatus(
          payload.finalize.email_message
            ? payload.finalize.email_message
            : payload.finalize.done
              ? 'Estimate finalized.'
              : 'Estimate is ready. Finalization is pending.'
        );
      }

      if (isVoiceTurn && payload?.session_id) {
        voiceSessionIdRef.current = payload.session_id;
        saveSessionId(VOICE_SESSION_STORAGE_KEY, payload.session_id);
      }

      if (!isVoiceTurn && payload?.session_id && payload.session_id !== sessionIdRef.current) {
        setSessionId(payload.session_id);
        saveSessionId(SESSION_STORAGE_KEY, payload.session_id);
      }

      if (isVoiceCallActiveRef.current && (requestedChannel === 'voice' || requestedChannel === 'test')) {
        await speakText(assistantText);
        if (isVoiceCallActiveRef.current && !payload.done) {
          window.setTimeout(() => {
            startListening();
          }, 350);
        }
      }

      if (!isVoiceTurn && payload.done && payload.quote && payload.session_id && !payload.finalize) {
        if (!finalizedSessionRef.current.has(payload.session_id)) {
          finalizedSessionRef.current.add(payload.session_id);
          void finalizeQuoteEmail(payload.quote, payload.session_id);
        }
      }

      if (requestId !== requestSequenceRef.current || requestController.signal.aborted) {
        return;
      }
    } catch (error) {
      if (error instanceof DOMException || requestController.signal.aborted) {
        return;
      }

      const fallback =
        error instanceof Error
          ? error.message
          : 'Unable to reach estimate agent.';

      setErrorMessage(fallback);
      const spokenFallback = sanitizeMessageText(
        `Call failed: ${fallback}`
      );
      setMessages((prev) => [...prev, { id: newMessageId(), role: 'assistant', content: spokenFallback }]);

      if (isVoiceCallActiveRef.current && (requestedChannel === 'voice' || requestedChannel === 'test')) {
        await speakText(spokenFallback);
      }
    } finally {
      setIsThinking(false);
      setIsBusy(false);
      if (activeRequestRef.current === requestController) {
        activeRequestRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (messages.length === 0 && !isBusy) {
      void sendMessage(WARM_OPENER, { silentUserBubble: true, channel: 'web' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (isBusy) return;
    const value = input;
    setInput('');
    void sendMessage(value, { channel: isVoiceCallActive ? 'voice' : 'web' });
  }

  async function startOver(): Promise<void> {
    requestSequenceRef.current += 1;
    if (activeRequestRef.current) {
      activeRequestRef.current.abort();
      activeRequestRef.current = null;
    }

    const priorSessionId = sessionIdRef.current;
    const priorVoiceSessionId = voiceSessionIdRef.current;
    await Promise.all([resetPostagentSession(priorSessionId), resetPostagentSession(priorVoiceSessionId)]).catch(() => {
      // Ignore reset failures for local start-over.
    });

    const id = newSessionId();
    const voiceId = newSessionId();

    saveSessionId(SESSION_STORAGE_KEY, id);
    setSessionId(id);
    voiceSessionIdRef.current = voiceId;
    saveSessionId(VOICE_SESSION_STORAGE_KEY, voiceId);
    setMessages([]);
    setInput('');
    setErrorMessage('');
    setState(null);
    setQuote(null);
    setDone(false);
    setHint(null);
    setLastQuestionText('');
    setCopyStatus('');
    setFinalizeStatus('');
    setIsFinalizing(false);
    setIsBusy(false);
    setIsThinking(false);
    finalizedSessionRef.current.delete(sessionId);
    finalizedSessionRef.current.delete(id);
    setHasUserTurn(false);
    setEstimateEngaged(false);
    setIsVoiceCallActive(false);
    stopListening();
    stopSpeaking();
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

  async function finalizeQuoteEmail(
    inputQuote?: QuotePayload,
    inputSessionId?: string
  ): Promise<void> {
    const currentQuote = inputQuote ?? quote;
    const currentSessionId = inputSessionId ?? sessionId;
    if (!currentQuote || !currentSessionId || isFinalizing) {
      return;
    }

    setFinalizeStatus('');
    setIsFinalizing(true);
    try {
      const response = await fetch('/api/postagent/finalize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          session_id: currentSessionId,
          send_email: true,
        }),
      });
      const parsed = await parseJsonResponse<{ message?: string; quote_number?: string; email?: { message?: string } }>(
        response
      );
      if (!parsed.ok || !response.ok || !parsed.payload) {
        throw new Error(parsed.textError ?? parsed.payload?.message ?? 'Unable to finalize quote.');
      }

      const emailMessage = parsed.payload.email?.message ?? '';
      const quoteNumber = parsed.payload.quote_number ?? '';
      setFinalizeStatus(
        quoteNumber
          ? `Finalized as ${quoteNumber}. ${emailMessage || 'Quote email has been sent.'}`
          : emailMessage || 'Quote email has been sent.'
      );
    } catch (error) {
      setFinalizeStatus(error instanceof Error ? error.message : 'Unable to finalize quote.');
      if (currentSessionId) {
        finalizedSessionRef.current.delete(currentSessionId);
      }
    } finally {
      setIsFinalizing(false);
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
  const displayedSessionId = isVoiceCallActive ? voiceSessionIdRef.current : sessionId;

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
              onClick={() => {
                void startOver();
              }}
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
                      void sendMessage(action.value, { channel: isVoiceCallActive ? 'voice' : 'web' });
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
                onChange={(event: ChangeEvent<HTMLInputElement>) => setInput(event.target.value)}
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
                <p className="mt-1 break-all text-xs text-gray-600">{displayedSessionId}</p>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900">Mode</h2>
                <p className="mt-2 text-sm text-gray-700">Text chat mode</p>
                <p className="mt-1 text-xs text-gray-600">
                  Voice has moved to a dedicated realtime page so it stays fully separate from this text session.
                </p>
                <p className="sr-only">Legacy speaking state: {isSpeaking ? 'speaking' : 'idle'}</p>
                <a
                  href="/estimate-voice-lab"
                  className="mt-3 inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Open Realtime Voice Lab
                </a>
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

                <button
                  type="button"
                  onClick={() => {
                    void finalizeQuoteEmail();
                  }}
                  disabled={isFinalizing || !done}
                  className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isFinalizing ? 'Sending...' : 'Finalize & Email Quote'}
                </button>
                {finalizeStatus && <p className="mt-2 text-xs text-cyan-700">{finalizeStatus}</p>}
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
