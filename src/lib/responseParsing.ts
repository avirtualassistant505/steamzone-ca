export type SafeJsonResult<T> = {
  ok: boolean;
  status: number;
  payload: T | null;
  rawText: string;
  textError?: string;
};

export async function parseJsonResponse<T>(response: Response): Promise<SafeJsonResult<T>> {
  const rawText = await response.text();

  if (!rawText) {
    return {
      ok: false,
      status: response.status,
      payload: null,
      rawText,
      textError: 'Empty response body.',
    };
  }

  try {
    const payload = JSON.parse(rawText) as T;
    return {
      ok: true,
      status: response.status,
      payload,
      rawText,
    };
  } catch {
    const trimmed = rawText.trim().slice(0, 120);
    const isHtml = /^<!doctype html/i.test(trimmed) || /^<html/i.test(trimmed);
    const isDeploymentTextError =
      /^a server error has occurred/i.test(trimmed) ||
      /^authentication required/i.test(trimmed) ||
      /^unauthorized/i.test(trimmed);

    return {
      ok: false,
      status: response.status,
      payload: null,
      rawText,
      textError: isHtml || isDeploymentTextError
        ? 'Server returned HTML instead of JSON. This usually indicates a deployment/auth issue.'
        : 'Server response is not valid JSON.',
    };
  }
}
