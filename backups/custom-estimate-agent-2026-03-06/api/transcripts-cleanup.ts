type ApiRequest = {
  method?: string;
  body?: unknown;
};

type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
};

type CleanupPayload = {
  dry_run?: unknown;
  session_id?: unknown;
  limit?: unknown;
  min_turns?: unknown;
  max_turns?: unknown;
  delete_above_turns?: unknown;
  dedupe_window_ms?: unknown;
  confirm?: unknown;
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asInteger(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function parseBody(body: unknown): CleanupPayload | null {
  if (!body) return {};

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CleanupPayload) : null;
    } catch {
      return null;
    }
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as CleanupPayload;
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

  const dryRun = asBoolean(payload.dry_run) ?? true;
  const sessionId = asText(payload.session_id) || undefined;
  const limit = asInteger(payload.limit);
  const minTurns = asInteger(payload.min_turns);
  const maxTurns = asInteger(payload.max_turns);
  const deleteAboveTurns = asInteger(payload.delete_above_turns);
  const dedupeWindowMs = asInteger(payload.dedupe_window_ms);
  const confirm = asText(payload.confirm).toLowerCase();

  if (!dryRun && confirm !== 'cleanup') {
    res.status(400).json({
      message: 'Refusing non-dry-run cleanup without confirm="cleanup".',
    });
    return;
  }

  try {
    const { cleanupTranscripts } = await import('../server/transcriptMaintenance.js');
    const result = await cleanupTranscripts({
      dryRun,
      sessionId,
      limit,
      minTurns,
      maxTurns,
      deleteAboveTurns,
      dedupeWindowMs,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to clean up transcripts.',
    });
  }
}
