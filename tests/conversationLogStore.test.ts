import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appendConversationTurn, loadConversationSession } from '../server/conversationLogStore';

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function isoAt(baseMs: number, deltaMs: number): string {
  return new Date(baseMs + deltaMs).toISOString();
}

describe('conversationLogStore dedupe and channel normalization', () => {
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

  it('upgrades unknown channel turn to voice when the same assistant text arrives channel-tagged', async () => {
    const sessionId = `log-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: 'Thanks for calling Steam Zone.',
      at: isoAt(base, 0),
    });
    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: '[voice] Thanks for calling Steam Zone!',
      at: isoAt(base, 2_000),
    });

    const session = await loadConversationSession(sessionId);
    expect(session.transcript.length).toBe(1);
    expect(session.transcript[0]?.content).toBe('Thanks for calling Steam Zone!');
    expect(session.transcript[0]?.channel).toBe('voice');
  });

  it('dedupes near-identical user turns within dedupe window', async () => {
    const sessionId = `log-dedupe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    await appendConversationTurn(sessionId, {
      role: 'user',
      content: '[voice] Window cleaning',
      at: isoAt(base, 0),
    });
    await appendConversationTurn(sessionId, {
      role: 'user',
      content: '[voice] window cleaning.',
      at: isoAt(base, 3_000),
    });

    const session = await loadConversationSession(sessionId);
    expect(session.transcript.length).toBe(1);
  });

  it('keeps repeated turns when they are outside dedupe window', async () => {
    const sessionId = `log-repeat-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: '[voice] One moment while I check that for you.',
      at: isoAt(base, 0),
    });
    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: '[voice] One moment while I check that for you.',
      at: isoAt(base, 35_000),
    });

    const session = await loadConversationSession(sessionId);
    expect(session.transcript.length).toBe(2);
  });

  it('does not downgrade known channel to unknown on duplicate content', async () => {
    const sessionId = `log-no-downgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: '[voice] Your estimate is ready.',
      at: isoAt(base, 0),
    });
    await appendConversationTurn(sessionId, {
      role: 'assistant',
      content: 'Your estimate is ready!',
      at: isoAt(base, 2_500),
    });

    const session = await loadConversationSession(sessionId);
    expect(session.transcript.length).toBe(1);
    expect(session.transcript[0]?.content).toBe('Your estimate is ready.');
    expect(session.transcript[0]?.channel).toBe('voice');
  });
});
