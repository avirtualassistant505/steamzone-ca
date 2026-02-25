import { afterEach, describe, expect, it, vi } from 'vitest';
import postagentHandler from '../api/postagent/estimate';
import {
  loadSchema,
  normalizeAndSetAnswersFromInput,
  runEstimateAgentCore,
} from '../src/estimate/core/estimateAgentCore';
import * as estimateAgentRuntime from '../server/estimateAgentRuntimeEntry';

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

function mockOpenAIMessage(message = 'Got it.') {
  const payload = {
    id: 'resp-postagent-1',
    output: [
      {
        type: 'message',
        content: [{ type: 'output_text', text: message }],
      },
    ],
    output_text: message,
  };

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify(payload),
      json: async () => payload,
    }))
  );
}

async function completeWindowAnswers(sessionId: string): Promise<void> {
  mockOpenAIMessage('Thanks, I have that.');
  await runEstimateAgentCore({
    session_id: sessionId,
    input_text:
      'I need a quote for window cleaning. postal code R5G2X3, zone zoneA, storey bungalow, size bracket under1000, scope exterior, screens none, tracks basic, hard reach no, hard water no, construction debris no, sliding removal none, patio doors none, skylights none, railing glass none, french panes none, sunroom no, walkout no, my name is Jane Test, phone 2365066570, email jane@example.com, consent yes',
    channel: 'test',
  });
}

describe('POST /api/postagent/estimate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('creates a session when session_id is missing and returns shared agent response', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('What service do you need?');

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          input_text: 'Hi, estimate needed',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { session_id: string; assistant_message: string; done: boolean };
    expect(payload.session_id).toBeTruthy();
    expect(payload.assistant_message).toMatch(/service|estimate/i);
    expect(payload.done).toBe(false);
  });

  it('returns assistant bootstrap opener without creating a fake user opener turn', async () => {
    const sessionId = `postagent-bootstrap-${Date.now()}`;
    const res = makeRes();

    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: '',
          bootstrap: true,
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toMatch(/thanks for reaching out to Steam Zone/i);

    const session = await estimateAgentRuntime.getSession(sessionId);
    expect(session.transcript.length).toBeGreaterThan(0);
    expect(session.transcript[0]?.role).toBe('assistant');
    expect(session.transcript[0]?.content).toMatch(/thanks for reaching out to Steam Zone/i);
  });

  it('ignores bootstrap state_hint hydration and keeps new session empty', async () => {
    const sessionId = `postagent-bootstrap-nohydrate-${Date.now()}`;
    const res = makeRes();

    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: '',
          bootstrap: true,
          state_hint: {
            session_id: sessionId,
            answers: {
              serviceType: 'window',
              postalCode: 'R5G 2X3',
              contact: { email: 'stale@example.com' },
            },
            asked_keys: ['serviceType', 'postalCode'],
            last_question_key: 'zone',
            mode: 'estimate',
          },
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { state: { answers: Record<string, unknown>; mode: string } };
    expect(payload.state.mode).toBe('support');
    expect(payload.state.answers.serviceType).toBeUndefined();
    expect(payload.state.answers.postalCode).toBeUndefined();

    const session = await estimateAgentRuntime.getSession(sessionId);
    expect(session.answers.serviceType).toBeUndefined();
    expect(session.answers.postalCode).toBeUndefined();
    expect(session.transcript[0]?.role).toBe('assistant');
  });

  it('rejects empty input when bootstrap is false', async () => {
    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: `postagent-empty-${Date.now()}`,
          input_text: '',
        },
      },
      res
    );

    expect(res.code).toBe(400);
    const payload = res.payload as { message: string };
    expect(payload.message).toMatch(/input_text is required/i);
  });

  it('ignores state_hint when state_hint.session_id does not match request session_id', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('I can help with that.');
    const sessionId = `postagent-mismatch-hint-${Date.now()}`;

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'What is the temperature today?',
          state_hint: {
            session_id: 'different-session-id',
            answers: {
              serviceType: 'window',
              postalCode: 'R5G 2X3',
              contact: { email: 'stale@example.com' },
            },
            asked_keys: ['serviceType', 'postalCode'],
            last_question_key: 'zone',
            mode: 'estimate',
          },
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as {
      quote: unknown;
      done: boolean;
      state: { mode: string; answers: Record<string, unknown> };
    };
    expect(payload.done).toBe(false);
    expect(payload.quote).toBeNull();
    expect(payload.state.mode).toBe('support');
    expect(payload.state.answers.serviceType).toBeUndefined();
  });

  it('extracts multiple answers from a single turn when possible', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Thanks, I have that.');
    const sessionId = 'postagent-multi-1';

    const first = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I need a window estimate',
        },
      },
      first
    );
    expect(first.code).toBe(200);

    const second = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text:
            'Zone zoneA, postal code R5G2X3, size bracket under1000, scope exterior, screens none, tracks basic, sliding none, patio none, skylights none, french none, railing none, storey bungalow, my name is Jane Test, phone 2365066570, email jane@example.com, consent yes',
        },
      },
      second
    );

    expect(second.code).toBe(200);
    const payload = second.payload as { state: { answers: Record<string, unknown> } };
    expect(payload.state.answers.serviceType).toBe('window');
    expect(payload.state.answers).toMatchObject({
      postalCode: 'R5G 2X3',
      zone: 'zoneA',
      sizeBracket: 'under1000',
      scope: 'exterior',
      storey: 'bungalow',
    });
  });

  it('does not start estimate questions from a general service inquiry', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('We can clean commercial jobs. Can I help with something else?');
    const sessionId = 'postagent-no-estimate-start-1';

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Do you clean windows for big businesses?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { state: { answers: Record<string, unknown> } };
    expect(payload.state.answers.serviceType).toBeUndefined();
  });

  it('starts estimate collection only after the user requests a quote', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Great. I can do this estimate. What is the postal code?');
    const sessionId = 'postagent-estimate-start-2';

    const pre = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I do clean windows for big businesses.',
        },
      },
      pre
    );
    expect(pre.code).toBe(200);

    const next = makeRes();
    mockOpenAIMessage('Great. I can do this estimate. What is the postal code?');
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I would like to do a quote for windows.',
        },
      },
      next
    );

    expect(next.code).toBe(200);
    const nextPayload = next.payload as { state: { answers: Record<string, unknown> }; done: boolean };
    expect(nextPayload.state.answers.serviceType).toBe('window');
    expect(nextPayload.done).toBe(false);
    expect(nextPayload.assistant_message).toMatch(/postal|address|estimate/i);
  });

  it('does not carry completed estimate state into a brand-new session after bootstrap', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const oldSessionId = `postagent-old-complete-${Date.now()}`;
    await completeWindowAnswers(oldSessionId);
    const oldSession = await estimateAgentRuntime.getSession(oldSessionId);
    expect(oldSession.answers.serviceType).toBe('window');

    const newSessionId = `postagent-new-clean-${Date.now()}`;
    const bootstrap = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: newSessionId,
          input_text: '',
          bootstrap: true,
          state_hint: {
            session_id: oldSessionId,
            answers: oldSession.answers,
            asked_keys: oldSession.asked_keys,
            last_question_key: oldSession.last_question_key,
            mode: 'estimate',
          },
        },
      },
      bootstrap
    );
    expect(bootstrap.code).toBe(200);

    mockOpenAIMessage('Sure, what can I help with?');
    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: newSessionId,
          input_text: 'What is the temperature today?',
          state_hint: {
            session_id: oldSessionId,
            answers: oldSession.answers,
            asked_keys: oldSession.asked_keys,
            last_question_key: oldSession.last_question_key,
            mode: 'estimate',
          },
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as {
      assistant_message: string;
      quote: unknown;
      done: boolean;
      state: { mode: string; answers: Record<string, unknown> };
    };
    expect(payload.done).toBe(false);
    expect(payload.quote).toBeNull();
    expect(payload.state.mode).toBe('support');
    expect(payload.state.answers.serviceType).toBeUndefined();
    expect(payload.assistant_message).not.toMatch(/everything for your estimate|subtotal/i);
  });

  it('handles plural estimate intent by asking deterministic confirmation first', async () => {
    const sessionId = 'postagent-plural-estimate-intent-1';

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Do you provide estimates?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string; state: { mode: string; answers: Record<string, unknown> } };
    expect(payload.state.mode).toBe('support');
    expect(payload.state.answers.serviceType).toBeUndefined();
    expect(payload.assistant_message).toMatch(/start.*estimate|estimate.*now/i);
  });

  it('keeps a freshly bootstrapped session in support mode until estimate is explicitly requested', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Absolutely, what can I help you with?');
    const sessionId = `postagent-fresh-support-${Date.now()}`;

    const bootstrap = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: '',
          bootstrap: true,
        },
      },
      bootstrap
    );
    expect(bootstrap.code).toBe(200);

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Do you clean windows for offices?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { state: { mode: string; answers: Record<string, unknown> }; done: boolean; quote: unknown };
    expect(payload.state.mode).toBe('support');
    expect(payload.state.answers.serviceType).toBeUndefined();
    expect(payload.done).toBe(false);
    expect(payload.quote).toBeNull();
  });

  it('asks confirmation first for aggressive booking signal', async () => {
    const sessionId = 'postagent-aggressive-confirmation-1';

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I want to book cleaning this week.',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string; state: { mode: string } };
    expect(payload.state.mode).toBe('support');
    expect(payload.assistant_message).toMatch(/start.*estimate|estimate.*now/i);
  });

  it('enters estimate mode after user confirms pending estimate prompt', async () => {
    const sessionId = 'postagent-confirmation-enter-estimate-1';

    const first = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I want to book cleaning this week.',
        },
      },
      first
    );
    expect(first.code).toBe(200);

    const second = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'yes',
        },
      },
      second
    );

    expect(second.code).toBe(200);
    const payload = second.payload as { assistant_message: string; state: { mode: string } };
    expect(payload.state.mode).toBe('estimate');
    expect(payload.assistant_message).toMatch(/what service are you looking to estimate/i);
  });

  it('keeps estimate flow on serviceType when unsupported service is requested', async () => {
    const sessionId = 'postagent-unsupported-estimate-service-1';

    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I need an estimate.',
        },
      },
      makeRes()
    );

    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'yes',
        },
      },
      makeRes()
    );

    const third = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'grout',
        },
      },
      third
    );

    expect(third.code).toBe(200);
    const payload = third.payload as { assistant_message: string; state: { mode: string }; next_question?: { key: string } };
    expect(payload.state.mode).toBe('estimate');
    expect(payload.assistant_message).toMatch(/only provide instant estimates/i);
    expect(payload.assistant_message).toMatch(/Residential Windows/i);
    expect(payload.next_question?.key).toBe('serviceType');
  });

  it('returns ambiguity for range-like numeric input', async () => {
    const sessionId = 'postagent-range-1';
    const schema = await loadSchema();
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'serviceType', 'carpet');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'estimateMode', 'rooms');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'postalCode', 'R5G 2X3');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'zone', 'zoneA');

    const state = await estimateAgentRuntime.toolGetState(sessionId);
    const next = await estimateAgentRuntime.peekNextQuestion(sessionId);

    const result = await normalizeAndSetAnswersFromInput(
      estimateAgentRuntime,
      sessionId,
      'about 10-12 rooms',
      schema,
      state,
      next
    );

    expect(result.applied.length).toBe(0);
    expect(result.ambiguity.length).toBeGreaterThan(0);
    expect(result.ambiguity[0]).toMatch(/range|ambiguous/i);
  });

  it('supports user correction updates the most recent target field', async () => {
    const sessionId = 'postagent-correction-1';
    const schema = await loadSchema();
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'serviceType', 'carpet');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'postalCode', 'R5G 2X3');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'zone', 'zoneA');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'estimateMode', 'rooms');
    await estimateAgentRuntime.toolNextQuestion(sessionId); // sets last_question_key to rooms

    const state = await estimateAgentRuntime.toolGetState(sessionId);
    const next = await estimateAgentRuntime.peekNextQuestion(sessionId);

    const result = await normalizeAndSetAnswersFromInput(
      estimateAgentRuntime,
      sessionId,
      'actually 4',
      schema,
      state,
      next
    );

    const updated = await estimateAgentRuntime.toolGetState(sessionId);
    const appliedRoom = result.applied.find((entry) => entry.field_key === 'rooms');
    expect(appliedRoom).toBeTruthy();
    expect(appliedRoom?.normalized_value).toBe(4);
    expect(updated.answers.rooms).toBe(4);
  });

  it('does not compute quote until all required fields are present', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Working on that.');
    const sessionId = 'postagent-quote-incomplete-1';

    const incomplete = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Need an estimate',
        },
      },
      incomplete
    );
    expect(incomplete.code).toBe(200);
    expect((incomplete.payload as { quote: unknown }).quote).toBeNull();

    await completeWindowAnswers(sessionId);
    mockOpenAIMessage('Ready with quote.');
    const complete = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Confirm the details',
        },
      },
      complete
    );

    expect(complete.code).toBe(200);
    const payload = complete.payload as { done?: boolean; quote?: { quote_id: string } | null };
    if (payload.done) {
      expect(payload.quote).toBeTruthy();
      expect(payload.quote?.quote_id).toMatch(/^Q-/);
    } else {
      expect(payload.quote).toBeNull();
    }
  });

  it('clears pending confirmation metadata on completed estimates', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Thanks, I have that.');
    const sessionId = `postagent-clear-pending-complete-${Date.now()}`;
    await completeWindowAnswers(sessionId);

    const complete = await estimateAgentRuntime.getSession(sessionId);
    expect(complete.answers.__pending_estimate_confirmation).toBe(false);
    expect(complete.answers.__pending_estimate_context).toBeNull();
    expect(complete.answers.__pending_estimate_confirmation_at).toBeNull();
  });

  it('uses Steam Zone FAQ knowledge for direct business info questions', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('Hi, how are you? What city/area are you looking for?');

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: 'postagent-knowledge-address-1',
          input_text: 'What is your business address?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toMatch(/120 Parkside Crescent/i);
  });

  it('offers team follow-up instead of guessing when answer is not in FAQ data', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage("I don't have reliable public info on that.");

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: 'postagent-unknown-followup-1',
          input_text: 'Who owns this company?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toMatch(/team member/i);
    expect(payload.assistant_message).toMatch(/call|text|email/i);
  });

  it('responds naturally for vague conversational prompts without callback fallback', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage("I don't have that in QA.");

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: `postagent-vague-${Date.now()}`,
          input_text: 'What is happening?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toMatch(/here and ready to help/i);
    expect(payload.assistant_message).not.toMatch(/team member follow up|best contact/i);
  });

  it('suppresses mid-session greeting reset responses', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const sessionId = 'postagent-mid-session-greeting-1';

    mockOpenAIMessage('Thanks for reaching out. What can I help with?');
    const first = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Hello',
        },
      },
      first
    );
    expect(first.code).toBe(200);

    mockOpenAIMessage('Hi, how are you? What can I help you with today?');
    const second = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Winnipeg',
        },
      },
      second
    );

    expect(second.code).toBe(200);
    const payload = second.payload as { assistant_message: string };
    expect(payload.assistant_message).not.toMatch(/^hi[,! ]/i);
    expect(payload.assistant_message.trim().length).toBeGreaterThan(0);
  });

  it('does not reset to warm greeting on location answer during estimate mode', async () => {
    const sessionId = 'postagent-estimate-no-greeting-reset-1';
    const seeded = await estimateAgentRuntime.getSession(sessionId);
    await estimateAgentRuntime.saveSession({
      ...seeded,
      answers: {
        ...seeded.answers,
        __session_mode: 'estimate',
        serviceType: 'window',
      },
      mode: 'estimate',
    });

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'Winnipeg',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string; state: { mode: string } };
    expect(payload.state.mode).toBe('estimate');
    expect(payload.assistant_message).not.toMatch(/^hi[,! ]/i);
    expect(payload.assistant_message).toMatch(/postal code|zone/i);
  });

  it('returns bounded schema service catalog for service list questions', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('We offer tile and grout cleaning and upholstery.');

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: 'postagent-bounded-services-1',
          input_text: 'What services do you offer?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toMatch(/Residential Windows/i);
    expect(payload.assistant_message).toMatch(/Commercial Windows/i);
    expect(payload.assistant_message).toMatch(/Carpet Cleaning/i);
    expect(payload.assistant_message).toMatch(/Post-Construction/i);
    expect(payload.assistant_message).not.toMatch(/grout|tile|upholstery/i);
  });

  it('does not auto-fill contact.phone from square footage-style numeric tokens', async () => {
    const sessionId = `postagent-phone-overfill-${Date.now()}`;
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'serviceType', 'postConstruction');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'postalCode', 'R5G 2X3');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'zone', 'zoneA');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'projectType', 'commercial');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'buildType', 'newBuild');

    const schema = await loadSchema();
    const state = await estimateAgentRuntime.toolGetState(sessionId);
    const next = await estimateAgentRuntime.peekNextQuestion(sessionId);

    const result = await normalizeAndSetAnswersFromInput(
      estimateAgentRuntime,
      sessionId,
      '1000to2500',
      schema,
      state,
      next
    );

    const updated = await estimateAgentRuntime.toolGetState(sessionId);
    expect(result.applied.some((entry) => entry.field_key === 'sqftBracket')).toBe(true);
    expect(updated.answers['contact.phone']).toBeUndefined();
    expect((updated.answers.contact as { phone?: string } | undefined)?.phone).toBeUndefined();
  });

  it('limits simple yes/no replies to current question instead of boolean fan-out', async () => {
    const sessionId = `postagent-yes-fanout-${Date.now()}`;
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'serviceType', 'postConstruction');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'postalCode', 'R5G 2X3');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'zone', 'zoneA');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'projectType', 'commercial');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'buildType', 'newBuild');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'sqftBracket', '1000to2500');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'floors', 2);
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'stage', 'light');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'interiorWindows', 'large');
    await estimateAgentRuntime.toolSetAnswer(sessionId, 'scraping', 'lots');
    const baseState = await estimateAgentRuntime.toolGetState(sessionId);
    await estimateAgentRuntime.saveSession({
      ...baseState,
      last_question_key: 'insideCabinets',
      asked_keys: baseState.asked_keys.includes('insideCabinets')
        ? baseState.asked_keys
        : [...baseState.asked_keys, 'insideCabinets'],
    });

    const schema = await loadSchema();
    const state = await estimateAgentRuntime.toolGetState(sessionId);
    const next = {
      done: false,
      next_field_key: 'insideCabinets',
      question_text: 'Inside cabinets / drawers? (Yes/No)',
    };

    const result = await normalizeAndSetAnswersFromInput(
      estimateAgentRuntime,
      sessionId,
      'yes',
      schema,
      state,
      next
    );

    expect(result.applied.length).toBe(1);
    expect(result.applied[0]?.field_key).toBe('insideCabinets');

    const updated = await estimateAgentRuntime.toolGetState(sessionId);
    expect(updated.answers.insideCabinets).toBe(true);
    expect(updated.answers.multiTenantAccess).toBeUndefined();
    expect(updated.answers.specialDetailing).toBeUndefined();
    expect(updated.answers.appliances).toBeUndefined();
  });

  it('clears pending estimate confirmation metadata after entering estimate mode', async () => {
    const sessionId = `postagent-clear-pending-${Date.now()}`;

    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'I would like an estimate.',
        },
      },
      makeRes()
    );
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: sessionId,
          input_text: 'yes',
        },
      },
      makeRes()
    );

    const session = await estimateAgentRuntime.getSession(sessionId);
    expect(session.answers.__pending_estimate_confirmation).toBe(false);
    expect(session.answers.__pending_estimate_context).toBeNull();
    expect(session.answers.__pending_estimate_confirmation_at).toBeNull();
  });

  it('strips markdown emphasis characters from assistant messages', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockOpenAIMessage('**Hi**, this is your **estimate** estimate flow.');

    const res = makeRes();
    await postagentHandler(
      {
        method: 'POST',
        body: {
          session_id: 'postagent-markdown-cleanup-1',
          input_text: 'What areas do you serve?',
        },
      },
      res
    );

    expect(res.code).toBe(200);
    const payload = res.payload as { assistant_message: string };
    expect(payload.assistant_message).toContain('Hi, this is your estimate estimate flow.');
    expect(payload.assistant_message).not.toMatch(/\*/);
  });
});
