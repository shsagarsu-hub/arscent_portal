import "server-only";
import { Resend } from "resend";

// Resend's shared sandbox sender -- works with zero setup, but can only
// deliver to the account's own verified email until a real domain is
// verified. Swap via RESEND_FROM_EMAIL once a domain is set up.
const FROM = process.env.RESEND_FROM_EMAIL || "Arscent Orders <onboarding@resend.dev>";

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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
