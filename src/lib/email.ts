import "server-only";
import { Resend } from "resend";

// Resend's shared sandbox sender -- works with zero setup, but can only
// deliver to the account's own verified email until a real domain is
// verified. Swap via RESEND_FROM_EMAIL once a domain is set up.
const FROM = process.env.RESEND_FROM_EMAIL || "Arscent Orders <donotreply@resend.dev>";

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
 * and every account_manager/admin. No-ops (rather than throwing) when
 * RESEND_API_KEY isn't set, so order submission itself never breaks just
 * because email hasn't been configured yet -- the caller can inspect the
 * returned SendResult to know whether it actually went out.
 *
 * RESEND_SANDBOX_RECIPIENT is an interim measure for accounts with no
 * verified sending domain yet: Resend's sandbox mode rejects delivery to
 * anyone but the account's own signup address, so every real recipient
 * would otherwise silently fail. When set, every notification routes to
 * that one inbox instead, with the real intended recipients listed in the
 * email body so nothing is lost. Unset it (once a domain is verified) and
 * delivery reverts to the real per-recipient behavior automatically.
 */
export async function sendOrderNotification(input: OrderEmailInput): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const intendedRecipients = [input.hospitalEmail, ...input.managerEmails].filter((e): e is string => !!e);
  const sandboxOverride = process.env.RESEND_SANDBOX_RECIPIENT;
  const recipients = sandboxOverride ? [sandboxOverride] : intendedRecipients;

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set -- skipped notification for ${input.workOrderNo} (would have gone to: ${intendedRecipients.join(", ") || "nobody resolved"})`
    );
    return { sent: false, reason: "RESEND_API_KEY not configured", recipients: intendedRecipients };
  }
  if (recipients.length === 0) {
    return { sent: false, reason: "no recipients resolved", recipients: [] };
  }

  const resend = new Resend(apiKey);
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

  const sandboxNote = sandboxOverride
    ? `<p style="margin: 0 0 16px; padding: 8px 10px; background: #fef3e2; color: #d68910; font-size: 12px; border-radius: 4px;">
         Sandbox routing active — this would normally have gone to: ${escapeHtml(intendedRecipients.join(", ") || "nobody resolved")}.
       </p>`
    : "";

  const html = `
    <div style="font-family: Arial, sans-serif; color: #172544; max-width: 560px;">
      <h2 style="margin: 0 0 4px;">Order ${input.workOrderNo}</h2>
      ${sandboxNote}
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
    const { error } = await resend.emails.send({
      from: FROM,
      to: recipients,
      subject: `Order ${input.workOrderNo} — ${input.accountLabel}`,
      html,
    });
    if (error) return { sent: false, error: error.message, recipients };
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
 * no-op-without-a-key and sandbox-reroute behavior as sendOrderNotification
 * above — see its docstring. Unlike that one, the caller (submitPurchaseOrder)
 * has already written the inventory-affecting stock_movements rows by the
 * time this runs, so a failed/unsent email here never rolls back the
 * inventory increase; it only leaves the manager to re-send by hand.
 */
export async function sendPurchaseOrderEmail(input: PurchaseOrderEmailInput): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const intendedTo = input.to;
  const intendedCc = input.cc;
  const sandboxOverride = process.env.RESEND_SANDBOX_RECIPIENT;
  const to = sandboxOverride ? [sandboxOverride] : intendedTo;
  const cc = sandboxOverride ? [] : intendedCc;

  if (!apiKey) {
    console.warn(
      `[email] RESEND_API_KEY not set -- skipped PO email for ${input.poNumber} (would have gone to: ${[...intendedTo, ...intendedCc].join(", ") || "nobody resolved"})`
    );
    return { sent: false, reason: "RESEND_API_KEY not configured", recipients: intendedTo };
  }
  if (to.length === 0) {
    return { sent: false, reason: "no recipients", recipients: [] };
  }

  const resend = new Resend(apiKey);

  const sandboxNote = sandboxOverride
    ? `<p style="margin: 0 0 16px; padding: 8px 10px; background: #fef3e2; color: #d68910; font-size: 12px; border-radius: 4px;">
         Sandbox routing active — this would normally have gone to: ${escapeHtml([...intendedTo, ...intendedCc].join(", ") || "nobody resolved")}.
       </p>`
    : "";

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
      ${sandboxNote}
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
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      cc: cc.length > 0 ? cc : undefined,
      replyTo: input.replyTo || undefined,
      subject: `Arscent PO ${input.poNumber}`,
      html,
      attachments: input.pdf ? [{ filename: input.pdf.filename, content: input.pdf.content }] : undefined,
    });
    if (error) return { sent: false, error: error.message, recipients: to };
    return { sent: true, recipients: [...to, ...cc] };
  } catch (err) {
    return { sent: false, error: err instanceof Error ? err.message : "unknown error", recipients: to };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
