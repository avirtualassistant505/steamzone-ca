import { getGhlKnowledgeBaseContext, listKnowledgeBases, listKnowledgeFaqs } from '../server/ghlKnowledgeBase.js';
import { getGhlAgentPrompts, type GhlAgentPromptBundle } from '../server/ghlAgentPrompts.js';

type ApiRequest = {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type GhlTrainingGetResponse = {
  locationId?: string;
  knowledgeBases?: unknown[];
  selectedKnowledgeBaseId?: string;
  items?: unknown[];
  agentPrompts?: GhlAgentPromptBundle;
  message?: string;
};

function asText(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const knowledgeBases = await listKnowledgeBases();
    const requestedKnowledgeBaseId = asText(req.query?.knowledgeBaseId).trim();
    const selectedKnowledgeBaseId =
      requestedKnowledgeBaseId && knowledgeBases.some((entry) => entry.id === requestedKnowledgeBaseId)
        ? requestedKnowledgeBaseId
        : (knowledgeBases[0]?.id ?? '');
    const items = selectedKnowledgeBaseId ? await listKnowledgeFaqs(selectedKnowledgeBaseId) : [];
    const { locationId } = getGhlKnowledgeBaseContext();
    const agentPrompts = await getGhlAgentPrompts();

    res.status(200).json({
      locationId,
      knowledgeBases,
      selectedKnowledgeBaseId,
      items,
      agentPrompts,
      message: selectedKnowledgeBaseId
        ? `Loaded ${items.length} GHL FAQ entries.`
        : 'No knowledge bases found for this location.',
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load GHL training data.',
    });
  }
}
