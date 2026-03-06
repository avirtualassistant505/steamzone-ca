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

export type TrainingSource = 'db' | 'fallback';

export type LoadResult = {
  items: TrainingItem[];
  source: TrainingSource;
  updatedAt?: string;
};

type FallbackLoadResult = {
  items: TrainingItem[];
  updatedAt?: string;
  filePath?: string;
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
  updatedAt?: string;
  fallbackFilePath?: string;
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

async function loadFallbackFromDisk(): Promise<FallbackLoadResult> {
  for (const candidate of DEFAULT_FALLBACK_FILE_CANDIDATES) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      const parsedItems = normalizeIncomingTrainingItems(parsed);
      if (parsedItems.length > 0) {
        const stats = await fs.stat(candidate).catch(() => null);
        return {
          items: parsedItems,
          updatedAt: stats?.mtime ? stats.mtime.toISOString() : undefined,
          filePath: candidate,
        };
      }
    } catch {
      continue;
    }
  }

  return { items: [] };
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
      const fallback = await loadFallbackFromDisk();
      return {
        items: fallback.items.length > 0 ? fallback.items : fallbackItems(),
        source: 'fallback',
        updatedAt: fallback.updatedAt,
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
      updatedAt: memory.updatedAt,
    };
  }

  const loaded = await loadFromSupabase();

  if (!loaded) {
    if (!memory.loadedAt) {
      const fallback = await loadFallbackFromDisk();
      memory.items = fallback.items;
      if (memory.items.length === 0) {
        memory.items = fallbackItems();
      }
      memory.source = 'fallback';
      memory.updatedAt = fallback.updatedAt;
      memory.fallbackFilePath = fallback.filePath;
      memory.loadedAt = Date.now();
    }

    return {
      items: memory.items,
      source: memory.source,
      updatedAt: memory.updatedAt,
    };
  }

  memory.items = loaded.items;
  memory.source = loaded.source;
  memory.loadedAt = Date.now();
  memory.updatedAt = loaded.updatedAt;
  memory.fallbackFilePath = loaded.source === 'fallback' ? memory.fallbackFilePath : undefined;

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
  memory.updatedAt = new Date().toISOString();

  const supabase = await getSupabaseAdminClient();
  if (!supabase) {
    return {
      items: memory.items,
      source: 'fallback',
      updatedAt: memory.updatedAt,
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
  memory.updatedAt = undefined;
  memory.fallbackFilePath = undefined;
}

export function getTrainingDataCacheState(): {
  itemCount: number;
  source: TrainingSource;
  loadedAt: string | null;
  updatedAt?: string;
  fallbackFilePath?: string;
} {
  return {
    itemCount: memory.items.length,
    source: memory.source,
    loadedAt: memory.loadedAt ? new Date(memory.loadedAt).toISOString() : null,
    updatedAt: memory.updatedAt,
    fallbackFilePath: memory.fallbackFilePath,
  };
}
