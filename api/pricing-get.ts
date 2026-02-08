import { loadActivePricingConfig } from '../server/pricingStore';
import type { ApiRequest, ApiResponse } from '../server/apiTypes';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const { config, source } = await loadActivePricingConfig();
    res.status(200).json({ config, source });
  } catch (error) {
    res.status(500).json({ message: error instanceof Error ? error.message : 'Unable to load pricing config.' });
  }
}
