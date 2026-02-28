type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

type QuoteRuntimeModule = {
  computeDeterministicQuote: (answersInput: Record<string, unknown>) => Promise<{
    quote_id: string;
    total: number;
    currency: 'CAD';
    line_items: Array<{ label: string; amount: number }>;
    assumptions: string[];
    answers_echo: Record<string, unknown>;
    version: 'v1';
  }>;
  validateRequiredAnswers: (answers: Record<string, unknown>) => string[];
};

let quoteRuntimePromise: Promise<QuoteRuntimeModule> | null = null;

async function getQuoteRuntime(): Promise<QuoteRuntimeModule> {
  if (!quoteRuntimePromise) {
    quoteRuntimePromise = import('../server/quoteRuntimeEntry.js').then((mod) => mod as unknown as QuoteRuntimeModule);
  }
  return quoteRuntimePromise;
}

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
    const runtime = await getQuoteRuntime();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const record = asRecord(body);
    const answers = asRecord(record?.answers ?? record);

    if (!answers) {
      res.status(400).json({ message: 'Missing answers object.' });
      return;
    }

    const errors = runtime.validateRequiredAnswers(answers);
    if (errors.length > 0) {
      res.status(400).json({
        message: 'Validation failed.',
        errors,
      });
      return;
    }

    const quote = await runtime.computeDeterministicQuote(answers);
    res.status(200).json({ quote });
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to compute quote.',
    });
  }
}
