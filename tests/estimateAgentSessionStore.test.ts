import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appendTranscript, getSession, saveSession } from '../server/estimateAgentSessionStore';

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function toIso(baseMs: number, offsetMs: number): string {
  return new Date(baseMs + offsetMs).toISOString();
}

describe('estimateAgentSessionStore transcript persistence', () => {
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

  it('does not duplicate transcript entries when saving an unchanged session object', async () => {
    const sessionId = `agent-session-dup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    const initial = await getSession(sessionId);
    const seeded = await saveSession({
      ...initial,
      transcript: [
        {
          role: 'user',
          content: 'Hello, I need an estimate for windows.',
          at: toIso(base, 0),
        },
      ],
    });

    const firstSave = await saveSession(seeded);
    expect(firstSave.transcript).toHaveLength(1);

    const secondSave = await saveSession(firstSave);
    expect(secondSave.transcript).toHaveLength(1);
    expect(secondSave.transcript[0]?.content).toBe('Hello, I need an estimate for windows.');
  });

  it('dedupes duplicate appendTranscript calls for the same content and timestamp window', async () => {
    const sessionId = `agent-session-append-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    const added = await appendTranscript(sessionId, {
      role: 'assistant',
      content: 'I can help with that.',
      at: toIso(base, 0),
    });

    const duplicated = await appendTranscript(sessionId, {
      role: 'assistant',
      content: 'I can help with that.',
      at: toIso(base, 2_000),
    });

    expect(added.transcript).toHaveLength(1);
    expect(duplicated.transcript).toHaveLength(1);
    expect(duplicated.transcript[0]?.content).toBe('I can help with that.');
  });
});

