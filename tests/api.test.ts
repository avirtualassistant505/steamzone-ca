import { afterEach, describe, expect, it, vi } from 'vitest';
import quoteHandler from '../api/quote';
import estimateCreateHandler from '../api/estimate-create';
import estimateAgentChatHandler from '../api/estimate-agent/chat';
import transcriptsCleanupHandler from '../api/transcripts-cleanup';
import transcriptsGetHandler from '../api/transcripts-get';
import { appendConversationTurn } from '../server/conversationLogStore';
import { calculateEstimate, createDefaultCarpetInput, createDefaultPricingConfig } from '../src/lib/estimateEngine';

interface MockRes {
  code: number;
  payload: unknown;
  status: (code: number) => MockRes;
  json: (body: unknown) => void;
}

function makeRes(): MockRes {
  return {
    code: 200,
    payload: null,
    status(code: number) {
      this.code = code;
      return this;
    },
    json(body: unknown) {
      this.payload = body;
    },
  };
}

describe('API routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('POST /api/quote returns validation failure for missing required fields', async () => {
    const res = makeRes();
    await quoteHandler(
      {
        method: 'POST',
        body: {
          answers: {
            serviceType: 'window',
          },
        },
      },
      res
    );

    expect(res.code).toBe(400);
    const payload = res.payload as { message: string; errors: string[] };
    expect(payload.message).toMatch(/validation failed/i);
    expect(payload.errors.length).toBeGreaterThan(0);
  });

  it('POST /api/quote returns deterministic quote on success', async () => {
    const res = makeRes();
    await quoteHandler(
      {
        method: 'POST',
        body: {
          answers: {
            serviceType: 'window',
            postalCode: 'R5G 2X3',
            zone: 'zoneA',
            storey: 'bungalow',
            sizeBracket: '1000to1500',
            scope: 'exterior',
            screens: 'none',
            tracks: 'basic',
            hardToReach: false,
            hardWaterRemoval: false,
            constructionDebris: false,
            slidingRemoval: 'none',
            slidingQuantity: 0,
            patioDoors: 'none',
            patioQuantity: 0,
            skylights: 'none',
            skylightQuantity: 0,
            railingGlass: 'none',
            frenchPanes: 'none',
            sunroom: false,
            walkoutBasement: false,
            contact: {
              fullName: 'Jane Test',
              address: '',
              phone: '(236) 506-6570',
              email: 'jane@example.com',
              consentToContact: true,
              marketingOptIn: false,
            },
            'contact.fullName': 'Jane Test',
            'contact.phone': '(236) 506-6570',
            'contact.email': 'jane@example.com',
            'contact.consentToContact': true,
          },
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { quote: { quote_id: string; total: number; currency: string; line_items: unknown[] } };
    expect(payload.quote.quote_id).toMatch(/^Q-/);
    expect(payload.quote.total).toBeGreaterThan(0);
    expect(payload.quote.currency).toBe('CAD');
    expect(payload.quote.line_items.length).toBeGreaterThanOrEqual(3);
  });

  it('POST /api/quote respects explicitly provided zone when postal-derived zone differs', async () => {
    const answers = {
      serviceType: 'carpet',
      postalCode: 'R5G 0H4',
      zone: 'zoneC',
      estimateMode: 'rooms',
      rooms: 6,
      sqftBracket: '1000to1500',
      condition: 'light',
      stairsSteps: 2,
      hallways: 2,
      advancedStainRemoval: true,
      odorElimination: false,
      petTreatment: true,
      stainProtector: true,
      furnitureMoving: 'heavy',
      unusualCondition: false,
      schedule: 'flexible',
      contact: {
        fullName: 'Jane Zone Test',
        address: '',
        phone: '(236) 506-6570',
        email: 'jane.zone@example.com',
        consentToContact: true,
        marketingOptIn: false,
      },
    };

    const res = makeRes();
    await quoteHandler({ method: 'POST', body: { answers } }, res);
    expect(res.code).toBe(200);

    const payload = res.payload as { quote: { total: number } };
    const expectedInput = { ...createDefaultCarpetInput(), ...answers };
    const expected = calculateEstimate('carpet', expectedInput, createDefaultPricingConfig());
    expect(payload.quote.total).toBe(expected.subtotal);
    expect(payload.quote.total).toBe(680);
  });

  it('POST /api/estimate-create accepts strict string-typed workflow payload for conditional integer fields', async () => {
    const prevGhlToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
    const prevGhlAccess = process.env.GHL_ACCESS_TOKEN;
    const prevGhlLocation = process.env.GHL_LOCATION_ID;
    process.env.GHL_PRIVATE_INTEGRATION_TOKEN = '';
    process.env.GHL_ACCESS_TOKEN = '';
    process.env.GHL_LOCATION_ID = '';

    const res = makeRes();
    try {
      await estimateCreateHandler(
        {
          method: 'POST',
          body: {
            send_email: false,
            strict: true,
            source: 'form',
            serviceType: 'window',
            postalCode: 'R5G 2X3',
            zone: 'zoneA',
            storey: 'two',
            sizeBracket: '1500to2000',
            scope: 'both',
            screens: 'some',
            tracks: 'detailed',
            hardToReach: 'true',
            hardWaterRemoval: 'false',
            constructionDebris: 'false',
            slidingRemoval: 'threePanel',
            slidingQuantity: '2',
            patioDoors: 'slideOnly',
            patioQuantity: '1',
            skylights: 'both',
            skylightQuantity: '1',
            railingGlass: 'none',
            frenchPanes: 'some',
            sunroom: 'false',
            walkoutBasement: 'false',
            fullName: 'Jane Strict',
            phone: '+12045550123',
            email: 'jane.strict@example.com',
            address: '120 Parkside Crescent',
            consentToContact: 'true',
            marketingOptIn: 'false',
          },
        },
        res
      );

      expect(res.code).toBe(200);
      const payload = res.payload as { record: { serviceType: string; answers: { slidingQuantity: number; patioQuantity: number; skylightQuantity: number } } };
      expect(payload.record.serviceType).toBe('window');
      expect(payload.record.answers.slidingQuantity).toBe(2);
      expect(payload.record.answers.patioQuantity).toBe(1);
      expect(payload.record.answers.skylightQuantity).toBe(1);
    } finally {
      process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevGhlToken;
      process.env.GHL_ACCESS_TOKEN = prevGhlAccess;
      process.env.GHL_LOCATION_ID = prevGhlLocation;
    }
  });

  it('POST /api/estimate-agent/chat returns assistant message on basic happy path', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const modelPayload = {
      id: 'resp_1',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'Sure, what service do you need an estimate for?' }],
        },
      ],
      output_text: 'Sure, what service do you need an estimate for?',
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => JSON.stringify(modelPayload),
        json: async () => modelPayload,
      }))
    );

    const res = makeRes();
    await estimateAgentChatHandler(
      {
        method: 'POST',
        body: {
          session_id: 'session-test-1',
          user_message: 'Hi there',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as {
      assistant_message: string;
      state: { answers: Record<string, unknown>; asked_keys: string[]; last_question_key: string | null };
      done: boolean;
    };

    expect(payload.assistant_message).toMatch(/service/i);
    expect(payload.state).toBeTruthy();
    expect(Array.isArray(payload.state.asked_keys)).toBe(true);
    expect(typeof payload.done).toBe('boolean');
  });

  it('POST /api/transcripts-cleanup defaults to dry_run and returns a result', async () => {
    const res = makeRes();
    await transcriptsCleanupHandler(
      {
        method: 'POST',
        body: {
          session_id: `cleanup-api-${Date.now()}`,
          min_turns: 1,
          max_turns: 10,
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { dry_run: boolean; scanned: number };
    expect(payload.dry_run).toBe(true);
    expect(payload.scanned).toBeGreaterThanOrEqual(1);
  });

  it('POST /api/transcripts-cleanup rejects execute mode without explicit confirmation', async () => {
    const res = makeRes();
    await transcriptsCleanupHandler(
      {
        method: 'POST',
        body: {
          dry_run: false,
          session_id: `cleanup-api-${Date.now()}`,
          min_turns: 1,
        },
      },
      res
    );

    expect(res.code).toBe(400);
    const payload = res.payload as { message: string };
    expect(payload.message).toMatch(/confirm=\"cleanup\"/i);
  });

  it('GET /api/transcripts-get hides assistant-only bootstrap sessions by default', async () => {
    const bootstrapSessionId = `bootstrap-only-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const normalSessionId = `normal-session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const base = Date.now();

    await appendConversationTurn(bootstrapSessionId, {
      role: 'assistant',
      content: 'Hi there, thanks for reaching out to Steam Zone. How can I help today?',
      at: new Date(base).toISOString(),
      channel: 'web',
    });

    await appendConversationTurn(normalSessionId, {
      role: 'assistant',
      content: 'Hi there, thanks for reaching out to Steam Zone. How can I help today?',
      at: new Date(base + 1000).toISOString(),
      channel: 'web',
    });
    await appendConversationTurn(normalSessionId, {
      role: 'user',
      content: 'I need a quote for windows.',
      at: new Date(base + 2000).toISOString(),
      channel: 'web',
    });

    const filteredRes = makeRes();
    await transcriptsGetHandler(
      {
        method: 'GET',
        query: {
          limit: '100',
        },
      },
      filteredRes
    );

    expect(filteredRes.code).toBe(200);
    const filteredPayload = filteredRes.payload as { sessions: Array<{ session_id: string }>; storage_mode: string };
    const filteredIds = filteredPayload.sessions.map((item) => item.session_id);
    expect(filteredIds).toContain(normalSessionId);
    expect(filteredIds).not.toContain(bootstrapSessionId);

    const includeRes = makeRes();
    await transcriptsGetHandler(
      {
        method: 'GET',
        query: {
          limit: '100',
          include_bootstrap_only: 'true',
        },
      },
      includeRes
    );

    expect(includeRes.code).toBe(200);
    const includePayload = includeRes.payload as { sessions: Array<{ session_id: string }>; storage_mode: string };
    const includeIds = includePayload.sessions.map((item) => item.session_id);
    expect(includeIds).toContain(normalSessionId);
    expect(includeIds).toContain(bootstrapSessionId);
  });
});
