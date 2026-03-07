import { summarizeVoiceValidation, validateVoiceEstimateSnapshot } from '../server/voiceEstimateValidation.js';

type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
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

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const body = parseBody(req.body);
  if (!body) {
    res.status(400).json({ message: 'Expected a JSON object body.' });
    return;
  }

  try {
    const result = await validateVoiceEstimateSnapshot(body);
    res.status(200).json({
      ...result,
      summary: summarizeVoiceValidation(result),
    });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to validate voice estimate snapshot.',
    });
  }
}
