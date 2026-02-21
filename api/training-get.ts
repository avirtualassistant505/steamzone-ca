import { loadActiveTrainingItems } from '../server/trainingDataStore';

type ApiRequest = {
  method?: string;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const payload = await loadActiveTrainingItems();
    res.status(200).json({
      items: payload.items,
      source: payload.source,
      updatedAt: payload.updatedAt,
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to load training data.',
    });
  }
}
