import { handlerForEstimateAgentPost } from '../../server/estimateAgentCoreRuntime.mjs';

type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await handlerForEstimateAgentPost(req, res, true);
}
