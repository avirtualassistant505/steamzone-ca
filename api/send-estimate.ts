import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Resend } from 'resend';

interface IncomingRecord {
  quoteNumber?: string;
  createdAt?: string;
  serviceType?: string;
  zone?: string;
  postalCode?: string;
  contact?: {
    fullName?: string;
    address?: string;
    phone?: string;
    email?: string;
    consentToContact?: boolean;
  };
  result?: {
    estimateLow?: number;
    estimateHigh?: number;
    subtotal?: number;
    durationLowHours?: number;
    durationHighHours?: number;
    confidence?: string;
    bookingMode?: string;
    notes?: string[];
    redFlags?: string[];
  };
}

function money(value: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);
}

function serviceLabel(serviceType: string | undefined): string {
  if (serviceType === 'window') {
    return 'Residential Window Cleaning';
  }

  if (serviceType === 'commercialWindow') {
    return 'Commercial Window Cleaning';
  }

  if (serviceType === 'carpet') {
    return 'Carpet Cleaning';
  }

  return 'Post-Construction Cleaning';
}

function zoneLabel(zone: string | undefined): string {
  if (zone === 'zoneA') {
    return 'Zone A (Steinbach + 15km)';
  }

  if (zone === 'zoneB') {
    return 'Zone B (15km - 35km)';
  }

  if (zone === 'zoneC') {
    return 'Zone C (Winnipeg trips)';
  }

  if (zone === 'zoneD') {
    return 'Zone D (Extended rural)';
  }

  return 'Unknown zone';
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current.length > 0 ? `${current} ${word}` : word;
    if (next.length <= maxCharsPerLine) {
      current = next;
    } else {
      if (current.length > 0) {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

async function buildQuotePdf(record: IncomingRecord): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let cursorY = 760;

  page.drawText('Steam Zone - Estimate Quote', {
    x: 40,
    y: cursorY,
    size: 18,
    font: boldFont,
    color: rgb(0.08, 0.2, 0.5),
  });

  cursorY -= 30;
  const summaryLines = [
    `Quote Number: ${record.quoteNumber ?? 'Pending'}`,
    `Generated: ${record.createdAt ? new Date(record.createdAt).toLocaleString() : new Date().toLocaleString()}`,
    `Service: ${serviceLabel(record.serviceType)}`,
    `Customer: ${record.contact?.fullName ?? 'N/A'}`,
    `Phone: ${record.contact?.phone ?? 'N/A'}`,
    `Email: ${record.contact?.email ?? 'N/A'}`,
    `Address: ${record.contact?.address || 'Not provided'}`,
    `Postal / Zone: ${record.postalCode ?? 'N/A'} / ${zoneLabel(record.zone)}`,
  ];

  for (const line of summaryLines) {
    page.drawText(line, {
      x: 40,
      y: cursorY,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 16;
  }

  cursorY -= 8;
  page.drawText('Estimate Summary', {
    x: 40,
    y: cursorY,
    size: 13,
    font: boldFont,
    color: rgb(0.08, 0.2, 0.5),
  });

  cursorY -= 22;

  const estimateLines = [
    `Range: ${money(record.result?.estimateLow ?? 0)} - ${money(record.result?.estimateHigh ?? 0)}`,
    `Base Subtotal: ${money(record.result?.subtotal ?? 0)}`,
    `Duration: ${(record.result?.durationLowHours ?? 0).toFixed(1)} - ${(record.result?.durationHighHours ?? 0).toFixed(1)} hours`,
    `Confidence: ${record.result?.confidence ?? 'N/A'}`,
    `Next Step: ${record.result?.bookingMode ?? 'N/A'}`,
  ];

  for (const line of estimateLines) {
    page.drawText(line, {
      x: 40,
      y: cursorY,
      size: 11,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
    cursorY -= 16;
  }

  const notes = record.result?.notes ?? [];
  if (notes.length > 0) {
    cursorY -= 8;
    page.drawText('Notes', {
      x: 40,
      y: cursorY,
      size: 13,
      font: boldFont,
      color: rgb(0.08, 0.2, 0.5),
    });

    cursorY -= 20;
    for (const note of notes) {
      const lines = wrapText(`- ${note}`, 90);
      for (const line of lines) {
        page.drawText(line, {
          x: 40,
          y: cursorY,
          size: 10,
          font,
          color: rgb(0.15, 0.15, 0.15),
        });
        cursorY -= 14;
      }
    }
  }

  const redFlags = record.result?.redFlags ?? [];
  if (redFlags.length > 0) {
    cursorY -= 8;
    page.drawText('Items Requiring Confirmation', {
      x: 40,
      y: cursorY,
      size: 13,
      font: boldFont,
      color: rgb(0.62, 0.1, 0.1),
    });

    cursorY -= 20;
    for (const flag of redFlags) {
      const lines = wrapText(`- ${flag}`, 90);
      for (const line of lines) {
        page.drawText(line, {
          x: 40,
          y: cursorY,
          size: 10,
          font,
          color: rgb(0.45, 0.1, 0.1),
        });
        cursorY -= 14;
      }
    }
  }

  cursorY -= 20;
  page.drawText('Thank you for choosing Steam Zone. Final pricing is confirmed based on site details.', {
    x: 40,
    y: cursorY,
    size: 10,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });

  return pdfDoc.save();
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const record = body?.record as IncomingRecord | undefined;

  if (!record || !record.contact?.email || !record.contact?.fullName) {
    res.status(400).json({ message: 'Missing estimate payload or contact email.' });
    return;
  }

  if (!record.contact.consentToContact) {
    res.status(400).json({ message: 'Consent to contact is required before sending estimate email.' });
    return;
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ESTIMATE_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    res.status(500).json({
      message:
        'Email delivery is not configured yet. Add RESEND_API_KEY and ESTIMATE_FROM_EMAIL in Vercel environment variables.',
    });
    return;
  }

  try {
    const pdfBytes = await buildQuotePdf(record);
    const resend = new Resend(resendApiKey);

    const emailResult = await resend.emails.send({
      from: fromEmail,
      to: [record.contact.email],
      bcc: process.env.ESTIMATE_TO_EMAIL ? [process.env.ESTIMATE_TO_EMAIL] : undefined,
      subject: `Your Steam Zone Estimate ${record.quoteNumber ?? ''}`.trim(),
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
          <h2 style="color: #1d4ed8; margin-bottom: 8px;">Your Steam Zone Estimate</h2>
          <p>Hi ${record.contact.fullName},</p>
          <p>Thanks for requesting an estimate. Your instant quote is attached as a PDF.</p>
          <p><strong>Service:</strong> ${serviceLabel(record.serviceType)}</p>
          <p><strong>Estimate Range:</strong> ${money(record.result?.estimateLow ?? 0)} - ${money(record.result?.estimateHigh ?? 0)}</p>
          <p><strong>Estimated Duration:</strong> ${(record.result?.durationLowHours ?? 0).toFixed(1)} - ${(record.result?.durationHighHours ?? 0).toFixed(1)} hours</p>
          <p><strong>Quote Number:</strong> ${record.quoteNumber ?? 'Pending'}</p>
          <p>If you would like to book or confirm details, reply to this email or call us at (431) 205-3909.</p>
          <p style="margin-top: 20px;">- Steam Zone</p>
        </div>
      `,
      attachments: [
        {
          filename: `${record.quoteNumber ?? 'steamzone-estimate'}.pdf`,
          content: Buffer.from(pdfBytes).toString('base64'),
        },
      ],
    });

    if (emailResult.error) {
      res.status(500).json({ message: emailResult.error.message });
      return;
    }

    res.status(200).json({ message: 'Estimate email sent successfully.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email delivery error.';
    res.status(500).json({ message });
  }
}
