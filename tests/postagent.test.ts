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
      'Need window cleaning. postal code R5G2X3, zone zoneA, storey bungalow, size bracket under1000, scope exterior, screens none, tracks basic, hard reach no, hard water no, construction debris no, sliding removal none, patio doors none, skylights none, railing glass none, french panes none, sunroom no, walkout no, my name is Jane Test, phone 2365066570, email jane@example.com, consent yes',
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
