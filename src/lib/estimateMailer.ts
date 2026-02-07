import type { EstimateRecord } from './estimateEngine';

export type EstimateDeliveryMode = 'customer' | 'internal';

export interface EstimateEmailResult {
  success: boolean;
  message: string;
  deliveryMode?: EstimateDeliveryMode;
}

export async function sendEstimateEmail(record: EstimateRecord): Promise<EstimateEmailResult> {
  if (!record.contact.email) {
    return {
      success: false,
      message: 'Customer email is missing.',
    };
  }

  try {
    const response = await fetch('/api/send-estimate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ record }),
    });

    let payload: { message?: string; deliveryMode?: EstimateDeliveryMode } = {};
    try {
      payload = (await response.json()) as { message?: string; deliveryMode?: EstimateDeliveryMode };
    } catch {
      payload = {};
    }

    if (!response.ok) {
      return {
        success: false,
        message:
          payload.message ??
          'Email delivery endpoint is not fully configured yet. Add RESEND_API_KEY and sender env vars in Vercel.',
      };
    }

    return {
      success: true,
      message: payload.message ?? 'Estimate email sent.',
      deliveryMode: payload.deliveryMode,
    };
  } catch {
    return {
      success: false,
      message: 'Unable to reach email delivery endpoint. Deploy API route and set env variables in Vercel.',
    };
  }
}
