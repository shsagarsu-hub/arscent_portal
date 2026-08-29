import "server-only";
import nodemailer from "nodemailer";

// Sends through Gmail SMTP as sales.arscent@gmail.com -- the same address
// Arscent's real Zeiss PO emails already go out from (see the "Arscent PO
// #15 & 16" thread). Chosen over Resend's sandbox mode specifically because
// Gmail needs no domain verification to deliver to arbitrary recipients
// (@zeiss.com, @arraymed.co.in, etc.) -- Resend's shared sandbox sender can
// only ever reach the account's own signup address until a domain is
// verified, which isn't available yet.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;

function getTransporter() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

export interface OrderEmailLine {
  skuName: string;
  spec: string | null;
  qty: number;
  netPrice: number | null;
}

export interface OrderEmailInput {
  workOrderNo: string;
  orderTypeLabel: string;
  accountLabel: string;
  locationName: string;
  poNumber: string | null;
  requestedDate: string | null;
  comment: string | null;
  createdAt: string;
  lines: OrderEmailLine[];
  hospitalEmail: string | null;
  hospitalName: string | null;
  managerEmails: string[];
  poAttachmentUrl?: string | null;
  extraTo?: string[];
  cc?: string[];
}

// Matches PurchaseOrderPanel's own DEFAULT_GST -- no per-order GST rate is
// captured on `orders` today (only `tax_code`, a free-text field), so this
// is the same standing assumption already used for the Zeiss PO side.
const DEFAULT_GST_PERCENT = 5;

export interface SendResult {
  sent: boolean;
  reason?: string;
  recipients?: string[];
  error?: string;
}

/**
 * Fires the order-confirmation email to both the submitting hospital user
 * and every account_manager/admin. No-ops (rather than throwing) when Gmail
 * credentials aren't set, so order submission itself never breaks just
 * because email hasn't been configured yet -- the caller can inspect the
 * returned SendResult to know whether it actually went out.
 */
export async function sendOrderNotification(input: OrderEmailInput): Promise<SendResult> {
  const recipients = [input.hospitalEmail, ...input.managerEmails, ...(input.extraTo ?? [])].filter(
    (e): e is string => !!e
  );
  const cc = input.cc ?? [];
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      `[email] GMAIL_USER/GMAIL_APP_PASSWORD not set -- skipped notification for ${input.workOrderNo} (would have gone to: ${recipients.join(", ") || "nobody resolved"})`
    );
    return { sent: false, reason: "Gmail sender not configured", recipients };
  }
  if (recipients.length === 0) {
    return { sent: false, reason: "no recipients resolved", recipients: [] };
  }

  const total = input.lines.reduce((a, l) => a + l.qty * (l.netPrice ?? 0), 0);

  const rows = input.lines
    .map(
      (l) => `
        <tr style="border-bottom: 1px solid #f3f6fc;">
          <td style="padding: 6px 0;">${escapeHtml(l.skuName)}</td>
          <td style="padding: 6px 0;">${escapeHtml(l.spec ?? "—")}</td>
          <td style="padding: 6px 0;">${l.qty}</td>
          <td style="padding: 6px 0;">${l.netPrice ?? "—"}</td>
        </tr>`
    )
    .join("");

  const html = `
    <div style="font-family: Arial, sans-serif; color: #172544; max-width: 560px;">
      <h2 style="margin: 0 0 4px;">Order ${input.workOrderNo}</h2>
      <p style="margin: 0 0 16px; color: #6b7c9e; font-size: 13px;">
        ${escapeHtml(input.orderTypeLabel)} — ${escapeHtml(input.accountLabel)} · ${escapeHtml(input.locationName)}
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <tr><td style="padding: 4px 0; color: #6b7c9e; width: 140px;">Requested date</td><td>${input.requestedDate ?? "—"}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7c9e;">PO number</td><td>${escapeHtml(input.poNumber ?? "—")}</td></tr>
        <tr><td style="padding: 4px 0; color: #6b7c9e;">Comment</td><td>${escapeHtml(input.comment ?? "—")}</td></tr>
      </table>
      <table style="width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 1px solid #dbe5f6; text-align: left;">
            <th style="padding: 6px 0;">SKU</th>
            <th style="padding: 6px 0;">Diopter / Measurement</th>
            <th style="padding: 6px 0;">Qty</th>
            <th style="padding: 6px 0;">Net Price</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top: 12px; font-weight: bold;">Total (ex GST): ${total.toLocaleString("en-IN")}</p>
      <p style="margin: 2px 0 0; font-weight: bold;">Total (incl. GST @ ${DEFAULT_GST_PERCENT}%): ${(total * (1 + DEFAULT_GST_PERCENT / 100)).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      // Display name credits whichever hospital actually placed the order,
      // even though the address itself has to stay Arscent's own Gmail
      // account -- Gmail SMTP only sends as the authenticated account (or a
      // verified alias of it), so a real NN/hospital From address would get
      // rewritten or flagged as spoofed by the recipient's mail server.
      from: `"${input.accountLabel} (via Arscent Orders)" <${GMAIL_USER}>`,
      // Without this, hitting Reply on this email went to Arscent's own
      // shared inbox instead of back to whoever actually placed the order.
      replyTo: input.hospitalEmail || undefined,
      to: recipients,
      cc: cc.length > 0 ? cc : undefined,
      subject: `Order ${input.workOrderNo} — ${input.accountLabel}`,
      html,
      // po-attachments is a public Storage bucket (see
      // /api/hospital/po-upload), so nodemailer can fetch it directly by
      // URL instead of us downloading and re-buffering it here.
      attachments: input.poAttachmentUrl ? [{ filename: "PO copy" + fileExt(input.poAttachmentUrl), path: input.poAttachmentUrl }] : undefined,
    });
    return { sent: true, recipients: [...recipients, ...cc] };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients };
  }
}

export interface UsageInvoiceEmailInput {
  accountLabel: string;
  locationName: string | null;
  skuName: string;
  qty: number;
  entryDate: string;
  to: string[];
  invoiceUrl: string;
}

/**
 * Sends one consignment usage entry's invoice to the hospital -- fired from
 * the "Send Invoice Email" button next to that entry in Pending Invoice,
 * once the invoice file has been uploaded there. Same no-op-without-
 * credentials and attach-by-URL behavior as the other email senders here.
 */
export async function sendUsageInvoiceEmail(input: UsageInvoiceEmailInput): Promise<SendResult> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(`[email] GMAIL_USER/GMAIL_APP_PASSWORD not set -- skipped usage invoice email (would have gone to: ${input.to.join(", ") || "nobody resolved"})`);
    return { sent: false, reason: "Gmail sender not configured", recipients: input.to };
  }
  if (input.to.length === 0) {
    return { sent: false, reason: "no recipients resolved", recipients: [] };
  }

  const entryDateLabel = new Date(input.entryDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const html = `
    <div style="font-family: Arial, sans-serif; color: #172544; max-width: 560px;">
      <p style="margin: 0 0 16px;">Dear Team,</p>
      <p style="margin: 0 0 16px;">PFA the invoice for usage dated ${entryDateLabel} (${escapeHtml(input.skuName)}, qty ${input.qty}).</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Arscent Orders" <${GMAIL_USER}>`,
      to: input.to,
      subject: `Usage Invoice — ${input.accountLabel}${input.locationName ? ` (${input.locationName})` : ""} — ${entryDateLabel}`,
      html,
      attachments: [{ filename: "Invoice" + fileExt(input.invoiceUrl), path: input.invoiceUrl }],
    });
    return { sent: true, recipients: input.to };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients: input.to };
  }
}

export interface SalesInvoiceEmailInput {
  workOrderNo: string;
  accountLabel: string;
  locationName: string | null;
  to: string[];
  cc: string[];
  invoiceUrl: string;
}

/**
 * Sends a closed Saleable order's invoice to the hospital -- fired from the
 * "Send Invoice Email" step right after the invoice is uploaded, with the
 * account manager's own To/Cc (unlike sendUsageInvoiceEmail, which always
 * auto-resolves the hospital's login and doesn't ask).
 */
export async function sendSalesInvoiceEmail(input: SalesInvoiceEmailInput): Promise<SendResult> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(`[email] GMAIL_USER/GMAIL_APP_PASSWORD not set -- skipped sales invoice email for ${input.workOrderNo} (would have gone to: ${input.to.join(", ") || "nobody resolved"})`);
    return { sent: false, reason: "Gmail sender not configured", recipients: input.to };
  }
  if (input.to.length === 0) {
    return { sent: false, reason: "no recipients resolved", recipients: [] };
  }

  const html = `
    <div style="font-family: Arial, sans-serif; color: #172544; max-width: 560px;">
      <p style="margin: 0 0 16px;">Dear Team,</p>
      <p style="margin: 0 0 16px;">PFA the invoice for order ${escapeHtml(input.workOrderNo)}.</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"${input.accountLabel} (via Arscent Orders)" <${GMAIL_USER}>`,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      subject: `Sales Invoice — ${input.workOrderNo} — ${input.accountLabel}${input.locationName ? ` (${input.locationName})` : ""}`,
      html,
      attachments: [{ filename: "Invoice" + fileExt(input.invoiceUrl), path: input.invoiceUrl }],
    });
    return { sent: true, recipients: [...input.to, ...input.cc] };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients: input.to };
  }
}

export interface PurchaseOrderEmailInput {
  poNumber: string;
  notes: string | null;
  to: string[];
  cc: string[];
  replyTo: string | null;
  placedByName: string | null;
  createdAt: string;
  pdf: { filename: string; content: Buffer } | null;
}

/**
 * Sends the Zeiss purchase-order email straight from the Purchase tab. Same
 * no-op-without-credentials behavior as sendOrderNotification above -- see
 * its docstring. Unlike that one, the caller (submitPurchaseOrder) has
 * already written the inventory-affecting stock_movements rows by the time
 * this runs, so a failed/unsent email here never rolls back the inventory
 * increase; it only leaves the manager to re-send by hand.
 */
export async function sendPurchaseOrderEmail(input: PurchaseOrderEmailInput): Promise<SendResult> {
  const transporter = getTransporter();

  if (!transporter) {
    console.warn(
      `[email] GMAIL_USER/GMAIL_APP_PASSWORD not set -- skipped PO email for ${input.poNumber} (would have gone to: ${[...input.to, ...input.cc].join(", ") || "nobody resolved"})`
    );
    return { sent: false, reason: "Gmail sender not configured", recipients: input.to };
  }
  if (input.to.length === 0) {
    return { sent: false, reason: "no recipients", recipients: [] };
  }

  // Matches Arscent's own existing Zeiss PO emails verbatim (subject style
  // "Arscent PO #.." and this exact "Dear Team / .. kindly do the needful /
  // Regards, Lakshmikanth S / address / phone" body) -- the standing
  // signature used for every PO regardless of which account manager is
  // actually operating the portal, same reasoning as the PDF's scanned
  // signature block. The line-item detail lives in the attached PDF, not
  // the email body, because the real emails this replicates never listed
  // items inline either.
  const html = `
    <div style="font-family: Arial, sans-serif; color: #172544; max-width: 560px;">
      <p style="margin: 0 0 16px;">Dear Team,</p>
      <p style="margin: 0 0 16px;">${input.notes ? escapeHtml(input.notes) : "Please find the attached PO &amp; Kindly do the needful."}</p>
      <p style="margin: 24px 0 0;">Regards,</p>
      <p style="margin: 16px 0 0;">Lakshmikanth S</p>
      <p style="margin: 16px 0 0;">Arscent Health Services Pvt. Ltd.,</p>
      <p style="margin: 8px 0 0;">No: 110, 2nd Cross, 4th Main,</p>
      <p style="margin: 8px 0 0;">HAL 3rd Stage, Bangalore - 560075</p>
      <p style="margin: 8px 0 0;">Ph:080-40950869 / 9035573666</p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Arscent Orders" <${GMAIL_USER}>`,
      to: input.to,
      cc: input.cc.length > 0 ? input.cc : undefined,
      replyTo: input.replyTo || undefined,
      subject: `Arscent PO ${input.poNumber}`,
      html,
      attachments: input.pdf ? [{ filename: input.pdf.filename, content: input.pdf.content }] : undefined,
    });
    return { sent: true, recipients: [...input.to, ...input.cc] };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients: input.to };
  }
}

function fileExt(url: string): string {
  const match = /\.([a-zA-Z0-9]{2,5})(?:\?|$)/.exec(url);
  return match ? `.${match[1]}` : "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
