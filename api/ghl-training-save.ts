import {
  deleteKnowledgeFaq,
  listKnowledgeFaqs,
  type GhlKnowledgeFaq,
  updateKnowledgeFaq,
  createKnowledgeFaq,
} from '../server/ghlKnowledgeBase.js';

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

  const knowledgeBaseId = typeof body.knowledgeBaseId === 'string' ? body.knowledgeBaseId.trim() : '';
  if (!knowledgeBaseId) {
    res.status(400).json({ message: 'Missing knowledgeBaseId.' });
    return;
  }

  const items = normalizeItems(body.items);
  const deletedIds = normalizeDeletedIds(body.deletedIds);
  const invalidIndexes = items
    .map((item, index) => (!item.question || !item.answer ? index + 1 : null))
    .filter((index): index is number => index !== null);

  if (invalidIndexes.length > 0) {
    res.status(400).json({
      message: `Each row needs both question and answer. Incomplete row numbers: ${invalidIndexes.join(', ')}.`,
    });
    return;
  }

  try {
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

    const refreshed = await listKnowledgeFaqs(knowledgeBaseId);
    res.status(200).json({
      items: refreshed,
      knowledgeBaseId,
      counts: {
        created: itemsToCreate.length,
        updated: itemsToUpdate.length,
        deleted: itemsToDelete.length,
      },
      message: `Saved GHL knowledge base changes (${itemsToCreate.length} created, ${itemsToUpdate.length} updated, ${itemsToDelete.length} deleted).`,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to save GHL training data.',
    });
  }
}
