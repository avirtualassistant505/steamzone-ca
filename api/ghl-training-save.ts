import {
  deleteKnowledgeFaq,
  listKnowledgeFaqs,
  type GhlKnowledgeFaq,
  updateKnowledgeFaq,
  createKnowledgeFaq,
} from '../server/ghlKnowledgeBase.js';
import { getGhlAgentPrompts, updateGhlAgentPrompts, type GhlAgentPromptBundle } from '../server/ghlAgentPrompts.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type IncomingItem = {
  id?: string;
  question?: string;
  answer?: string;
};

type IncomingAgentPrompts = {
  chatAgent?: {
    goal?: string;
    personality?: string;
    instructions?: string;
  };
  voiceAgent?: {
    welcomeMessage?: string;
    agentPrompt?: string;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseBody(body: unknown): Record<string, unknown> | null {
  if (typeof body === 'string') {
    try {
      return asRecord(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return asRecord(body);
}

function normalizeItems(raw: unknown): IncomingItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry) => {
    const record = asRecord(entry);
    return {
      id: typeof record?.id === 'string' ? record.id.trim() : undefined,
      question: typeof record?.question === 'string' ? record.question.trim() : '',
      answer: typeof record?.answer === 'string' ? record.answer.trim() : '',
    };
  });
}

function normalizeDeletedIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

function normalizeAgentPrompts(raw: unknown): IncomingAgentPrompts | null {
  const record = asRecord(raw);
  if (!record) return null;

  const chatAgent = asRecord(record.chatAgent);
  const voiceAgent = asRecord(record.voiceAgent);
  if (!chatAgent && !voiceAgent) return null;

  return {
    chatAgent: chatAgent
      ? {
          goal: typeof chatAgent.goal === 'string' ? chatAgent.goal.trim() : '',
          personality: typeof chatAgent.personality === 'string' ? chatAgent.personality.trim() : '',
          instructions: typeof chatAgent.instructions === 'string' ? chatAgent.instructions.trim() : '',
        }
      : undefined,
    voiceAgent: voiceAgent
      ? {
          welcomeMessage: typeof voiceAgent.welcomeMessage === 'string' ? voiceAgent.welcomeMessage.trim() : '',
          agentPrompt: typeof voiceAgent.agentPrompt === 'string' ? voiceAgent.agentPrompt.trim() : '',
        }
      : undefined,
  };
}

function faqChanged(left: IncomingItem, right: GhlKnowledgeFaq): boolean {
  return left.question !== right.question || left.answer !== right.answer;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const body = parseBody(req.body);
  if (!body) {
    res.status(400).json({ message: 'Expected a JSON object body.' });
    return;
  }

  const items = normalizeItems(body.items);
  const deletedIds = normalizeDeletedIds(body.deletedIds);
  const agentPrompts = normalizeAgentPrompts(body.agentPrompts);
  const wantsFaqSave = Array.isArray(body.items) || Array.isArray(body.deletedIds) || typeof body.knowledgeBaseId === 'string';
  const wantsPromptSave = Boolean(agentPrompts);

  if (!wantsFaqSave && !wantsPromptSave) {
    res.status(400).json({ message: 'Nothing to save.' });
    return;
  }

  let refreshedFaqs: GhlKnowledgeFaq[] | undefined;
  let faqCounts: { created: number; updated: number; deleted: number } | undefined;
  let knowledgeBaseId = typeof body.knowledgeBaseId === 'string' ? body.knowledgeBaseId.trim() : '';
  let refreshedPrompts: GhlAgentPromptBundle | undefined;
  let previousPrompts: GhlAgentPromptBundle | undefined;

  try {
    if (wantsFaqSave) {
      if (!knowledgeBaseId) {
        res.status(400).json({ message: 'Missing knowledgeBaseId.' });
        return;
      }

      const invalidIndexes = items
        .map((item, index) => (!item.question || !item.answer ? index + 1 : null))
        .filter((index): index is number => index !== null);

      if (invalidIndexes.length > 0) {
        res.status(400).json({
          message: `Each row needs both question and answer. Incomplete row numbers: ${invalidIndexes.join(', ')}.`,
        });
        return;
      }

      const currentItems = await listKnowledgeFaqs(knowledgeBaseId);
      const currentById = new Map(currentItems.map((item) => [item.id, item]));

      const itemsToCreate = items.filter((item) => !item.id);
      const itemsToUpdate = items.filter((item) => item.id && currentById.has(item.id) && faqChanged(item, currentById.get(item.id)!));
      const itemsToDelete = deletedIds.filter((faqId) => currentById.has(faqId));

      for (const item of itemsToUpdate) {
        await updateKnowledgeFaq(item.id!, knowledgeBaseId, item.question!, item.answer!);
      }
      for (const item of itemsToCreate) {
        await createKnowledgeFaq(knowledgeBaseId, item.question!, item.answer!);
      }
      for (const faqId of itemsToDelete) {
        await deleteKnowledgeFaq(faqId);
      }

      refreshedFaqs = await listKnowledgeFaqs(knowledgeBaseId);
      faqCounts = {
        created: itemsToCreate.length,
        updated: itemsToUpdate.length,
        deleted: itemsToDelete.length,
      };
    }

    if (wantsPromptSave && agentPrompts?.chatAgent && agentPrompts.voiceAgent) {
      previousPrompts = await getGhlAgentPrompts();
      if (!agentPrompts.chatAgent.goal || !agentPrompts.chatAgent.personality || !agentPrompts.chatAgent.instructions) {
        res.status(400).json({ message: 'Chat agent goal, personality, and instructions are all required.' });
        return;
      }
      if (!agentPrompts.voiceAgent.welcomeMessage || !agentPrompts.voiceAgent.agentPrompt) {
        res.status(400).json({ message: 'Voice agent welcome message and prompt are both required.' });
        return;
      }

      refreshedPrompts = await updateGhlAgentPrompts({
        chatAgent: {
          goal: agentPrompts.chatAgent.goal,
          personality: agentPrompts.chatAgent.personality,
          instructions: agentPrompts.chatAgent.instructions,
        },
        voiceAgent: {
          welcomeMessage: agentPrompts.voiceAgent.welcomeMessage,
          agentPrompt: agentPrompts.voiceAgent.agentPrompt,
        },
      });
    }

    const messageParts: string[] = [];
    if (faqCounts) {
      messageParts.push(
        `Saved GHL knowledge base changes (${faqCounts.created} created, ${faqCounts.updated} updated, ${faqCounts.deleted} deleted).`
      );
    }
    if (refreshedPrompts) {
      messageParts.push('Saved live GHL chat and voice prompts.');
    }

    res.status(200).json({
      items: refreshedFaqs,
      knowledgeBaseId: knowledgeBaseId || undefined,
      counts: faqCounts,
      agentPrompts: refreshedPrompts,
      previousPrompts,
      message: messageParts.join(' ') || 'Saved GHL training changes.',
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to save GHL training data.',
    });
  }
}
