type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type TrainingItemInput = {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  status?: string;
};

type TrainingSearchMatch = {
  index: number;
  score: number;
};

type AssistantResponsePayload = {
  assistant_message: string;
  result_indexes: number[];
  suggested_jump_index: number | null;
  proposed_action: {
    type: 'none' | 'add' | 'update';
    target_index: number | null;
    reason: string;
    entry: TrainingItemInput | null;
  };
  model: string;
  source: 'llm' | 'fallback';
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENROUTER_RESPONSES_URL = 'https://openrouter.ai/api/v1/responses';
const TRAINING_ASSISTANT_DEFAULT_MODEL = 'openai/gpt-5.2-chat';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'at',
  'be',
  'can',
  'do',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'our',
  'please',
  'the',
  'this',
  'to',
  'we',
  'what',
  'where',
  'which',
  'with',
  'you',
  'your',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      return asRecord(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return asRecord(body);
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function scoreMatch(query: string, queryTokens: string[], item: TrainingItemInput): number {
  const question = normalizeText(item.question);
  const answer = normalizeText(item.answer);
  const topic = normalizeText(item.topic ?? '');
  const subtopic = normalizeText(item.subtopic ?? '');
  const corpus = `${question} ${answer} ${topic} ${subtopic}`.trim();
  if (!corpus) return 0;

  let score = 0;
  if (question.includes(query)) score += 8;
  if (answer.includes(query)) score += 4;
  if (topic.includes(query)) score += 2;
  if (subtopic.includes(query)) score += 1.5;

  for (const token of queryTokens) {
    if (question.includes(token)) {
      score += 2;
    } else if (answer.includes(token)) {
      score += 1;
    } else if (topic.includes(token) || subtopic.includes(token)) {
      score += 1.5;
    }
  }

  return score;
}

function findMatches(items: TrainingItemInput[], query: string, limit = 8): TrainingSearchMatch[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];
  const queryTokens = tokenize(query);
  const scored: TrainingSearchMatch[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const score = scoreMatch(normalizedQuery, queryTokens, item);
    if (score >= 2) scored.push({ index, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(limit, 15)));
}

function filterTrainingItems(raw: unknown): TrainingItemInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const question = String(record.question ?? '').trim();
      const answer = String(record.answer ?? '').trim();
      if (!question || !answer) return null;
      return {
        question,
        answer,
        topic: typeof record.topic === 'string' ? record.topic.trim() : undefined,
        subtopic: typeof record.subtopic === 'string' ? record.subtopic.trim() : undefined,
        status: typeof record.status === 'string' ? record.status.trim() : undefined,
      } as TrainingItemInput;
    })
    .filter((entry): entry is TrainingItemInput => entry !== null);
}

function normalizeOpenAIModelForDirect(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return 'gpt-5.2';
  if (trimmed.startsWith('openai/')) {
    return trimmed.replace('openai/', '').trim() || 'gpt-5.2';
  }
  if (trimmed.includes('/')) {
    return 'gpt-5.2';
  }
  return trimmed;
}

async function resolveModel(): Promise<string> {
  const override = process.env.TRAINING_ASSISTANT_MODEL?.trim();
  if (override) return override;
  return TRAINING_ASSISTANT_DEFAULT_MODEL;
}

function fallbackPayload(query: string, matches: TrainingSearchMatch[], model: string): AssistantResponsePayload {
  if (matches.length === 0) {
    return {
      assistant_message:
        'I could not find a confident match in training data yet. If you want, tell me the exact question and answer and I can prepare a new entry for your confirmation.',
      result_indexes: [],
      suggested_jump_index: null,
      proposed_action: {
        type: 'none',
        target_index: null,
        reason: 'No reliable match.',
        entry: null,
      },
      model,
      source: 'fallback',
    };
  }

  const top = matches.slice(0, 3);
  const preview = top.map((match) => `#${match.index + 1}`).join(', ');
  return {
    assistant_message: `I found relevant matches for "${query}": ${preview}. Would you like me to jump to #${top[0].index + 1}?`,
    result_indexes: matches.map((match) => match.index),
    suggested_jump_index: top[0].index,
    proposed_action: {
      type: 'none',
      target_index: null,
      reason: 'Search-only response.',
      entry: null,
    },
    model,
    source: 'fallback',
  };
}

function isEditIntent(query: string): boolean {
  return /\b(change|edit|update|replace|fix|set|correct|modify)\b/i.test(query);
}

function findReferencedEntryIndex(
  history: Array<{ role: 'assistant' | 'user'; content: string }>,
  max: number
): number | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const content = history[index]?.content ?? '';
    const match = content.match(/(?:entry|#)\s*#?\s*(\d{1,4})/i) ?? content.match(/#\s*(\d{1,4})/);
    if (!match?.[1]) continue;
    const parsed = Number(match[1]);
    if (!Number.isInteger(parsed) || parsed < 1) continue;
    const asIndex = parsed - 1;
    if (asIndex >= 0 && asIndex < max) return asIndex;
  }
  return null;
}

function extractPhoneNumber(query: string): string | null {
  const direct = query.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  if (!direct?.[0]) return null;
  const digits = direct[0].replace(/\D/g, '');
  const normalizedDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (normalizedDigits.length !== 10) return null;
  return `(${normalizedDigits.slice(0, 3)}) ${normalizedDigits.slice(3, 6)}-${normalizedDigits.slice(6)}`;
}

function buildDeterministicPhoneUpdateProposal(
  query: string,
  items: TrainingItemInput[],
  referencedIndex: number | null
): AssistantResponsePayload['proposed_action'] | null {
  if (!isEditIntent(query) || referencedIndex === null || referencedIndex < 0 || referencedIndex >= items.length) {
    return null;
  }
  const nextPhone = extractPhoneNumber(query);
  if (!nextPhone) return null;
  const target = items[referencedIndex];
  const answer = target.answer;
  const replaced = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/.test(answer)
    ? answer.replace(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/, nextPhone)
    : `${answer} Updated phone: ${nextPhone}.`;

  return {
    type: 'update',
    target_index: referencedIndex,
    reason: `Detected phone-number edit request for entry #${referencedIndex + 1}.`,
    entry: {
      ...target,
      answer: replaced,
      status: target.status || 'READY',
    },
  };
}

function parseAssistantJson(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return asRecord(JSON.parse(trimmed.slice(first, last + 1)));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function sanitizeIndexes(value: unknown, max: number): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const entry of value) {
    const n = Number(entry);
    if (!Number.isInteger(n)) continue;
    if (n < 0 || n >= max) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function sanitizeEntry(value: unknown): TrainingItemInput | null {
  const record = asRecord(value);
  if (!record) return null;
  const question = String(record.question ?? '').trim();
  const answer = String(record.answer ?? '').trim();
  if (!question || !answer) return null;
  const topic = typeof record.topic === 'string' ? record.topic.trim() : undefined;
  const subtopic = typeof record.subtopic === 'string' ? record.subtopic.trim() : undefined;
  const status = typeof record.status === 'string' ? record.status.trim() : 'READY';
  return {
    question,
    answer,
    topic: topic || undefined,
    subtopic: subtopic || undefined,
    status: status || 'READY',
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const query = String(payload.query ?? '').trim();
  const items = filterTrainingItems(payload.items);
  const language = payload.language === 'es' ? 'es' : 'en';
  const history = Array.isArray(payload.messages)
    ? payload.messages
        .map((entry) => asRecord(entry))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .slice(-10)
        .map((entry) => ({
          role: String(entry.role ?? '').trim().toLowerCase() === 'assistant' ? 'assistant' : 'user',
          content: String(entry.content ?? '').trim().slice(0, 500),
        }))
        .filter((entry) => entry.content.length > 0)
    : [];

  if (!query) {
    res.status(400).json({ message: 'query is required.' });
    return;
  }
  if (items.length === 0) {
    res.status(200).json(
      fallbackPayload(query, [], TRAINING_ASSISTANT_DEFAULT_MODEL)
    );
    return;
  }

  const matches = findMatches(items, query, 8);
  const model = await resolveModel();
  const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
  const openAiKey = process.env.OPENAI_API_KEY?.trim();

  const referencedIndex = findReferencedEntryIndex(history, items.length);
  const deterministicPhoneProposal = buildDeterministicPhoneUpdateProposal(query, items, referencedIndex);

  if (!openRouterKey && !openAiKey) {
    const payloadOut = fallbackPayload(query, matches, model);
    if (deterministicPhoneProposal) {
      payloadOut.proposed_action = deterministicPhoneProposal;
      payloadOut.assistant_message = `I prepared an update for entry #${deterministicPhoneProposal.target_index! + 1} to use ${extractPhoneNumber(query)}. Reply "yes" to apply it.`;
      payloadOut.result_indexes = [deterministicPhoneProposal.target_index ?? 0];
      payloadOut.suggested_jump_index = deterministicPhoneProposal.target_index;
    }
    res.status(200).json(payloadOut);
    return;
  }

  const candidates: TrainingSearchMatch[] = [];
  const seenCandidateIndexes = new Set<number>();

  const pushCandidate = (candidate: TrainingSearchMatch): void => {
    if (candidate.index < 0 || candidate.index >= items.length) return;
    if (seenCandidateIndexes.has(candidate.index)) return;
    seenCandidateIndexes.add(candidate.index);
    candidates.push(candidate);
  };

  matches.forEach((candidate) => pushCandidate(candidate));
  if (referencedIndex !== null) {
    pushCandidate({ index: referencedIndex, score: 6 });
  }
  if (candidates.length === 0) {
    for (let index = 0; index < items.length && candidates.length < 12; index += 1) {
      pushCandidate({ index, score: 0 });
    }
  }

  const trimmedCandidates = candidates.slice(0, 12);
  const candidateRows = trimmedCandidates.map(({ index, score }) => {
    const item = items[index];
    return {
      index,
      score: Number(score.toFixed(3)),
      question: item.question,
      answer: item.answer,
      topic: item.topic ?? '',
      subtopic: item.subtopic ?? '',
      status: item.status ?? 'READY',
    };
  });

  const system = language === 'es'
    ? 'Eres un asistente de búsqueda de datos de entrenamiento para administradores. Debes responder SOLO con JSON válido.'
    : 'You are a training-data search assistant for admins. You must reply ONLY with valid JSON.';
  const instruction =
    language === 'es'
      ? 'Devuelve JSON con: assistant_message (string), result_indexes (number[]), suggested_jump_index (number|null), proposed_action ({type:"none"|"add"|"update", target_index:number|null, reason:string, entry:{question,answer,topic?,subtopic?,status?}|null}). Sé breve, natural y accionable.'
      : 'Return JSON with: assistant_message (string), result_indexes (number[]), suggested_jump_index (number|null), proposed_action ({type:"none"|"add"|"update", target_index:number|null, reason:string, entry:{question,answer,topic?,subtopic?,status?}|null}). Be concise, natural, and actionable.';

  const userInput = {
    query,
    history,
    candidate_entries: candidateRows,
    required_behavior: [
      'Ground responses only on candidate_entries.',
      'Do not invent indexes.',
      'Prefer top relevant indexes.',
      'Offer a jump suggestion when possible.',
      'If user asks to create or edit training data, propose_action should contain the concrete add/update payload and ask for confirmation.',
      'Use type=add when creating new data.',
      'Use type=update only when target_index is in candidate_entries.',
      'Never apply changes directly; only propose.',
      'No markdown. JSON only.',
    ],
  };

  try {
    const provider = openRouterKey ? 'openrouter' : 'openai';
    const apiKey = openRouterKey || openAiKey || '';
    const endpoint = provider === 'openrouter' ? OPENROUTER_RESPONSES_URL : OPENAI_RESPONSES_URL;
    const requestedModel = provider === 'openrouter' ? model : normalizeOpenAIModelForDirect(model);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    if (provider === 'openrouter') {
      const referer =
        process.env.SITE_URL?.trim() ||
        process.env.VERCEL_URL?.trim() ||
        process.env.NEXT_PUBLIC_SITE_URL?.trim();
      if (referer) {
        const resolved = referer.startsWith('http') ? referer : `https://${referer}`;
        headers.Referer = resolved;
        headers['HTTP-Referer'] = resolved;
      }
      headers['X-Title'] = 'Steam Zone Training Search Assistant';
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: requestedModel,
        instructions: `${system}\n${instruction}`,
        input: [
          {
            role: 'user',
            content: JSON.stringify(userInput),
          },
        ],
        temperature: 0.1,
        max_output_tokens: 500,
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      const payloadOut = fallbackPayload(query, matches, requestedModel);
      if (deterministicPhoneProposal) {
        payloadOut.proposed_action = deterministicPhoneProposal;
        payloadOut.assistant_message = `I prepared an update for entry #${deterministicPhoneProposal.target_index! + 1} to use ${extractPhoneNumber(query)}. Reply "yes" to apply it.`;
        payloadOut.result_indexes = [deterministicPhoneProposal.target_index ?? 0];
        payloadOut.suggested_jump_index = deterministicPhoneProposal.target_index;
      }
      res.status(200).json(payloadOut);
      return;
    }

    let modelText = '';
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.output_text === 'string') {
        modelText = parsed.output_text.trim();
      }
      if (!modelText && Array.isArray(parsed.output)) {
        for (const outputItem of parsed.output as Array<Record<string, unknown>>) {
          if (String(outputItem.type ?? '') !== 'message') continue;
          const content = Array.isArray(outputItem.content) ? outputItem.content : [];
          for (const chunk of content as Array<Record<string, unknown>>) {
            if (String(chunk.type ?? '') === 'output_text' && typeof chunk.text === 'string') {
              modelText += `${chunk.text}\n`;
            }
          }
        }
      }
      modelText = modelText.trim();
    } catch {
      modelText = '';
    }

    const parsedAssistant = parseAssistantJson(modelText);
    if (!parsedAssistant) {
      const payloadOut = fallbackPayload(query, matches, requestedModel);
      if (deterministicPhoneProposal) {
        payloadOut.proposed_action = deterministicPhoneProposal;
        payloadOut.assistant_message = `I prepared an update for entry #${deterministicPhoneProposal.target_index! + 1} to use ${extractPhoneNumber(query)}. Reply "yes" to apply it.`;
        payloadOut.result_indexes = [deterministicPhoneProposal.target_index ?? 0];
        payloadOut.suggested_jump_index = deterministicPhoneProposal.target_index;
      }
      res.status(200).json(payloadOut);
      return;
    }

    const assistantMessage = String(parsedAssistant.assistant_message ?? '').trim();
    const resultIndexes = sanitizeIndexes(parsedAssistant.result_indexes, items.length);
    const suggestedRaw = Number(parsedAssistant.suggested_jump_index);
    const suggested =
      Number.isInteger(suggestedRaw) && suggestedRaw >= 0 && suggestedRaw < items.length
        ? suggestedRaw
        : resultIndexes.length > 0
          ? resultIndexes[0]
          : null;

    const proposedRaw = asRecord(parsedAssistant.proposed_action);
    const proposedType = String(proposedRaw?.type ?? 'none').trim().toLowerCase();
    const validType: 'none' | 'add' | 'update' =
      proposedType === 'add' || proposedType === 'update' ? proposedType : 'none';
    const proposedTargetRaw = Number(proposedRaw?.target_index);
    const proposedTarget =
      Number.isInteger(proposedTargetRaw) && proposedTargetRaw >= 0 && proposedTargetRaw < items.length
        ? proposedTargetRaw
        : null;
    const proposedEntry = sanitizeEntry(proposedRaw?.entry);
    const proposedReason = String(proposedRaw?.reason ?? '').trim() || 'No action proposed.';

    const out: AssistantResponsePayload = {
      assistant_message: assistantMessage || fallbackPayload(query, matches, requestedModel).assistant_message,
      result_indexes: resultIndexes.length > 0 ? resultIndexes : matches.map((match) => match.index),
      suggested_jump_index: suggested,
      proposed_action: {
        type: validType,
        target_index: validType === 'update' ? proposedTarget : null,
        reason: proposedReason,
        entry: validType === 'none' ? null : proposedEntry,
      },
      model: requestedModel,
      source: 'llm',
    };

    if (deterministicPhoneProposal && out.proposed_action.type === 'none') {
      out.proposed_action = deterministicPhoneProposal;
      out.assistant_message = `I prepared an update for entry #${deterministicPhoneProposal.target_index! + 1} to use ${extractPhoneNumber(query)}. Reply "yes" to apply it.`;
      out.result_indexes = [deterministicPhoneProposal.target_index ?? 0];
      out.suggested_jump_index = deterministicPhoneProposal.target_index;
    }

    res.status(200).json(out);
  } catch {
    const payloadOut = fallbackPayload(query, matches, model);
    if (deterministicPhoneProposal) {
      payloadOut.proposed_action = deterministicPhoneProposal;
      payloadOut.assistant_message = `I prepared an update for entry #${deterministicPhoneProposal.target_index! + 1} to use ${extractPhoneNumber(query)}. Reply "yes" to apply it.`;
      payloadOut.result_indexes = [deterministicPhoneProposal.target_index ?? 0];
      payloadOut.suggested_jump_index = deterministicPhoneProposal.target_index;
    }
    res.status(200).json(payloadOut);
  }
}
