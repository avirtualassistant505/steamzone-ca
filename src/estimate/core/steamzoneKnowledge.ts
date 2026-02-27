import { loadActiveTrainingItems } from '../../../server/trainingDataStore.js';
import type { TrainingItem } from '../../../server/trainingDataStore.js';

type RawTrainingItem = {
  question?: string;
  answer?: string;
  topic?: string;
  subtopic?: string;
  status?: string;
};

type KnowledgeEntry = {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  questionNorm: string;
  answerNorm: string;
  tokens: string[];
};

export type KnowledgeMatch = {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  score: number;
};

const PINNED_ENTRIES: RawTrainingItem[] = [
  {
    question: 'What is your business phone number?',
    answer: 'You can reach us at (236) 506-6570.',
    topic: 'General',
    subtopic: 'Contact',
    status: 'READY',
  },
  {
    question: 'What is your business address?',
    answer: '120 Parkside Crescent, Mitchell, MB R5G 2X3, Canada.',
    topic: 'General',
    subtopic: 'Contact',
    status: 'READY',
  },
  {
    question: 'What is your business email?',
    answer: 'Our email is info@steamzone.ca.',
    topic: 'General',
    subtopic: 'Contact',
    status: 'READY',
  },
  {
    question: 'Where does Steam Zone provide services?',
    answer:
      'We are based in the Mitchell/Steinbach area and primarily serve Southeast Manitoba. We also take select jobs in Winnipeg and surrounding areas depending on scheduling and travel zone.',
    topic: 'General',
    subtopic: 'Service Area',
    status: 'READY',
  },
  {
    question: 'Do you give discounts for first-time customers?',
    answer:
      'No, we do not offer a first-time customer discount. One-time service is full price. We do offer recurring service discounts: Monthly 10% off, Biweekly 20% off, and Weekly 25% off.',
    topic: 'Pricing',
    subtopic: 'Discounts',
    status: 'READY',
  },
  {
    question: 'Do I need to provide cleaning materials for deep cleaning service, or is everything included?',
    answer: 'All cleaning materials are included in our service and in our estimates.',
    topic: 'Services',
    subtopic: 'Inclusions',
    status: 'READY',
  },
];

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
  'who',
  'with',
  'you',
  'your',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function trainingItemsToRaw(items: TrainingItem[]): RawTrainingItem[] {
  return items.map((item) => ({
    question: item.question,
    answer: item.answer,
    topic: item.topic,
    subtopic: item.subtopic,
    status: item.status,
  }));
}

const STATIC_ENTRIES = buildKnowledgeEntries(PINNED_ENTRIES);

let cache: KnowledgeEntry[] = STATIC_ENTRIES;
let cacheLoadedAt = 0;
let cachePromise: Promise<KnowledgeEntry[]> | null = null;

function nowMs(): number {
  return Date.now();
}

function isCacheValid(): boolean {
  return cacheLoadedAt > 0 && nowMs() - cacheLoadedAt < 30_000;
}

async function getKnowledgeEntries(): Promise<KnowledgeEntry[]> {
  if (isCacheValid()) {
    return cache;
  }

  if (!cachePromise) {
    cachePromise = (async () => {
      const loaded = await loadActiveTrainingItems();
      const dbRows = trainingItemsToRaw(loaded.items);
      const next = buildKnowledgeEntries(dbRows);
      cache = next.length > 0 ? next : STATIC_ENTRIES;
      cacheLoadedAt = nowMs();
      return cache;
    })();

    cachePromise.finally(() => {
      cachePromise = null;
    });
  }

  return cachePromise;
}

function buildKnowledgeEntries(rows: RawTrainingItem[]): KnowledgeEntry[] {
  const merged = [...PINNED_ENTRIES, ...rows];
  const dedup = new Map<string, KnowledgeEntry>();

  for (const item of merged) {
    const status = String(item.status ?? 'READY').trim().toUpperCase();
    if (status && status !== 'READY') continue;

    const question = String(item.question ?? '').trim();
    const answer = String(item.answer ?? '').trim();
    if (!question || !answer) continue;

    const questionNorm = normalizeText(question);
    if (!questionNorm) continue;

    // Keep pinned/current answers when duplicates exist.
    if (dedup.has(questionNorm)) continue;

    const answerNorm = normalizeText(answer);
    dedup.set(questionNorm, {
      question,
      answer,
      topic: item.topic,
      subtopic: item.subtopic,
      questionNorm,
      answerNorm,
      tokens: tokenize(`${question} ${answer}`),
    });
  }

  return Array.from(dedup.values());
}

function scoreAndSortMatches(
  query: string,
  queryTokens: string[],
  entries: KnowledgeEntry[],
  limit = 3
): KnowledgeMatch[] {
  const scored: KnowledgeMatch[] = [];

  for (const entry of entries) {
    const score = scoreEntry(query, queryTokens, entry);
    if (score < 1.6) continue;
    scored.push({
      question: entry.question,
      answer: entry.answer,
      topic: entry.topic,
      subtopic: entry.subtopic,
      score: Number(score.toFixed(3)),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, Math.min(limit, 5)));
}

export async function searchSteamZoneKnowledgeAsync(question: string, limit = 3): Promise<KnowledgeMatch[]> {
  const query = normalizeText(question);
  if (!query) return [];

  const queryTokens = tokenize(question);
  const entries = await getKnowledgeEntries();
  return scoreAndSortMatches(query, queryTokens, entries, limit);
}

function scoreEntry(query: string, queryTokens: string[], entry: KnowledgeEntry): number {
  if (!query) return 0;

  let score = 0;
  const entryText = `${entry.questionNorm} ${entry.answerNorm}`;

  if (entry.questionNorm.includes(query)) score += 6;
  if (entry.answerNorm.includes(query)) score += 2;

  if (queryTokens.length > 0) {
    let overlap = 0;
    for (const token of queryTokens) {
      if (entry.tokens.includes(token)) overlap += 1;
    }
    const overlapRatio = overlap / queryTokens.length;
    score += overlapRatio * 5;
  }

  if (query.includes('address') && entry.questionNorm.includes('address')) score += 3;
  if (query.includes('phone') && entry.questionNorm.includes('phone')) score += 3;
  if (query.includes('email') && entry.questionNorm.includes('email')) score += 3;
  if (query.includes('service area') && entry.questionNorm.includes('service')) score += 2;
  if (query.includes('where') && entry.questionNorm.includes('where')) score += 1;
  if (/(first time|first-time|new customer|new customers)/.test(query)) {
    if (/(first time|new customer|new customers)/.test(entryText)) score += 4;
    if (/(recurring|monthly|biweekly|weekly|frequency)/.test(entryText)) score -= 2;
  }
  if (/(recurring|monthly|biweekly|weekly|frequency)/.test(query)) {
    if (/(recurring|monthly|biweekly|weekly|frequency)/.test(entryText)) score += 3;
    if (/(first time|new customer|new customers)/.test(entryText)) score -= 1.5;
  }
  if (/(material|materials|supply|supplies|included|deep clean)/.test(query) &&
      /(material|materials|supply|supplies|included|deep clean)/.test(entry.questionNorm)) {
    score += 3;
  }

  return score;
}

export function searchSteamZoneKnowledge(question: string, limit = 3): KnowledgeMatch[] {
  const query = normalizeText(question);
  if (!query) return [];

  const queryTokens = tokenize(question);
  return scoreAndSortMatches(query, queryTokens, STATIC_ENTRIES, limit);
}
