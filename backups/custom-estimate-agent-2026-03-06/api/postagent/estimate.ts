type ApiRequest = { method?: string; body?: unknown };
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void };

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  try {
    const { handlerForEstimateAgentPost } = await import(
      '../../src/estimate/core/estimateAgentCore.js'
    );
    await handlerForEstimateAgentPost(req, res, true);
  } catch (error) {
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : 'Failed to initialize postagent handler.',
    });
  }
}
