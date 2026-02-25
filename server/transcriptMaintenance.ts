import {
  deleteSession,
  getSession,
  listSessions,
  saveSession,
  type EstimateSessionRecord,
  type TranscriptEntry,
} from './estimateAgentSessionStore.js';

export interface TranscriptCleanupOptions {
  dryRun?: boolean;
  sessionId?: string;
  limit?: number;
  minTurns?: number;
  maxTurns?: number;
  deleteAboveTurns?: number | null;
  dedupeWindowMs?: number;
}

export interface TranscriptCleanupSessionResult {
  session_id: string;
  before_turns: number;
  after_turns: number;
  action: 'skipped' | 'compacted' | 'deleted';
}

export interface TranscriptCleanupResult {
  dry_run: boolean;
  scanned: number;
  compacted: number;
  deleted: number;
  skipped: number;
  results: TranscriptCleanupSessionResult[];
}

function normalizeContent(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForDedupe(value: string): string {
  return normalizeContent(value)
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTimestamp(at: string): number {
  const value = Date.parse(at);
  return Number.isFinite(value) ? value : 0;
}

function sortTranscript(entries: TranscriptEntry[]): TranscriptEntry[] {
  return [...entries].sort((left, right) => {
    const leftTs = toTimestamp(left.at);
    const rightTs = toTimestamp(right.at);
    if (leftTs !== rightTs) {
      return leftTs - rightTs;
    }
    if (left.role !== right.role) {
      return left.role.localeCompare(right.role);
    }
    return normalizeContent(left.content).localeCompare(normalizeContent(right.content));
  });
}

export function compactTranscript(
  transcript: TranscriptEntry[],
  options: { maxTurns: number; dedupeWindowMs: number }
): TranscriptEntry[] {
  const sorted = sortTranscript(transcript);
  const compacted: TranscriptEntry[] = [];

  for (const row of sorted) {
    const normalizedContent = normalizeContent(row.content);
    if (!normalizedContent) {
      continue;
    }
    const normalizedRow: TranscriptEntry = {
      ...row,
      content: normalizedContent,
    };

    const last = compacted[compacted.length - 1];
    if (!last) {
      compacted.push(normalizedRow);
      continue;
    }

    if (last.role !== normalizedRow.role) {
      compacted.push(normalizedRow);
      continue;
    }

    const sameContent = normalizeForDedupe(last.content) === normalizeForDedupe(normalizedRow.content);
    const closeInTime = Math.abs(toTimestamp(last.at) - toTimestamp(normalizedRow.at)) <= options.dedupeWindowMs;
    if (!sameContent || !closeInTime) {
      compacted.push(normalizedRow);
      continue;
    }

    // Merge metadata from a duplicate row without duplicating turns.
    if ((!last.channel || last.channel === 'unknown') && normalizedRow.channel) {
      last.channel = normalizedRow.channel;
    }
    if (!last.reasoning && normalizedRow.reasoning) {
      last.reasoning = normalizedRow.reasoning;
    }
    if (!last.meta && normalizedRow.meta) {
      last.meta = normalizedRow.meta;
    }
  }

  if (compacted.length <= options.maxTurns) {
    return compacted;
  }

  return compacted.slice(-options.maxTurns);
}

function sessionsMatchScope(all: EstimateSessionRecord[], sessionId?: string): EstimateSessionRecord[] {
  if (!sessionId) {
    return all;
  }
  return all.filter((session) => session.session_id === sessionId);
}

export async function cleanupTranscripts(options: TranscriptCleanupOptions = {}): Promise<TranscriptCleanupResult> {
  const dryRun = options.dryRun !== false;
  const minTurns = Number.isFinite(options.minTurns) ? Math.max(1, Math.floor(options.minTurns ?? 2000)) : 2000;
  const maxTurns = Number.isFinite(options.maxTurns) ? Math.max(1, Math.floor(options.maxTurns ?? 2000)) : 2000;
  const dedupeWindowMs = Number.isFinite(options.dedupeWindowMs)
    ? Math.max(0, Math.floor(options.dedupeWindowMs ?? 5000))
    : 5000;
  const deleteAboveTurns =
    options.deleteAboveTurns == null || !Number.isFinite(options.deleteAboveTurns)
      ? null
      : Math.max(1, Math.floor(options.deleteAboveTurns));
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(5000, Math.floor(options.limit ?? 1000))) : 1000;

  const sessions = options.sessionId
    ? [await getSession(options.sessionId)]
    : await listSessions(limit);

  const targetSessions = sessionsMatchScope(sessions, options.sessionId);
  const results: TranscriptCleanupSessionResult[] = [];
  let compactedCount = 0;
  let deletedCount = 0;
  let skippedCount = 0;

  for (const session of targetSessions) {
    const beforeTurns = session.transcript.length;
    if (beforeTurns < minTurns) {
      skippedCount += 1;
      results.push({
        session_id: session.session_id,
        before_turns: beforeTurns,
        after_turns: beforeTurns,
        action: 'skipped',
      });
      continue;
    }

    if (deleteAboveTurns !== null && beforeTurns >= deleteAboveTurns) {
      if (!dryRun) {
        await deleteSession(session.session_id);
      }
      deletedCount += 1;
      results.push({
        session_id: session.session_id,
        before_turns: beforeTurns,
        after_turns: 0,
        action: 'deleted',
      });
      continue;
    }

    const compacted = compactTranscript(session.transcript, { maxTurns, dedupeWindowMs });
    const changed = compacted.length !== beforeTurns;
    if (!changed) {
      skippedCount += 1;
      results.push({
        session_id: session.session_id,
        before_turns: beforeTurns,
        after_turns: beforeTurns,
        action: 'skipped',
      });
      continue;
    }

    if (!dryRun) {
      await saveSession({
        ...session,
        transcript: compacted,
      });
    }

    compactedCount += 1;
    results.push({
      session_id: session.session_id,
      before_turns: beforeTurns,
      after_turns: compacted.length,
      action: 'compacted',
    });
  }

  return {
    dry_run: dryRun,
    scanned: targetSessions.length,
    compacted: compactedCount,
    deleted: deletedCount,
    skipped: skippedCount,
    results,
  };
}
