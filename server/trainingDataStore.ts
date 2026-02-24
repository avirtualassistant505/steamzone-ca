import { promises as fs } from 'node:fs';
import path from 'node:path';
import { getSupabaseAdminClient } from './supabaseAdmin.js';

type StoredTrainingItem = {
  question?: unknown;
  answer?: unknown;
  topic?: unknown;
  subtopic?: unknown;
  status?: unknown;
};

export type TrainingItem = {
  question: string;
  answer: string;
  topic?: string;
  subtopic?: string;
  status?: string;
};

type TrainingSource = 'db' | 'fallback';

type LoadResult = {
  items: TrainingItem[];
  source: TrainingSource;
  updatedAt?: string;
};

const CACHE_TTL_MS = 30_000;
const TABLE_NAME = 'training_data';
const ROW_ID = 'active';
const DEFAULT_FALLBACK_FILE_CANDIDATES = [
  path.join(process.cwd(), 'GHL', 'steamzone.ca', 'data', 'training', 'steamzone_master_training_merged_2026-02-09T16-22-16-454Z.json'),
  path.join(process.cwd(), 'GHL', 'steamzone.ca', 'data', 'training', 'steamzone_master_training_merged_2026-02-09T16-22-36-339Z.json'),
  path.join(process.cwd(), 'data', 'training', 'steamzone_master_training_merged_2026-02-09T16-22-36-339Z.json'),
] as const;

const memory: {
  items: TrainingItem[];
  loadedAt: number;
  source: TrainingSource;
} = {
  items: [],
  loadedAt: 0,
  source: 'fallback',
};

function isMissingTableError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes(TABLE_NAME) &&
    (text.includes('does not exist') || text.includes('relation') || text.includes('schema cache') || text.includes('could not find'))
  );
}

function toStringValue(value: unknown): string {
  return String(value ?? '').trim();
}

async function loadFallbackFromDisk(): Promise<TrainingItem[]> {
  for (const candidate of DEFAULT_FALLBACK_FILE_CANDIDATES) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const parsedItems = normalizeIncomingTrainingItems(parsed);
      if (parsedItems.length > 0) {
        return parsedItems;
      }
    } catch {
      continue;
    }
  }

  return [];
}

export function normalizeIncomingTrainingItems(raw: unknown): TrainingItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: TrainingItem[] = [];
  for (const item of raw as StoredTrainingItem[]) {
    const question = toStringValue(item.question);
    const answer = toStringValue(item.answer);

    if (!question || !answer) {
      continue;
    }

    out.push({
      question,
      answer,
      topic: toStringValue(item.topic) || undefined,
      subtopic: toStringValue(item.subtopic) || undefined,
      status: toStringValue(item.status) || undefined,
    });
  }

  return out;
}

function fallbackItems(): TrainingItem[] {
  return [];
}

function cacheIsFresh(): boolean {
  return Date.now() - memory.loadedAt < CACHE_TTL_MS;
}

async function loadFromSupabase(): Promise<LoadResult | null> {
  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return null;
  }

  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select('items, updated_at')
      .eq('id', ROW_ID)
      .maybeSingle();

    if (error) {
      if (isMissingTableError(error.message)) {
        return null;
      }

      return null;
    }

    if (!data) {
      return null;
    }

    const items = normalizeIncomingTrainingItems((data as { items?: unknown }).items);
    if (items.length === 0) {
      return {
        items: fallbackItems(),
        source: 'fallback',
      };
    }

    return {
      items,
      source: 'db',
      updatedAt: data.updated_at,
    } as LoadResult;
  } catch {
    return null;
  }
}

export async function loadActiveTrainingItems(): Promise<LoadResult> {
  if (cacheIsFresh()) {
    return {
      items: memory.items,
      source: memory.source,
    };
  }

  const loaded = await loadFromSupabase();

  if (!loaded) {
    if (!memory.loadedAt) {
      memory.items = await loadFallbackFromDisk();
      if (memory.items.length === 0) {
        memory.items = fallbackItems();
      }
      memory.source = 'fallback';
    }

    return {
      items: memory.items,
      source: memory.source,
    };
  }

  memory.items = loaded.items;
  memory.source = loaded.source;
  memory.loadedAt = Date.now();

  return {
    items: memory.items,
    source: memory.source,
    updatedAt: loaded.updatedAt,
  };
}

export async function saveActiveTrainingItems(items: unknown): Promise<LoadResult> {
  const normalized = normalizeIncomingTrainingItems(items);

  memory.items = normalized;
  memory.source = 'fallback';
  memory.loadedAt = Date.now();

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return {
      items: memory.items,
      source: 'fallback',
      updatedAt: new Date().toISOString(),
    };
  }

  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from(TABLE_NAME).upsert(
      {
        id: ROW_ID,
        items: memory.items,
        updated_at: now,
      },
      { onConflict: 'id' }
    );

    if (error) {
      if (isMissingTableError(error.message)) {
        return {
          items: memory.items,
          source: 'fallback',
          updatedAt: now,
        };
      }
      throw new Error(error.message);
    }

    memory.source = 'db';
    return {
      items: memory.items,
      source: 'db',
      updatedAt: now,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unable to save training data.');
  }
}

export async function clearTrainingDataCache(): Promise<void> {
  memory.loadedAt = 0;
  memory.items = [];
  memory.source = 'fallback';
}
