import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSession, saveSession } from '../server/estimateAgentSessionStore';
import { cleanupTranscripts, compactTranscript } from '../server/transcriptMaintenance';

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isoAt(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

describe('transcriptMaintenance', () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    if (originalSupabaseUrl) process.env.SUPABASE_URL = originalSupabaseUrl;
    else delete process.env.SUPABASE_URL;
    if (originalSupabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('compacts duplicate turns and enforces maxTurns', () => {
    const base = Date.now();
    const result = compactTranscript(
      [
        { role: 'user', content: 'hello there', at: isoAt(base, 0) },
        { role: 'user', content: 'Hello there!', at: isoAt(base, 1_000) },
        { role: 'assistant', content: 'How can I help?', at: isoAt(base, 2_000) },
        { role: 'assistant', content: 'How can I help', at: isoAt(base, 2_500) },
        { role: 'user', content: 'Need a quote', at: isoAt(base, 3_000) },
        { role: 'user', content: 'Need a quote please', at: isoAt(base, 4_000) },
      ],
      { maxTurns: 3, dedupeWindowMs: 5_000 }
    );

    expect(result).toHaveLength(3);
    expect(result[0]?.content).toBe('How can I help?');
    expect(result[1]?.content).toBe('Need a quote');
    expect(result[2]?.content).toBe('Need a quote please');
  });

  it('reports compaction in dry run without mutating stored transcript', async () => {
    const sessionId = `cleanup-dry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();
    await saveSession({
      ...(await getSession(sessionId)),
      transcript: [
        { role: 'user', content: 'line 1', at: isoAt(base, 0) },
        { role: 'assistant', content: 'line 2', at: isoAt(base, 10_000) },
        { role: 'user', content: 'line 3', at: isoAt(base, 20_000) },
        { role: 'assistant', content: 'line 4', at: isoAt(base, 30_000) },
      ],
    });

    const dryRun = await cleanupTranscripts({
      dryRun: true,
      sessionId,
      minTurns: 1,
      maxTurns: 2,
    });

    expect(dryRun.compacted).toBe(1);
    expect(dryRun.results[0]?.after_turns).toBe(2);

    const session = await getSession(sessionId);
    expect(session.transcript).toHaveLength(4);
  });

  it('compacts stored transcript when dryRun is false', async () => {
    const sessionId = `cleanup-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();
    await saveSession({
      ...(await getSession(sessionId)),
      transcript: [
        { role: 'user', content: 'line 1', at: isoAt(base, 0) },
        { role: 'assistant', content: 'line 2', at: isoAt(base, 10_000) },
        { role: 'user', content: 'line 3', at: isoAt(base, 20_000) },
        { role: 'assistant', content: 'line 4', at: isoAt(base, 30_000) },
      ],
    });

    const run = await cleanupTranscripts({
      dryRun: false,
      sessionId,
      minTurns: 1,
      maxTurns: 2,
    });

    expect(run.compacted).toBe(1);
    const session = await getSession(sessionId);
    expect(session.transcript).toHaveLength(2);
  });

  it('deletes sessions above the configured threshold', async () => {
    const sessionId = `cleanup-delete-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();
    await saveSession({
      ...(await getSession(sessionId)),
      transcript: [
        { role: 'user', content: 'line 1', at: isoAt(base, 0) },
        { role: 'assistant', content: 'line 2', at: isoAt(base, 10_000) },
        { role: 'user', content: 'line 3', at: isoAt(base, 20_000) },
      ],
    });

    const run = await cleanupTranscripts({
      dryRun: false,
      sessionId,
      minTurns: 1,
      deleteAboveTurns: 3,
    });

    expect(run.deleted).toBe(1);
    expect(run.results[0]?.action).toBe('deleted');

    const session = await getSession(sessionId);
    expect(session.transcript).toHaveLength(0);
  });
});
