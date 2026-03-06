import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/ghlKnowledgeBase.js', () => ({
  getGhlKnowledgeBaseContext: vi.fn(),
  listKnowledgeBases: vi.fn(),
  listKnowledgeFaqs: vi.fn(),
  createKnowledgeFaq: vi.fn(),
  updateKnowledgeFaq: vi.fn(),
  deleteKnowledgeFaq: vi.fn(),
}));

vi.mock('../server/ghlAgentPrompts.js', () => ({
  getGhlAgentPrompts: vi.fn(),
  updateGhlAgentPrompts: vi.fn(),
}));

import ghlTrainingGetHandler from '../api/ghl-training-get';
import ghlTrainingSaveHandler from '../api/ghl-training-save';
import {
  getGhlKnowledgeBaseContext,
  listKnowledgeBases,
  listKnowledgeFaqs,
  createKnowledgeFaq,
  updateKnowledgeFaq,
  deleteKnowledgeFaq,
} from '../server/ghlKnowledgeBase.js';
import { getGhlAgentPrompts, updateGhlAgentPrompts } from '../server/ghlAgentPrompts.js';

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

const agentPrompts = {
  locationId: 'loc-123',
  chatAgent: {
    agentId: 'chat-1',
    name: 'Website Chat',
    goal: 'Collect estimate info',
    personality: 'Helpful',
    instructions: 'Ask one question at a time.',
    knowledgeBaseIds: ['kb-1'],
    actionTypes: ['triggerWorkflow'],
  },
  voiceAgent: {
    agentId: 'voice-1',
    agentName: 'Voice Agent',
    businessName: 'Steam Zone',
    welcomeMessage: 'Hi there',
    agentPrompt: 'Voice prompt body',
    timezone: 'America/Winnipeg',
  },
};

describe('GHL training API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getGhlAgentPrompts).mockResolvedValue(agentPrompts);
  });

  it('GET /api/ghl-training-get returns knowledge bases, selected FAQ entries, and agent prompts', async () => {
    vi.mocked(getGhlKnowledgeBaseContext).mockReturnValue({ locationId: 'loc-123' });
    vi.mocked(listKnowledgeBases).mockResolvedValue([
      { id: 'kb-1', name: 'KB One' },
      { id: 'kb-2', name: 'KB Two' },
    ]);
    vi.mocked(listKnowledgeFaqs).mockResolvedValue([
      { id: 'faq-1', knowledgeBaseId: 'kb-2', question: 'Q1', answer: 'A1' },
    ]);

    const res = makeRes();
    await ghlTrainingGetHandler({ method: 'GET', query: { knowledgeBaseId: 'kb-2' } }, res);

    expect(res.code).toBe(200);
    expect(listKnowledgeFaqs).toHaveBeenCalledWith('kb-2');
    expect(getGhlAgentPrompts).toHaveBeenCalled();
    expect(res.payload).toEqual({
      locationId: 'loc-123',
      knowledgeBases: [
        { id: 'kb-1', name: 'KB One' },
        { id: 'kb-2', name: 'KB Two' },
      ],
      selectedKnowledgeBaseId: 'kb-2',
      items: [{ id: 'faq-1', knowledgeBaseId: 'kb-2', question: 'Q1', answer: 'A1' }],
      agentPrompts,
      message: 'Loaded 1 GHL FAQ entries.',
    });
  });

  it('POST /api/ghl-training-save rejects incomplete rows', async () => {
    const res = makeRes();
    await ghlTrainingSaveHandler(
      {
        method: 'POST',
        body: {
          knowledgeBaseId: 'kb-1',
          items: [{ question: 'Only a question', answer: '' }],
          deletedIds: [],
          agentPrompts: {
            chatAgent: {
              goal: 'Collect estimate info',
              personality: 'Helpful',
              instructions: 'Ask one question at a time.',
            },
            voiceAgent: {
              welcomeMessage: 'Hi there',
              agentPrompt: 'Voice prompt body',
            },
          },
        },
      },
      res
    );

    expect(res.code).toBe(400);
    expect(res.payload).toEqual({
      message: 'Each row needs both question and answer. Incomplete row numbers: 1.',
    });
  });

  it('POST /api/ghl-training-save performs create, update, delete, and prompt save operations before returning refreshed data', async () => {
    vi.mocked(listKnowledgeFaqs)
      .mockResolvedValueOnce([
        { id: 'faq-1', knowledgeBaseId: 'kb-1', question: 'Old question', answer: 'Old answer' },
        { id: 'faq-2', knowledgeBaseId: 'kb-1', question: 'Keep', answer: 'Same' },
        { id: 'faq-3', knowledgeBaseId: 'kb-1', question: 'Remove me', answer: 'Delete me' },
      ])
      .mockResolvedValueOnce([
        { id: 'faq-1', knowledgeBaseId: 'kb-1', question: 'New question', answer: 'New answer' },
        { id: 'faq-2', knowledgeBaseId: 'kb-1', question: 'Keep', answer: 'Same' },
        { id: 'faq-4', knowledgeBaseId: 'kb-1', question: 'Fresh', answer: 'Brand new' },
      ]);

    const updatedPrompts = {
      ...agentPrompts,
      chatAgent: { ...agentPrompts.chatAgent, instructions: 'Updated chat instructions' },
      voiceAgent: { ...agentPrompts.voiceAgent, agentPrompt: 'Updated voice prompt' },
    };
    vi.mocked(updateGhlAgentPrompts).mockResolvedValue(updatedPrompts);

    const res = makeRes();
    await ghlTrainingSaveHandler(
      {
        method: 'POST',
        body: {
          knowledgeBaseId: 'kb-1',
          items: [
            { id: 'faq-1', question: 'New question', answer: 'New answer' },
            { id: 'faq-2', question: 'Keep', answer: 'Same' },
            { question: 'Fresh', answer: 'Brand new' },
          ],
          deletedIds: ['faq-3'],
          agentPrompts: {
            chatAgent: {
              goal: 'Collect estimate info',
              personality: 'Helpful',
              instructions: 'Updated chat instructions',
            },
            voiceAgent: {
              welcomeMessage: 'Hi there',
              agentPrompt: 'Updated voice prompt',
            },
          },
        },
      },
      res
    );

    expect(updateKnowledgeFaq).toHaveBeenCalledWith('faq-1', 'kb-1', 'New question', 'New answer');
    expect(createKnowledgeFaq).toHaveBeenCalledWith('kb-1', 'Fresh', 'Brand new');
    expect(deleteKnowledgeFaq).toHaveBeenCalledWith('faq-3');
    expect(updateGhlAgentPrompts).toHaveBeenCalledWith({
      chatAgent: {
        goal: 'Collect estimate info',
        personality: 'Helpful',
        instructions: 'Updated chat instructions',
      },
      voiceAgent: {
        welcomeMessage: 'Hi there',
        agentPrompt: 'Updated voice prompt',
      },
    });
    expect(res.code).toBe(200);
    expect(res.payload).toEqual({
      items: [
        { id: 'faq-1', knowledgeBaseId: 'kb-1', question: 'New question', answer: 'New answer' },
        { id: 'faq-2', knowledgeBaseId: 'kb-1', question: 'Keep', answer: 'Same' },
        { id: 'faq-4', knowledgeBaseId: 'kb-1', question: 'Fresh', answer: 'Brand new' },
      ],
      knowledgeBaseId: 'kb-1',
      counts: {
        created: 1,
        updated: 1,
        deleted: 1,
      },
      agentPrompts: updatedPrompts,
      previousPrompts: agentPrompts,
      message: 'Saved GHL knowledge base changes (1 created, 1 updated, 1 deleted). Saved live GHL chat and voice prompts.',
    });
  });
});
