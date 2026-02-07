import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { Resend } from 'resend';
import { STEAM_ZONE_LOGO_BASE64 } from '../server/steamZoneLogoBase64';

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

interface EmailDetailRow {
  label: string;
  value: string;
}

interface EmailTemplateInput {
  preheader: string;
  heading: string;
  subheading: string;
  intro: string;
  estimateRange: string;
  durationRange: string;
  quoteNumber: string;
  detailRows: EmailDetailRow[];
  notes: string[];
  redFlags: string[];
  footerLine: string;
  cta?: {
    label: string;
    href: string;
    helper?: string;
  };
}

type PdfColor = ReturnType<typeof rgb>;
type PdfRowTone = 'default' | 'muted' | 'danger';

interface PdfCardRow {
  label: string;
  value: string;
  tone?: PdfRowTone;
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

function safeText(value: string | undefined, fallback = 'N/A'): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function finite(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function formatHoursRange(low: number | undefined, high: number | undefined): string {
  return `${finite(low).toFixed(1)} - ${finite(high).toFixed(1)} hours`;
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const compact = text.trim();
  if (!compact) {
    return [];
  }

  const words = compact.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const chunks: string[] = [];
    if (word.length <= maxCharsPerLine) {
      chunks.push(word);
    } else {
      for (let index = 0; index < word.length; index += maxCharsPerLine - 1) {
        const slice = word.slice(index, index + maxCharsPerLine - 1);
        const hasNext = index + maxCharsPerLine - 1 < word.length;
        chunks.push(hasNext ? `${slice}-` : slice);
      }
    }

    for (const chunk of chunks) {
      const next = current.length > 0 ? `${current} ${chunk}` : chunk;
      if (next.length <= maxCharsPerLine) {
        current = next;
      } else {
        if (current.length > 0) {
          lines.push(current);
        }
        current = chunk;
      }
    }
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderEmailDetailsTable(rows: EmailDetailRow[]): string {
  const content = rows
    .map((row, index) => {
      const background = index % 2 === 0 ? '#ffffff' : '#f8fafc';
      const border = index === rows.length - 1 ? 'none' : '1px solid #e2e8f0';
      return `
        <tr>
          <td style="padding:12px 14px; width:34%; font-size:13px; font-weight:600; color:#334155; background:${background}; border-bottom:${border};">
            ${escapeHtml(row.label)}
          </td>
          <td style="padding:12px 14px; font-size:13px; color:#0f172a; background:${background}; border-bottom:${border};">
            ${escapeHtml(row.value)}
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dbe5f2; border-radius:10px; overflow:hidden;">
      ${content}
    </table>
  `;
}

function renderEmailListCard(title: string, items: string[], tone: 'neutral' | 'danger'): string {
  if (items.length === 0) {
    return '';
  }

  const background = tone === 'danger' ? '#fff1f2' : '#f8fafc';
  const border = tone === 'danger' ? '#fecdd3' : '#dbe5f2';
  const heading = tone === 'danger' ? '#9f1239' : '#1e3a8a';
  const text = tone === 'danger' ? '#9f1239' : '#334155';
  const bullets = items
    .map((item) => `<li style="margin:0 0 8px 0;">${escapeHtml(item)}</li>`)
    .join('');

  return `
    <tr>
      <td style="padding:0 28px 16px 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${background}; border:1px solid ${border}; border-radius:10px;">
          <tr>
            <td style="padding:12px 14px;">
              <p style="margin:0 0 10px 0; font-size:14px; font-weight:700; color:${heading};">${escapeHtml(title)}</p>
              <ul style="margin:0; padding-left:18px; font-size:13px; line-height:1.5; color:${text};">
                ${bullets}
              </ul>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `;
}

function renderEmailTemplate(input: EmailTemplateInput): string {
  const details = renderEmailDetailsTable(input.detailRows);
  const noteCard = renderEmailListCard('Project Notes', input.notes, 'neutral');
  const redFlagCard = renderEmailListCard('Items Requiring Confirmation', input.redFlags, 'danger');
  const ctaBlock = input.cta
    ? `
      <tr>
        <td style="padding:8px 28px 10px 28px;">
          <a href="${escapeHtml(input.cta.href)}" style="display:inline-block; background:#1d4ed8; color:#ffffff; text-decoration:none; font-weight:700; font-size:14px; padding:11px 18px; border-radius:8px;">
            ${escapeHtml(input.cta.label)}
          </a>
          ${
            input.cta.helper
              ? `<p style="margin:10px 0 0 0; font-size:12px; color:#475569;">${escapeHtml(input.cta.helper)}</p>`
              : ''
          }
        </td>
      </tr>
    `
    : '';

  return `
    <!doctype html>
    <html lang="en">
      <body style="margin:0; padding:0; background:#f1f5f9; font-family:Arial, Helvetica, sans-serif;">
        <div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent;">
          ${escapeHtml(input.preheader)}
        </div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;">
          <tr>
            <td align="center" style="padding:24px 12px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px; background:#ffffff; border:1px solid #dbe5f2; border-radius:14px; overflow:hidden;">
                <tr>
                  <td style="padding:24px 28px; background:#103b85;">
                    <p style="margin:0; font-size:11px; letter-spacing:1.3px; font-weight:700; color:#bfdbfe;">STEAM ZONE</p>
                    <h1 style="margin:8px 0 8px 0; font-size:24px; line-height:1.25; color:#ffffff;">${escapeHtml(input.heading)}</h1>
                    <p style="margin:0; font-size:14px; line-height:1.45; color:#dbeafe;">${escapeHtml(input.subheading)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:18px 28px 8px 28px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef5ff; border:1px solid #bfdbfe; border-radius:10px;">
                      <tr>
                        <td style="padding:14px 16px;">
                          <p style="margin:0; font-size:11px; font-weight:700; letter-spacing:1px; color:#1e3a8a;">ESTIMATE RANGE</p>
                          <p style="margin:7px 0 5px 0; font-size:26px; font-weight:700; line-height:1.15; color:#0f172a;">${escapeHtml(
                            input.estimateRange
                          )}</p>
                          <p style="margin:0; font-size:13px; color:#1e293b;">Estimated Duration: ${escapeHtml(input.durationRange)}</p>
                          <p style="margin:6px 0 0 0; font-size:13px; color:#1e293b;">Quote Number: ${escapeHtml(input.quoteNumber)}</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:10px 28px 14px 28px;">
                    <p style="margin:0; font-size:14px; line-height:1.6; color:#334155;">${escapeHtml(input.intro)}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 28px 16px 28px;">
                    ${details}
                  </td>
                </tr>
                ${noteCard}
                ${redFlagCard}
                ${ctaBlock}
                <tr>
                  <td style="padding:12px 28px 24px 28px;">
                    <p style="margin:0; font-size:12px; color:#64748b; line-height:1.55;">
                      ${escapeHtml(input.footerLine)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function buildQuotePdf(record: IncomingRecord): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const logoImage = await pdfDoc.embedPng(Buffer.from(STEAM_ZONE_LOGO_BASE64, 'base64'));

  const blue = rgb(0.19, 0.4, 0.83);
  const dark = rgb(0.07, 0.07, 0.07);
  const lightRule = rgb(0.8, 0.82, 0.86);
  const quoteNumber = safeText(record.quoteNumber, 'Pending');
  const service = serviceLabel(record.serviceType);
  const durationRange = formatHoursRange(record.result?.durationLowHours, record.result?.durationHighHours);
  const estimateRange = `${money(record.result?.estimateLow ?? 0)} - ${money(record.result?.estimateHigh ?? 0)}`;
  const generatedAt = record.createdAt ? new Date(record.createdAt) : new Date();
  const dateLabel = Number.isNaN(generatedAt.getTime())
    ? new Date().toLocaleString('en-CA')
    : generatedAt.toLocaleString('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });

  const wrapTextToWidth = (text: string, targetFont: typeof font, size: number, maxWidth: number): string[] => {
    const compact = text.trim();
    if (!compact) {
      return ['N/A'];
    }

    const words = compact.split(/\s+/);
    const lines: string[] = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (targetFont.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines.length > 0 ? lines : ['N/A'];
  };

  const drawLabeledValue = (options: {
    x: number;
    y: number;
    width: number;
    label: string;
    value: string;
    labelSize?: number;
    valueSize?: number;
    valueBold?: boolean;
    valueColor?: ReturnType<typeof rgb>;
    lineHeight?: number;
    gapAfter?: number;
  }): number => {
    const labelSize = options.labelSize ?? 11;
    const valueSize = options.valueSize ?? 11;
    const lineHeight = options.lineHeight ?? 15;
    const gapAfter = options.gapAfter ?? 2;
    const labelText = `${options.label}:`;
    const valueFont = options.valueBold ? boldFont : font;
    const labelWidth = boldFont.widthOfTextAtSize(labelText, labelSize);
    const valueX = options.x + labelWidth + 4;
    const maxValueWidth = Math.max(30, options.width - (valueX - options.x));
    const lines = wrapTextToWidth(options.value, valueFont, valueSize, maxValueWidth);

    page.drawText(labelText, {
      x: options.x,
      y: options.y,
      size: labelSize,
      font: boldFont,
      color: dark,
    });

    let currentY = options.y;
    for (const line of lines) {
      page.drawText(line, {
        x: valueX,
        y: currentY,
        size: valueSize,
        font: valueFont,
        color: options.valueColor ?? dark,
      });
      currentY -= lineHeight;
    }

    return currentY - gapAfter;
  };

  const drawBullets = (options: {
    x: number;
    y: number;
    width: number;
    items: string[];
    fontSize?: number;
    lineHeight?: number;
    color?: ReturnType<typeof rgb>;
  }): number => {
    const fontSize = options.fontSize ?? 11;
    const lineHeight = options.lineHeight ?? 15;
    const color = options.color ?? dark;
    let currentY = options.y;

    for (const item of options.items) {
      if (currentY < 105) {
        break;
      }

      const lines = wrapTextToWidth(item, font, fontSize, options.width - 16);
      page.drawText('•', {
        x: options.x,
        y: currentY,
        size: fontSize + 2,
        font,
        color,
      });

      let rowY = currentY;
      for (const line of lines) {
        if (rowY < 105) {
          break;
        }

        page.drawText(line, {
          x: options.x + 14,
          y: rowY,
          size: fontSize,
          font,
          color,
        });
        rowY -= lineHeight;
      }

      currentY -= Math.max(lines.length, 1) * lineHeight + 2;
    }

    return currentY;
  };

  const logoWidth = 220;
  const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
  page.drawImage(logoImage, {
    x: 58,
    y: 740 - logoHeight,
    width: logoWidth,
    height: logoHeight,
  });

  page.drawText('ESTIMATE PROPOSAL', {
    x: 314,
    y: 724,
    size: 24,
    font: boldFont,
    color: blue,
  });

  page.drawText(`Quote ${quoteNumber}`, {
    x: 62,
    y: 678,
    size: 14,
    font: boldFont,
    color: dark,
  });

  const dateLabelText = `Date: ${dateLabel}`;
  const dateLabelWidth = boldFont.widthOfTextAtSize(dateLabelText, 10.5);
  page.drawText(dateLabelText, {
    x: 550 - dateLabelWidth,
    y: 678,
    size: 10.5,
    font: boldFont,
    color: dark,
  });

  page.drawLine({
    start: { x: 62, y: 665 },
    end: { x: 550, y: 665 },
    thickness: 1,
    color: lightRule,
  });

  const leftX = 62;
  const rightX = 315;
  const leftWidth = 228;
  const rightWidth = 235;

  page.drawText('ESTIMATE SUMMARY', { x: leftX, y: 638, size: 12, font: boldFont, color: dark });
  let leftY = drawLabeledValue({
    x: leftX,
    y: 612,
    width: leftWidth,
    label: 'Range',
    value: estimateRange,
    valueSize: 16,
    valueBold: true,
    valueColor: rgb(0.04, 0.17, 0.37),
    lineHeight: 17,
    gapAfter: 5,
  });
  leftY = drawLabeledValue({ x: leftX, y: leftY, width: leftWidth, label: 'Duration', value: durationRange });
  leftY = drawLabeledValue({
    x: leftX,
    y: leftY,
    width: leftWidth,
    label: 'Subtotal',
    value: money(record.result?.subtotal ?? 0),
  });
  leftY = drawLabeledValue({
    x: leftX,
    y: leftY,
    width: leftWidth,
    label: 'Confidence',
    value: safeText(record.result?.confidence),
  });
  leftY = drawLabeledValue({
    x: leftX,
    y: leftY,
    width: leftWidth,
    label: 'Zone',
    value: `${zoneLabel(record.zone)}${record.postalCode ? ` (${record.postalCode})` : ''}`,
  });
  drawLabeledValue({
    x: leftX,
    y: leftY,
    width: leftWidth,
    label: 'Next Step',
    value: safeText(record.result?.bookingMode),
  });

  page.drawText('CUSTOMER', { x: rightX, y: 638, size: 12, font: boldFont, color: dark });
  let rightY = drawLabeledValue({
    x: rightX,
    y: 612,
    width: rightWidth,
    label: 'Name',
    value: safeText(record.contact?.fullName),
  });
  rightY = drawLabeledValue({
    x: rightX,
    y: rightY,
    width: rightWidth,
    label: 'Phone',
    value: safeText(record.contact?.phone),
  });
  rightY = drawLabeledValue({
    x: rightX,
    y: rightY,
    width: rightWidth,
    label: 'Email',
    value: safeText(record.contact?.email),
  });
  rightY = drawLabeledValue({
    x: rightX,
    y: rightY,
    width: rightWidth,
    label: 'Address',
    value: safeText(record.contact?.address, 'Not provided'),
  });
  rightY = drawLabeledValue({
    x: rightX,
    y: rightY,
    width: rightWidth,
    label: 'Service',
    value: service,
  });

  page.drawText('PROJECT NOTES', { x: rightX, y: rightY - 18, size: 12, font: boldFont, color: dark });
  const notesEndY = drawBullets({
    x: rightX + 4,
    y: rightY - 42,
    width: rightWidth,
    items: record.result?.notes ?? [],
  });

  page.drawText('ITEMS REQUIRING CONFIRMATION', {
    x: rightX,
    y: notesEndY - 18,
    size: 12,
    font: boldFont,
    color: dark,
  });
  drawBullets({
    x: rightX + 4,
    y: notesEndY - 42,
    width: rightWidth,
    items: record.result?.redFlags ?? [],
    color: rgb(0.62, 0.12, 0.2),
  });

  page.drawLine({
    start: { x: 62, y: 62 },
    end: { x: 550, y: 62 },
    thickness: 1,
    color: lightRule,
  });

  const footerText =
    'Steam Zone Cleaning Services | Phone: (431) 205-3909 | Email: info@steamzone.ca | Address: Steinbach, MB, Canada';
  page.drawText(footerText, {
    x: 62,
    y: 43,
    size: 10,
    font,
    color: dark,
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
  const internalInbox = process.env.ESTIMATE_TO_EMAIL?.trim();
  const usesResendOnboardingSender = fromEmail?.toLowerCase().includes('onboarding@resend.dev') ?? false;

  if (!resendApiKey || !fromEmail) {
    res.status(500).json({
      message:
        'Email delivery is not configured yet. Add RESEND_API_KEY and ESTIMATE_FROM_EMAIL in Vercel environment variables.',
    });
    return;
  }

  if (usesResendOnboardingSender && !internalInbox) {
    res.status(500).json({
      message:
        'Onboarding sender mode requires ESTIMATE_TO_EMAIL so leads can be delivered to your Steam Zone inbox.',
    });
    return;
  }

  try {
    const pdfBytes = await buildQuotePdf(record);
    const resend = new Resend(resendApiKey);
    const quoteNumber = safeText(record.quoteNumber, 'Pending');
    const durationRange = formatHoursRange(record.result?.durationLowHours, record.result?.durationHighHours);
    const estimateRange = `${money(record.result?.estimateLow ?? 0)} - ${money(record.result?.estimateHigh ?? 0)}`;
    const notes = record.result?.notes ?? [];
    const redFlags = record.result?.redFlags ?? [];
    const service = serviceLabel(record.serviceType);

    const to = usesResendOnboardingSender ? [internalInbox as string] : [record.contact.email];
    const bcc = !usesResendOnboardingSender && internalInbox ? [internalInbox] : undefined;
    const replyTo = usesResendOnboardingSender ? record.contact.email : undefined;
    const subject = usesResendOnboardingSender
      ? `New Steam Zone estimate lead ${quoteNumber}`.trim()
      : `Your Steam Zone Estimate ${quoteNumber}`.trim();

    const html = usesResendOnboardingSender
      ? renderEmailTemplate({
          preheader: `New estimate lead ${quoteNumber} from ${safeText(record.contact.fullName)}.`,
          heading: 'New Estimate Lead',
          subheading: 'A customer submitted a live estimate request from steamzone.ca.',
          intro: 'The lead details and estimate summary are below. PDF quote is attached for your team.',
          estimateRange,
          durationRange,
          quoteNumber,
          detailRows: [
            { label: 'Customer', value: safeText(record.contact.fullName) },
            { label: 'Email', value: safeText(record.contact.email) },
            { label: 'Phone', value: safeText(record.contact.phone) },
            { label: 'Service', value: service },
            { label: 'Address', value: safeText(record.contact.address, 'Not provided') },
            { label: 'Postal / Zone', value: `${safeText(record.postalCode)} / ${zoneLabel(record.zone)}` },
            { label: 'Next Step', value: safeText(record.result?.bookingMode) },
          ],
          notes,
          redFlags,
          footerLine: 'Steam Zone lead delivery - Reply directly to this email to contact the customer.',
          cta: {
            label: `Reply to ${safeText(record.contact.fullName)}`,
            href: `mailto:${safeText(record.contact.email)}?subject=${encodeURIComponent(`Steam Zone estimate ${quoteNumber}`)}`,
            helper: 'This opens your default email app with the customer as recipient.',
          },
        })
      : renderEmailTemplate({
          preheader: `Your Steam Zone estimate ${quoteNumber} is ready.`,
          heading: 'Your Steam Zone Estimate',
          subheading: 'Thanks for requesting an instant quote. A PDF copy is attached for your records.',
          intro:
            'Review the estimate summary below. Final pricing is confirmed based on site conditions and selected add-ons.',
          estimateRange,
          durationRange,
          quoteNumber,
          detailRows: [
            { label: 'Customer', value: safeText(record.contact.fullName) },
            { label: 'Service', value: service },
            { label: 'Quote Number', value: quoteNumber },
            { label: 'Estimated Duration', value: durationRange },
            { label: 'Address', value: safeText(record.contact.address, 'Not provided') },
            { label: 'Postal / Zone', value: `${safeText(record.postalCode)} / ${zoneLabel(record.zone)}` },
            { label: 'Next Step', value: safeText(record.result?.bookingMode) },
          ],
          notes,
          redFlags,
          footerLine:
            'To book or confirm details, reply to this email or call Steam Zone at (431) 205-3909. We appreciate your business.',
          cta: {
            label: 'Call Steam Zone: (431) 205-3909',
            href: 'tel:+14312053909',
            helper: 'Prefer email? Just hit reply and we will follow up quickly.',
          },
        });

    const text = usesResendOnboardingSender
      ? [
          `New Steam Zone estimate lead ${quoteNumber}`,
          `Name: ${safeText(record.contact.fullName)}`,
          `Email: ${safeText(record.contact.email)}`,
          `Phone: ${safeText(record.contact.phone)}`,
          `Service: ${service}`,
          `Estimate Range: ${estimateRange}`,
          `Duration: ${durationRange}`,
        ].join('\n')
      : [
          `Hi ${safeText(record.contact.fullName)},`,
          '',
          `Thanks for requesting an estimate from Steam Zone.`,
          `Quote Number: ${quoteNumber}`,
          `Service: ${service}`,
          `Estimate Range: ${estimateRange}`,
          `Estimated Duration: ${durationRange}`,
          '',
          'Your PDF estimate is attached. Reply to this email or call (431) 205-3909 to book.',
        ].join('\n');

    const emailResult = await resend.emails.send({
      from: fromEmail,
      to,
      bcc,
      replyTo,
      subject,
      html,
      text,
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

    if (usesResendOnboardingSender) {
      res.status(200).json({
        message: 'Estimate captured and sent to Steam Zone inbox for follow-up.',
        deliveryMode: 'internal',
      });
      return;
    }

    res.status(200).json({ message: 'Estimate email sent successfully.', deliveryMode: 'customer' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email delivery error.';
    res.status(500).json({ message });
  }
}
