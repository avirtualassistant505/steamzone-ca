import { loadActiveTrainingItems, saveActiveTrainingItems } from '../server/trainingDataStore';

type ApiRequest = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const body =
    typeof req.body === 'string' ? (() => {
      try {
        return JSON.parse(req.body);
      } catch {
        return null;
      }
    })() : req.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    res.status(400).json({ message: 'Expected an object body.' });
    return;
  }

  const payload = body as { items?: unknown; training_items?: unknown };
  const items = payload.items ?? payload.training_items;
  if (!Array.isArray(items)) {
    res.status(400).json({ message: 'Missing items array.' });
    return;
  }

  try {
    const saved = await saveActiveTrainingItems(items);
    const refreshed = await loadActiveTrainingItems();

    res.status(200).json({
      items: refreshed.items,
      source: saved.source,
      updatedAt: saved.updatedAt,
      message: 'Training data saved.',
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to save training data.',
    });
  }
}
