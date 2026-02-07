import type { EstimateRecord } from './estimateEngine';

export interface EstimateEmailResult {
  success: boolean;
  message: string;
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

    let payload: { message?: string } = {};
    try {
      payload = (await response.json()) as { message?: string };
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
    };
  } catch {
    return {
      success: false,
      message: 'Unable to reach email delivery endpoint. Deploy API route and set env variables in Vercel.',
    };
  }
}
