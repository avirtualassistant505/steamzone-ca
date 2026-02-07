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

function hexColor(hex: string): PdfColor {
  const value = hex.trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return rgb(0, 0, 0);
  }

  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  return rgb(r, g, b);
}

function roundedRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;
  return [
    `M ${x0 + r} ${y0}`,
    `L ${x1 - r} ${y0}`,
    `Q ${x1} ${y0} ${x1} ${y0 + r}`,
    `L ${x1} ${y1 - r}`,
    `Q ${x1} ${y1} ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `Q ${x0} ${y1} ${x0} ${y1 - r}`,
    `L ${x0} ${y0 + r}`,
    `Q ${x0} ${y0} ${x0 + r} ${y0}`,
    'Z',
  ].join(' ');
}

function roundedTopRectPath(x: number, y: number, width: number, height: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, width / 2, height));
  const x0 = x;
  const y0 = y;
  const x1 = x + width;
  const y1 = y + height;
  return [
    `M ${x0} ${y0}`,
    `L ${x1} ${y0}`,
    `L ${x1} ${y1 - r}`,
    `Q ${x1} ${y1} ${x1 - r} ${y1}`,
    `L ${x0 + r} ${y1}`,
    `Q ${x0} ${y1} ${x0} ${y1 - r}`,
    `L ${x0} ${y0}`,
    'Z',
  ].join(' ');
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

export async function buildQuotePdf(input: EmailTemplateInput): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([612, 792]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const palette = {
    canvas: hexColor('#f1f5f9'),
    cardBorder: hexColor('#dbe5f2'),
    cardBackground: hexColor('#ffffff'),
    headerBackground: hexColor('#103b85'),
    headerKicker: hexColor('#bfdbfe'),
    headerText: hexColor('#ffffff'),
    headerSubText: hexColor('#dbeafe'),
    rangeBackground: hexColor('#eef5ff'),
    rangeBorder: hexColor('#bfdbfe'),
    rangeKicker: hexColor('#1e3a8a'),
    titleText: hexColor('#0f172a'),
    bodyText: hexColor('#334155'),
    mutedText: hexColor('#64748b'),
    rowBorder: hexColor('#dbe5f2'),
    rowAlt: hexColor('#f8fafc'),
    labelCell: hexColor('#f1f5f9'),
    ctaBackground: hexColor('#1d4ed8'),
    dangerBackground: hexColor('#fff1f2'),
    dangerBorder: hexColor('#fecdd3'),
    dangerText: hexColor('#9f1239'),
  };

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

  const drawParagraph = (options: {
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
    lineHeight: number;
    color: PdfColor;
    bold?: boolean;
  }): number => {
    const targetFont = options.bold ? boldFont : font;
    const lines = wrapTextToWidth(options.text, targetFont, options.fontSize, options.width);
    let currentY = options.y;
    for (const line of lines) {
      page.drawText(line, {
        x: options.x,
        y: currentY,
        size: options.fontSize,
        font: targetFont,
        color: options.color,
      });
      currentY -= options.lineHeight;
    }
    return currentY;
  };

  const drawBulletList = (options: {
    items: string[];
    x: number;
    y: number;
    width: number;
    fontSize: number;
    lineHeight: number;
    color: PdfColor;
    maxY: number;
  }): number => {
    let currentY = options.y;
    for (const item of options.items) {
      if (currentY <= options.maxY) {
        break;
      }

      const lines = wrapTextToWidth(item, font, options.fontSize, options.width - 14);
      page.drawText('•', {
        x: options.x,
        y: currentY,
        size: options.fontSize + 2,
        font,
        color: options.color,
      });

      let rowY = currentY;
      for (const line of lines) {
        if (rowY <= options.maxY) {
          break;
        }

        page.drawText(line, {
          x: options.x + 12,
          y: rowY,
          size: options.fontSize,
          font,
          color: options.color,
        });
        rowY -= options.lineHeight;
      }

      currentY -= Math.max(1, lines.length) * options.lineHeight + 2;
    }
    return currentY;
  };

  const drawCard = (options: {
    title: string;
    items: string[];
    tone: 'neutral' | 'danger';
    x: number;
    yTop: number;
    width: number;
    maxY: number;
  }): number => {
    if (options.items.length === 0) {
      return options.yTop;
    }

    const paddingX = 14;
    const paddingTop = 12;
    const titleSize = 11.5;
    const bodySize = 10.8;
    const bodyLine = 14;
    const radius = 10;

    const background = options.tone === 'danger' ? palette.dangerBackground : palette.rowAlt;
    const border = options.tone === 'danger' ? palette.dangerBorder : palette.cardBorder;
    const titleColor = options.tone === 'danger' ? palette.dangerText : palette.rangeKicker;
    const bodyColor = options.tone === 'danger' ? palette.dangerText : palette.bodyText;

    const itemLines = options.items.flatMap((item) => wrapTextToWidth(item, font, bodySize, options.width - paddingX * 2 - 12));
    const listHeight = Math.max(1, itemLines.length) * bodyLine;
    const minHeight = paddingTop + 16 + 10 + listHeight + 12;
    const height = Math.max(minHeight, 64);
    const y = options.yTop - height;
    if (y <= options.maxY) {
      return options.yTop;
    }

    page.drawSvgPath(roundedRectPath(options.x, y, options.width, height, radius), {
      color: background,
      borderColor: border,
      borderWidth: 1,
    });

    const titleY = options.yTop - paddingTop - titleSize;
    page.drawText(options.title, {
      x: options.x + paddingX,
      y: titleY,
      size: titleSize,
      font: boldFont,
      color: titleColor,
    });

    const listStartY = titleY - 16;
    drawBulletList({
      items: options.items,
      x: options.x + paddingX,
      y: listStartY,
      width: options.width - paddingX * 2,
      fontSize: bodySize,
      lineHeight: bodyLine,
      color: bodyColor,
      maxY: y + 12,
    });

    return y - 14;
  };

  const drawDetailsTable = (options: { rows: EmailDetailRow[]; x: number; yTop: number; width: number; maxY: number }): number => {
    const rows = options.rows.filter((row) => row.label.trim().length > 0);
    if (rows.length === 0) {
      return options.yTop;
    }

    const paddingX = 14;
    const paddingY = 10;
    const fontSize = 10.8;
    const lineHeight = 14;
    const radius = 10;
    const labelColWidth = Math.round(options.width * 0.34);
    const valueColWidth = options.width - labelColWidth;

    const measured = rows.map((row) => {
      const labelLines = wrapTextToWidth(row.label, boldFont, fontSize, labelColWidth - paddingX * 2);
      const valueLines = wrapTextToWidth(row.value, font, fontSize, valueColWidth - paddingX * 2);
      const lines = Math.max(labelLines.length, valueLines.length);
      const height = paddingY * 2 + lines * lineHeight;
      return { row, labelLines, valueLines, height };
    });

    const totalHeight = measured.reduce((sum, row) => sum + row.height, 0);
    const y = options.yTop - totalHeight;
    if (y <= options.maxY) {
      return options.yTop;
    }

    page.drawSvgPath(roundedRectPath(options.x, y, options.width, totalHeight, radius), {
      color: palette.cardBackground,
      borderColor: palette.cardBorder,
      borderWidth: 1,
    });

    let rowTop = options.yTop;
    measured.forEach((entry, index) => {
      const rowBottom = rowTop - entry.height;
      const alt = index % 2 === 1;

      page.drawRectangle({
        x: options.x,
        y: rowBottom,
        width: options.width,
        height: entry.height,
        color: alt ? palette.rowAlt : palette.cardBackground,
      });
      page.drawRectangle({
        x: options.x,
        y: rowBottom,
        width: labelColWidth,
        height: entry.height,
        color: palette.labelCell,
      });

      if (index < measured.length - 1) {
        page.drawLine({
          start: { x: options.x, y: rowBottom },
          end: { x: options.x + options.width, y: rowBottom },
          thickness: 1,
          color: palette.rowBorder,
        });
      }

      const textStartY = rowTop - paddingY - fontSize;
      const labelX = options.x + paddingX;
      const valueX = options.x + labelColWidth + paddingX;

      entry.labelLines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: labelX,
          y: textStartY - lineIndex * lineHeight,
          size: fontSize,
          font: boldFont,
          color: palette.bodyText,
        });
      });

      entry.valueLines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: valueX,
          y: textStartY - lineIndex * lineHeight,
          size: fontSize,
          font,
          color: palette.titleText,
        });
      });

      rowTop = rowBottom;
    });

    return y - 16;
  };

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: palette.canvas });

  const cardWidth = 540;
  const cardHeight = 720;
  const cardX = Math.round((612 - cardWidth) / 2);
  const cardY = Math.round((792 - cardHeight) / 2);
  const cardRadius = 14;
  const contentX = cardX + 28;
  const contentWidth = cardWidth - 56;
  const footerPadding = 24;
  const footerFontSize = 9.6;
  const footerLineHeight = 13;

  page.drawSvgPath(roundedRectPath(cardX, cardY, cardWidth, cardHeight, cardRadius), {
    color: palette.cardBackground,
    borderColor: palette.cardBorder,
    borderWidth: 1,
  });

  const headerHeight = 132;
  const cardTop = cardY + cardHeight;
  const headerY = cardTop - headerHeight;
  page.drawSvgPath(roundedTopRectPath(cardX, headerY, cardWidth, headerHeight, cardRadius), {
    color: palette.headerBackground,
  });

  const headerKickerSize = 9.5;
  const headerHeadingSize = 18.8;
  const headerSubSize = 11.2;
  let cursorY = cardTop - 24;
  page.drawText('STEAM ZONE', {
    x: contentX,
    y: cursorY - headerKickerSize,
    size: headerKickerSize,
    font: boldFont,
    color: palette.headerKicker,
  });
  cursorY -= headerKickerSize + 10;
  cursorY = drawParagraph({
    text: input.heading,
    x: contentX,
    y: cursorY - headerHeadingSize,
    width: contentWidth,
    fontSize: headerHeadingSize,
    lineHeight: 22,
    color: palette.headerText,
    bold: true,
  });
  cursorY -= 6;
  drawParagraph({
    text: input.subheading,
    x: contentX,
    y: cursorY - headerSubSize,
    width: contentWidth,
    fontSize: headerSubSize,
    lineHeight: 15,
    color: palette.headerSubText,
  });

  cursorY = headerY - 18;

  const rangeCardPaddingX = 16;
  const rangeCardPaddingTop = 14;
  const rangeCardRadius = 10;
  const rangeCardHeight = 112;
  const rangeCardY = cursorY - rangeCardHeight;

  page.drawSvgPath(roundedRectPath(contentX, rangeCardY, contentWidth, rangeCardHeight, rangeCardRadius), {
    color: palette.rangeBackground,
    borderColor: palette.rangeBorder,
    borderWidth: 1,
  });

  let rangeY = cursorY - rangeCardPaddingTop;
  const rangeKickerSize = 9.2;
  page.drawText('ESTIMATE RANGE', {
    x: contentX + rangeCardPaddingX,
    y: rangeY - rangeKickerSize,
    size: rangeKickerSize,
    font: boldFont,
    color: palette.rangeKicker,
  });
  rangeY -= rangeKickerSize + 10;

  const rangeSize = 22.4;
  page.drawText(input.estimateRange, {
    x: contentX + rangeCardPaddingX,
    y: rangeY - rangeSize,
    size: rangeSize,
    font: boldFont,
    color: palette.titleText,
  });
  rangeY -= rangeSize + 10;

  const bodyLineSize = 10.9;
  page.drawText(`Estimated Duration: ${input.durationRange}`, {
    x: contentX + rangeCardPaddingX,
    y: rangeY - bodyLineSize,
    size: bodyLineSize,
    font,
    color: hexColor('#1e293b'),
  });
  rangeY -= bodyLineSize + 10;
  page.drawText(`Quote Number: ${input.quoteNumber}`, {
    x: contentX + rangeCardPaddingX,
    y: rangeY - bodyLineSize,
    size: bodyLineSize,
    font,
    color: hexColor('#1e293b'),
  });

  cursorY = rangeCardY - 18;

  cursorY = drawParagraph({
    text: input.intro,
    x: contentX,
    y: cursorY - 11.4,
    width: contentWidth,
    fontSize: 11.4,
    lineHeight: 16,
    color: palette.bodyText,
  }) - 14;

  const footerTextLines = wrapTextToWidth(input.footerLine, font, footerFontSize, contentWidth);
  const footerHeight = Math.max(1, footerTextLines.length) * footerLineHeight;
  const footerY = cardY + footerPadding;
  const maxContentY = footerY + footerHeight + 16;

  cursorY = drawDetailsTable({
    rows: input.detailRows,
    x: contentX,
    yTop: cursorY,
    width: contentWidth,
    maxY: maxContentY,
  });

  cursorY = drawCard({
    title: 'Project Notes',
    items: input.notes,
    tone: 'neutral',
    x: contentX,
    yTop: cursorY,
    width: contentWidth,
    maxY: maxContentY,
  });

  cursorY = drawCard({
    title: 'Items Requiring Confirmation',
    items: input.redFlags,
    tone: 'danger',
    x: contentX,
    yTop: cursorY,
    width: contentWidth,
    maxY: maxContentY,
  });

  if (input.cta && cursorY - 52 > maxContentY) {
    const buttonWidth = Math.min(320, Math.max(180, boldFont.widthOfTextAtSize(input.cta.label, 11.5) + 36));
    const buttonHeight = 28;
    const buttonX = contentX;
    const buttonY = cursorY - buttonHeight - 6;
    page.drawSvgPath(roundedRectPath(buttonX, buttonY, buttonWidth, buttonHeight, 8), { color: palette.ctaBackground });
    page.drawText(input.cta.label, {
      x: buttonX + 16,
      y: buttonY + 9,
      size: 11.5,
      font: boldFont,
      color: palette.headerText,
    });

    cursorY = buttonY - 12;
    if (input.cta.helper && cursorY - 26 > maxContentY) {
      cursorY =
        drawParagraph({
          text: input.cta.helper,
          x: contentX,
          y: cursorY - 9.8,
          width: contentWidth,
          fontSize: 9.8,
          lineHeight: 13,
          color: hexColor('#475569'),
        }) - 10;
    }
  }

  footerTextLines.forEach((line, index) => {
    page.drawText(line, {
      x: contentX,
      y: footerY + (footerTextLines.length - 1 - index) * footerLineHeight,
      size: footerFontSize,
      font,
      color: palette.mutedText,
    });
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

    const templateInput: EmailTemplateInput = usesResendOnboardingSender
      ? {
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
        }
      : {
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
        };

    const html = renderEmailTemplate(templateInput);
    const pdfBytes = await buildQuotePdf(templateInput);

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
