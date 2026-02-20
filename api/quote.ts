import { computeDeterministicQuote } from '../src/quote/quoteEngine';
import { validateRequiredAnswers } from '../src/quote/normalization';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const record = asRecord(body);
    const answers = asRecord(record?.answers ?? record);

    if (!answers) {
      res.status(400).json({ message: 'Missing answers object.' });
      return;
    }

    const errors = validateRequiredAnswers(answers);
    if (errors.length > 0) {
      res.status(400).json({
        message: 'Validation failed.',
        errors,
      });
      return;
    }

    const quote = await computeDeterministicQuote(answers);
    res.status(200).json({ quote });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to compute quote.',
    });
  }
}
