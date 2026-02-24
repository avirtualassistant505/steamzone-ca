import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Phone, PhoneOff, RotateCcw } from 'lucide-react';
import { parseJsonResponse } from '../lib/responseParsing';

type RealtimeStatus = 'idle' | 'connecting' | 'connected' | 'error';
type TranscriptRole = 'user' | 'assistant' | 'system';

interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  content: string;
}

interface PostagentResponse {
  session_id?: string;
  assistant_message: string;
  done?: boolean;
  state?: {
    answers?: Record<string, unknown>;
    asked_keys?: string[];
    last_question_key?: string | null;
  };
}

type RealtimeEventPayload = Record<string, unknown>;

const VOICE_SESSION_STORAGE_KEY = 'steamzone_estimate_voice_lab_session_id';

function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readVoiceSessionId(): string {
  if (typeof window === 'undefined') return newSessionId();
  const existing = window.localStorage.getItem(VOICE_SESSION_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const created = newSessionId();
  window.localStorage.setItem(VOICE_SESSION_STORAGE_KEY, created);
  return created;
}

function saveVoiceSessionId(sessionId: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(VOICE_SESSION_STORAGE_KEY, sessionId);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function parseApiErrorMessage(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const message = parsed?.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
  } catch {
    // Keep raw text when server did not return JSON.
  }
  return text;
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function extractTextFragments(record: Record<string, unknown>): string[] {
  const fragments: string[] = [];
  const directKeys = ['text', 'transcript', 'audio_transcript'];
  for (const key of directKeys) {
    const value = asString(record[key]).trim();
    if (value) fragments.push(value);
  }

  const maybeText = record.output_text;
  if (typeof maybeText === 'string' && maybeText.trim()) {
    fragments.push(maybeText.trim());
  }

  return uniqueNonEmpty(fragments);
}

function extractContentText(content: unknown[]): string {
  const chunks: string[] = [];
  for (const entry of content) {
    const record = asRecord(entry);
    if (!record) continue;
    chunks.push(...extractTextFragments(record));
  }
  return uniqueNonEmpty(chunks).join(' ').trim();
}

function extractAssistantTextFromItem(item: Record<string, unknown>): string {
  const role = asString(item.role).trim();
  if (role && role !== 'assistant') {
    return '';
  }

  const type = asString(item.type).trim();
  if (type && type !== 'message') {
    return '';
  }

  const content = Array.isArray(item.content) ? item.content : [];
  const contentText = extractContentText(content);
  if (contentText) {
    return contentText;
  }

  return uniqueNonEmpty(extractTextFragments(item)).join(' ').trim();
}

function extractAssistantText(event: Record<string, unknown>): string {
  const type = asString(event.type);

  if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
    const transcript = asString(event.transcript).trim();
    if (transcript) return transcript;
  }

  if (type === 'response.output_item.done' || type === 'conversation.item.created') {
    const item = asRecord(event.item);
    if (!item) return '';
    return extractAssistantTextFromItem(item);
  }

  if (type === 'response.done') {
    const response = asRecord(event.response);
    if (!response) return '';

    const output = Array.isArray(response.output) ? response.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      const record = asRecord(item);
      if (!record) continue;
      const itemText = extractAssistantTextFromItem(record);
      if (itemText) chunks.push(itemText);
    }
    const merged = uniqueNonEmpty(chunks).join(' ').trim();
    if (merged) return merged;
  }

  return '';
}

async function waitForIceGatheringComplete(peer: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (peer.iceGatheringState === 'complete') {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      peer.removeEventListener('icegatheringstatechange', onStateChange);
      window.clearTimeout(timeoutId);
      resolve();
    };
    const onStateChange = (): void => {
      if (peer.iceGatheringState === 'complete') {
        finish();
      }
    };
    const timeoutId = window.setTimeout(finish, timeoutMs);
    peer.addEventListener('icegatheringstatechange', onStateChange);
  });
}

function extractFunctionCall(event: Record<string, unknown>): { callId: string; name: string; argumentsText: string } | null {
  const type = asString(event.type);

  if (type === 'response.output_item.done') {
    const item = asRecord(event.item);
    if (!item) return null;
    if (asString(item.type) !== 'function_call') return null;
    return {
      callId: asString(item.call_id),
      name: asString(item.name),
      argumentsText: asString(item.arguments),
    };
  }

  if (type === 'response.done') {
    const response = asRecord(event.response);
    const output = Array.isArray(response?.output) ? response?.output : [];
    for (const entry of output) {
      const item = asRecord(entry);
      if (!item || asString(item.type) !== 'function_call') continue;
      return {
        callId: asString(item.call_id),
        name: asString(item.name),
        argumentsText: asString(item.arguments),
      };
    }
  }

  return null;
}

export default function EstimateVoiceLabPage() {
  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [connectionStage, setConnectionStage] = useState('Idle');
  const [isListening, setIsListening] = useState(false);
  const [sessionId, setSessionId] = useState<string>(() => readVoiceSessionId());
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [turnCount, setTurnCount] = useState(0);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingToolCallsRef = useRef<Set<string>>(new Set());
  const sessionIdRef = useRef(sessionId);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const connectionLabel = useMemo(() => {
    if (status === 'connecting') return 'Connecting...';
    if (status === 'connected' && isListening) return 'Connected, listening';
    if (status === 'connected') return 'Connected';
    if (status === 'error') return 'Connection failed';
    return 'Not connected';
  }, [isListening, status]);

  function appendTranscript(role: TranscriptRole, content: string): void {
    // Keep voice mode disconnected from chat transcript rendering.
    if (role !== 'system') return;
    const trimmed = content.trim();
    if (!trimmed) return;
    setTranscript((prev) => [...prev, { id: randomId(), role, content: trimmed }]);
  }

  function sendRealtimeEvent(event: RealtimeEventPayload): void {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== 'open') return;
    channel.send(JSON.stringify(event));
  }

  async function runPostagentTurn(userText: string): Promise<PostagentResponse> {
    const response = await fetch('/api/postagent/estimate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        session_id: sessionIdRef.current,
        input_text: userText,
        channel: 'voice',
      }),
    });

    const parsed = await parseJsonResponse<PostagentResponse & { message?: string }>(response);
    const payload = parsed.payload;
    if (!parsed.ok || !response.ok || !payload) {
      throw new Error(parsed.textError ?? payload?.message ?? 'Voice tool call failed.');
    }

    return payload;
  }

  async function handleToolCall(callId: string, name: string, argumentsText: string): Promise<void> {
    if (!callId || pendingToolCallsRef.current.has(callId)) {
      return;
    }
    pendingToolCallsRef.current.add(callId);
    let holdTimer: number | null = null;

    try {
      const args = parseJsonObject(argumentsText);

      if (name !== 'postagent_estimate_turn') {
        sendRealtimeEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({
              ok: false,
              message: `Unsupported tool: ${name}`,
            }),
          },
        });
        sendRealtimeEvent({ type: 'response.create' });
        return;
      }

      const userText = asString(args.user_text).trim();
      if (!userText) {
        sendRealtimeEvent({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify({
              ok: false,
              message: 'Tool call requires user_text.',
            }),
          },
        });
        sendRealtimeEvent({ type: 'response.create' });
        return;
      }

      holdTimer = window.setTimeout(() => {
        sendRealtimeEvent({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions: 'Say exactly: "One moment while I check that for you."',
          },
        });
      }, 3500);

      const turn = await runPostagentTurn(userText);
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      const assistantText = asString(turn.assistant_message).trim();
      if (assistantText) {
        appendTranscript('assistant', assistantText);
        setTurnCount((prev) => prev + 1);
      }

      sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({
            ok: true,
            session_id: sessionIdRef.current,
            assistant_message: turn.assistant_message,
            done: turn.done ?? false,
            state: turn.state ?? null,
          }),
        },
      });
      sendRealtimeEvent({ type: 'response.create' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed.';
      sendRealtimeEvent({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify({
            ok: false,
            message,
          }),
        },
      });
      sendRealtimeEvent({ type: 'response.create' });
      setErrorMessage(message);
      setStatus('error');
    } finally {
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
      }
      pendingToolCallsRef.current.delete(callId);
    }
  }

  function stopCall(options?: { preserveStatus?: boolean }): void {
    const dataChannel = dataChannelRef.current;
    if (dataChannel) {
      try {
        dataChannel.close();
      } catch {
        // Ignore.
      }
    }
    dataChannelRef.current = null;

    const peer = peerRef.current;
    if (peer) {
      try {
        peer.close();
      } catch {
        // Ignore.
      }
    }
    peerRef.current = null;

    const stream = localStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    localStreamRef.current = null;

    const remoteAudio = remoteAudioRef.current;
    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
    }
    remoteAudioRef.current = null;

    pendingToolCallsRef.current.clear();
    setIsListening(false);
    if (!options?.preserveStatus) {
      setStatus((previous) => (previous === 'error' ? 'error' : 'idle'));
    }
  }

  async function startCall(): Promise<void> {
    if (status === 'connecting' || status === 'connected') {
      return;
    }

    setErrorMessage('');
    setStatus('connecting');
    setConnectionStage('Requesting microphone access');
    setTranscript([]);
    setTurnCount(0);

    const newId = newSessionId();
    sessionIdRef.current = newId;
    setSessionId(newId);
    saveVoiceSessionId(newId);

    try {
      const localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = localStream;
      setConnectionStage('Microphone ready');

      const peer = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      peerRef.current = peer;

      peer.oniceconnectionstatechange = () => {
        if (peer.iceConnectionState === 'failed' || peer.iceConnectionState === 'disconnected') {
          setErrorMessage(`WebRTC ${peer.iceConnectionState}. Please start the call again.`);
          setStatus('error');
          stopCall({ preserveStatus: true });
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          setErrorMessage(`Connection ${peer.connectionState}. Please retry.`);
          setStatus('error');
          stopCall({ preserveStatus: true });
        }
      };

      for (const track of localStream.getTracks()) {
        peer.addTrack(track, localStream);
      }

      const remoteAudio = new Audio();
      remoteAudio.autoplay = true;
      remoteAudioRef.current = remoteAudio;

      peer.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        remoteAudio.srcObject = remoteStream;
        void remoteAudio.play().catch(() => {
          // Autoplay may require user interaction; we already have a click gesture.
        });
      };

      const dataChannel = peer.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        setStatus('connected');
        setConnectionStage('Data channel open');
        appendTranscript('system', 'Voice call connected.');
        sendRealtimeEvent({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Please greet the caller now in English and ask one short opening question.',
              },
            ],
          },
        });
        sendRealtimeEvent({
          type: 'response.create',
          response: {
            modalities: ['audio', 'text'],
            instructions:
              'Speak in English. Say exactly: "Hi, thanks for calling Steam Zone. How can I help you today?" Then wait for the caller.',
          },
        });
      };

      dataChannel.onclose = () => {
        setConnectionStage('Data channel closed');
        if (status !== 'error') {
          setStatus('idle');
        }
        setIsListening(false);
      };

      dataChannel.onerror = () => {
        setConnectionStage('Data channel error');
        setStatus('error');
        setErrorMessage('Realtime data channel error.');
      };

      dataChannel.onmessage = (event) => {
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(String(event.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        const type = asString(payload.type);

        if (type === 'input_audio_buffer.speech_started') {
          setIsListening(true);
          return;
        }

        if (type === 'input_audio_buffer.speech_stopped') {
          setIsListening(false);
          return;
        }

        if (type === 'conversation.item.input_audio_transcription.completed') {
          const transcriptText = asString(payload.transcript).trim();
          if (transcriptText) {
            appendTranscript('system', transcriptText);
          }
          return;
        }

        const call = extractFunctionCall(payload);
        if (call) {
          void handleToolCall(call.callId, call.name, call.argumentsText);
          if (type !== 'response.done') {
            return;
          }
        }

        if (
          type === 'response.done' ||
          type === 'response.output_item.done' ||
          type === 'conversation.item.created' ||
          type === 'response.output_audio_transcript.done' ||
          type === 'response.audio_transcript.done'
        ) {
          const assistantText = extractAssistantText(payload);
          if (assistantText) {
            appendTranscript('system', assistantText);
          }
        }

        if (type === 'error') {
          const errorRecord = asRecord(payload.error);
          const message = asString(errorRecord?.message) || 'Realtime voice error.';
          setStatus('error');
          setErrorMessage(message);
          appendTranscript('system', `Error: ${message}`);
        }
      };

      const offer = await peer.createOffer({
        offerToReceiveAudio: true,
      });
      await peer.setLocalDescription(offer);
      setConnectionStage('Gathering ICE candidates');
      await waitForIceGatheringComplete(peer);
      setConnectionStage('Sending offer to voice endpoint');

      const sdpBody = peer.localDescription?.sdp ?? offer.sdp ?? '';
      if (!sdpBody) {
        throw new Error('Failed to generate local SDP offer.');
      }

      const answerResponse = await fetch('/api/voice/realtime-call', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ sdp: sdpBody }),
      });

      if (!answerResponse.ok) {
        const details = await answerResponse.text();
        const errorMessage = parseApiErrorMessage(details);
        throw new Error(errorMessage || `Realtime call setup failed (${answerResponse.status}).`);
      }

      const answerSdp = await answerResponse.text();
      setConnectionStage('Applying remote answer');
      await peer.setRemoteDescription({
        type: 'answer',
        sdp: answerSdp,
      });

      // If WebRTC never opens the data channel, fail explicitly instead of silently idling.
      window.setTimeout(() => {
        const channel = dataChannelRef.current;
        if (!channel || channel.readyState !== 'open') {
          setStatus('error');
          setConnectionStage('Timed out waiting for realtime channel');
          setErrorMessage('Voice connection timed out before channel opened. Please retry.');
          stopCall({ preserveStatus: true });
        }
      }, 12000);
    } catch (error) {
      stopCall({ preserveStatus: true });
      setStatus('error');
      setConnectionStage('Connection failed');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to start voice call.');
    }
  }

  function startOver(): void {
    stopCall();
    const newId = newSessionId();
    sessionIdRef.current = newId;
    saveVoiceSessionId(newId);
    setSessionId(newId);
    setTranscript([]);
    setTurnCount(0);
    setErrorMessage('');
    setConnectionStage('Idle');
    setStatus('idle');
  }

  useEffect(() => {
    return () => {
      stopCall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canStart = status !== 'connecting' && status !== 'connected';
  const canStop = status === 'connecting' || status === 'connected';

  return (
    <main className="bg-gradient-to-br from-slate-50 via-cyan-50 to-white pb-20 pt-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-cyan-700">Sandbox Route</p>
            <h1 className="text-3xl font-bold text-gray-900">Realtime Voice Agent Lab</h1>
            <p className="mt-1 text-sm text-gray-600">
              Dedicated OpenAI realtime voice agent, isolated from text chat session state.
            </p>
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
            <a
              href="/estimate-bot-lab"
              className="inline-flex items-center rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-100"
            >
              Back To Text Lab
            </a>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm md:p-5">
            <div className="h-[56vh] overflow-y-auto rounded-xl border border-gray-100 bg-slate-50 p-3">
              {transcript.length === 0 && (
                <p className="text-sm text-gray-500">
                  Voice mode is active-only. Call transcript bubbles are hidden to keep it separate from text chat.
                </p>
              )}

              <div className="space-y-3">
                {transcript.map((entry) => (
                  <div
                    key={entry.id}
                    className={
                      entry.role === 'user'
                        ? 'flex justify-end'
                        : entry.role === 'assistant'
                          ? 'flex justify-start'
                          : 'flex justify-center'
                    }
                  >
                    <div
                      className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
                        entry.role === 'user'
                          ? 'bg-cyan-600 text-white'
                          : entry.role === 'assistant'
                            ? 'border border-gray-200 bg-white text-gray-800'
                            : 'border border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      {entry.content}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {errorMessage && <p className="mt-3 text-sm text-rose-700">{errorMessage}</p>}
          </div>

          <aside className="space-y-4">
            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Session</h2>
              <p className="mt-1 break-all text-xs text-gray-600">{sessionId}</p>
              <p className="mt-2 text-xs text-gray-500">Turns completed: {turnCount}</p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Voice Status</h2>
              <p className="mt-2 text-sm text-gray-700">{connectionLabel}</p>
              <p className="mt-1 text-xs text-gray-500">Stage: {connectionStage}</p>
              <p className="mt-1 inline-flex items-center text-xs text-gray-600">
                <Mic className="mr-1 h-3.5 w-3.5" />
                {isListening ? 'Caller speech detected' : 'Waiting for speech'}
              </p>

              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void startCall();
                  }}
                  disabled={!canStart}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                >
                  <Phone className="mr-2 h-4 w-4" />
                  {status === 'connecting' ? 'Connecting...' : 'Start Realtime Voice Call'}
                </button>

                <button
                  type="button"
                  onClick={() => stopCall()}
                  disabled={!canStop}
                  className="inline-flex w-full items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60"
                >
                  <PhoneOff className="mr-2 h-4 w-4" />
                  Stop Voice Call
                </button>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
