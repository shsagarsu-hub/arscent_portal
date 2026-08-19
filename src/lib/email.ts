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
}

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
  const recipients = [input.hospitalEmail, ...input.managerEmails].filter((e): e is string => !!e);
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
      <p style="margin-top: 20px; color: #6b7c9e; font-size: 12px;">
        Submitted by ${escapeHtml(input.hospitalName ?? "a hospital user")} on ${new Date(input.createdAt).toLocaleString("en-IN")}.
      </p>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Arscent Orders" <${GMAIL_USER}>`,
      to: recipients,
      subject: `Order ${input.workOrderNo} — ${input.accountLabel}`,
      html,
    });
    return { sent: true, recipients };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients };
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
      <p style="margin-top: 24px; color: #6b7c9e; font-size: 11px;">
        PO ${escapeHtml(input.poNumber)} — placed via the Arscent Account Management Portal
        ${input.placedByName ? `by ${escapeHtml(input.placedByName)} ` : ""}on ${new Date(input.createdAt).toLocaleString("en-IN")}.
      </p>
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
