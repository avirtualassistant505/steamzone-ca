type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type ReviewStatus = 'processed' | 'ready' | 'unprocessed';

type UpdatePayload = {
  session_id?: unknown;
  review_status?: unknown;
  review_notes?: unknown;
};

type UpdateResponse = {
  session_id: string;
  review_status: ReviewStatus;
  review_notes: string;
  storage_mode?: 'database' | 'memory_fallback';
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asReviewStatus(value: unknown): ReviewStatus | undefined {
  const text = asText(value).toLowerCase();
  if (text === 'processed' || text === 'ready' || text === 'unprocessed') {
    return text;
  }
  return undefined;
}

function parseBody(body: unknown): UpdatePayload | null {
  if (!body) return null;

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as UpdatePayload) : null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as UpdatePayload;
  }

  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed.' });
    return;
  }

  const payload = parseBody(req.body);
  if (!payload) {
    res.status(400).json({ message: 'Invalid JSON body.' });
    return;
  }

  const sessionId = asText(payload.session_id);
  if (!sessionId) {
    res.status(400).json({ message: 'session_id is required.' });
    return;
  }

  const normalizedStatus = asReviewStatus(payload.review_status);
  const hasReviewNotes = Object.prototype.hasOwnProperty.call(payload, 'review_notes');
  const normalizedNotes = asText(payload.review_notes);

  if (!normalizedStatus && !hasReviewNotes) {
    res.status(400).json({ message: 'No review fields provided to update.' });
    return;
  }

  try {
    const { getConversationStorageMode, setConversationReviewState } = await import(
      '../server/conversationLogStore.js'
    );
    const updated = await setConversationReviewState(
      sessionId,
      hasReviewNotes ? normalizedNotes : undefined,
      normalizedStatus
    );

    const response: UpdateResponse = {
      session_id: updated.session_id,
      review_status: updated.review_status,
      review_notes: updated.review_notes,
      storage_mode: getConversationStorageMode(),
    };
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to update review state.',
    });
  }
}
