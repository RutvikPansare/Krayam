import { Resend } from "resend";

/**
 * Email sender — Resend wrapper.
 * If RESEND_API_KEY is missing, emails are logged to console instead of sent,
 * so the full flow is testable locally without an account.
 */

const FROM = process.env.EMAIL_FROM || "Krayam <onboarding@resend.dev>";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("── [email mock] ───────────────────────────");
    console.log("To:", opts.to);
    console.log("Subject:", opts.subject);
    if (opts.attachments?.length) {
      console.log("Attachments:", opts.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(", "));
    }
    console.log(opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 500));
    console.log("───────────────────────────────────────────");
    return { id: "mock-" + Date.now() };
  }
  const resend = new Resend(key);
  const { data, error } = await resend.emails.send({
    from: FROM,
    to: Array.isArray(opts.to) ? opts.to : [opts.to],
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
  });
  if (error) throw new Error(`Resend error: ${error.message}`);
  return data;
}

export interface BatchEmail {
  to: string;
  subject: string;
  html: string;
}

export interface BatchResult {
  to: string;
  id: string | null;
  error: string | null;
}

/**
 * Batch send — one Resend API call for up to 100 emails. Used for RFQ
 * blasts WITHOUT attachments (Resend's batch endpoint rejects attachments;
 * RFQs with spec sheets fall back to parallel individual sends).
 * Returns per-email results: one bad address never blocks the rest.
 */
export async function sendEmailBatch(emails: BatchEmail[]): Promise<BatchResult[]> {
  if (emails.length === 0) return [];
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`── [email mock] batch of ${emails.length} ──`);
    for (const e of emails) console.log("  To:", e.to, "·", e.subject);
    return emails.map((e) => ({ to: e.to, id: "mock-" + Date.now() + "-" + e.to, error: null }));
  }
  const resend = new Resend(key);
  try {
    const { data, error } = await resend.batch.send(
      emails.map((e) => ({ from: FROM, to: [e.to], subject: e.subject, html: e.html }))
    );
    if (error) throw new Error(error.message);
    // Resend returns ids in request order
    return emails.map((e, i) => ({ to: e.to, id: data?.data?.[i]?.id ?? null, error: null }));
  } catch (err) {
    // Whole-batch failure (auth, rate limit): report per-email so callers log each
    const msg = err instanceof Error ? err.message : "batch send failed";
    return emails.map((e) => ({ to: e.to, id: null, error: msg }));
  }
}

/* ── Shared layout ── */

function shell(body: string) {
  return `
  <div style="background:#F4F5F2;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;">
      <div style="text-align:center;margin-bottom:20px;">
        <span style="font-size:24px;font-weight:800;color:#0B2239;letter-spacing:-0.5px;">Krayam</span>
        <span style="font-size:11px;color:#8A929D;display:block;margin-top:2px;letter-spacing:2px;text-transform:uppercase;">Procurement Intelligence</span>
      </div>
      <div style="background:#fff;border-radius:14px;border:1px solid rgba(20,24,29,0.08);padding:32px;">
        ${body}
      </div>
      <p style="text-align:center;font-size:11px;color:#8A929D;margin-top:18px;">Sent by Krayam · automated procurement for Indian manufacturers</p>
    </div>
  </div>`;
}

/* Bulletproof button: table-based so Outlook's Word renderer keeps the
   padding and background. The <a> styles cover Gmail/Apple Mail. */
function btn(href: string, label: string, bg: string, color = "#fff", border = "") {
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="display:inline-table;margin:4px;"><tr>
    <td bgcolor="${bg}" style="border-radius:8px;${border ? `border:${border};` : ""}">
      <a href="${href}" target="_blank" style="display:inline-block;background:${bg};color:${color};font-weight:600;font-size:14px;padding:12px 28px;border-radius:8px;text-decoration:none;font-family:Helvetica,Arial,sans-serif;">${label}</a>
    </td>
  </tr></table>`;
}

interface PRLine {
  item_name: string;
  quantity: number;
  unit: string;
  notes?: string | null;
}

function itemTable(items: PRLine[]) {
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;color:#14181D;">${it.item_name}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #EEE;font-size:13px;color:#5B6470;text-align:right;">${it.quantity} ${it.unit}</td>
      </tr>`
    )
    .join("");
  return `<table style="width:100%;border-collapse:collapse;margin:14px 0;">
    <tr><th style="text-align:left;padding:8px 10px;font-size:11px;color:#8A929D;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #EEE;">Item</th>
        <th style="text-align:right;padding:8px 10px;font-size:11px;color:#8A929D;text-transform:uppercase;letter-spacing:1px;border-bottom:2px solid #EEE;">Qty</th></tr>
    ${rows}
  </table>`;
}

/* ── Feature 02: approval email ── */

export function approvalEmailHtml(opts: {
  prNumber: string;
  requesterName: string;
  department: string | null;
  priority: string;
  justification: string | null;
  estimatedValue?: number | null;
  items: PRLine[];
  approveUrl: string;
  rejectUrl: string;
  validHours?: number;
}) {
  const validity = opts.validHours ?? 48;
  const estimate =
    opts.estimatedValue != null && opts.estimatedValue > 0
      ? `<p style="font-size:13px;color:#5B6470;margin:4px 0 0;">Estimated value: <b style="color:#14181D;">Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(opts.estimatedValue)}</b> (from material master prices)</p>`
      : "";
  return shell(`
    <p style="font-size:11px;color:#B97A0A;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 8px;">Approval required</p>
    <h1 style="font-size:20px;color:#0B2239;margin:0 0 6px;">Purchase Request ${opts.prNumber}</h1>
    <p style="font-size:14px;color:#5B6470;margin:0 0 4px;">Raised by <b style="color:#14181D;">${opts.requesterName}</b>${opts.department ? ` · ${opts.department}` : ""} · Priority: <b style="color:${opts.priority === "urgent" ? "#DC2626" : "#14181D"};text-transform:capitalize;">${opts.priority}</b></p>
    ${estimate}
    ${opts.justification ? `<p style="font-size:13px;color:#5B6470;background:#F4F5F2;border-radius:8px;padding:10px 14px;margin:12px 0;">"${opts.justification}"</p>` : ""}
    ${itemTable(opts.items)}
    <div style="text-align:center;margin-top:22px;">
      ${btn(opts.approveUrl, "✓ Approve", "#15803D")}
      ${btn(opts.rejectUrl, "✕ Reject", "#ffffff", "#DC2626", "1.5px solid #DC2626")}
    </div>
    <p style="font-size:12px;color:#8A929D;text-align:center;margin-top:18px;">One click, no login needed. Link valid for ${validity} hours.</p>
  `);
}

/* ── Feature 04: RFQ email to vendor ── */

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function attachmentList(attachments?: { file_name: string; size_bytes: number; url: string }[]): string {
  if (!attachments || attachments.length === 0) return "";
  const rows = attachments
    .map((a) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #EEE;font-size:13px;color:#14181D;">📎 ${a.file_name} <span style="color:#8A929D;">(${fmtBytes(a.size_bytes)})</span></td>
      <td style="padding:6px 10px;border-bottom:1px solid #EEE;text-align:right;"><a href="${a.url}" style="color:#2A6286;font-size:13px;">Download</a></td>
    </tr>`)
    .join("");
  return `<p style="font-size:12px;color:#8A929D;text-transform:uppercase;letter-spacing:1px;margin:18px 0 6px;">Spec sheets & drawings</p>
    <table style="width:100%;border-collapse:collapse;">${rows}</table>
    <p style="font-size:11px;color:#8A929D;margin-top:6px;">Secure links, valid 7 days. Reply if a link has expired and we'll re-issue it.</p>`;
}

export function rfqEmailHtml(opts: {
  vendorName: string;
  rfqNumber: string;
  companyName: string;
  dueDate: string | null;
  items: PRLine[];
  quoteUrl: string;
  attachments?: { file_name: string; size_bytes: number; url: string }[];
}) {
  return shell(`
    <p style="font-size:11px;color:#2A6286;text-transform:uppercase;letter-spacing:2px;font-weight:700;margin:0 0 8px;">Request for quotation</p>
    <h1 style="font-size:20px;color:#0B2239;margin:0 0 6px;">${opts.rfqNumber} — ${opts.companyName}</h1>
    <p style="font-size:14px;color:#5B6470;margin:0 0 4px;">Dear ${opts.vendorName}, please quote your best price for the items below.${opts.dueDate ? ` Quotes due by <b style="color:#14181D;">${opts.dueDate}</b>.` : ""}</p>
    ${itemTable(opts.items)}
    ${attachmentList(opts.attachments)}
    <div style="text-align:center;margin-top:22px;">
      ${btn(opts.quoteUrl, "Submit your quote →", "#0B2239")}
    </div>
    <p style="font-size:12px;color:#8A929D;text-align:center;margin-top:18px;">Structured form, takes 2 minutes — no account needed.</p>
  `);
}

/* ── Status notification to requester ── */

export function statusEmailHtml(opts: {
  prNumber: string;
  status: "approved" | "rejected";
  approverNote?: string | null;
  sapPrNumber?: string | null;
}) {
  const ok = opts.status === "approved";
  return shell(`
    <h1 style="font-size:20px;color:${ok ? "#15803D" : "#DC2626"};margin:0 0 6px;">${ok ? "✓ Approved" : "✕ Rejected"} — ${opts.prNumber}</h1>
    <p style="font-size:14px;color:#5B6470;">Your purchase request has been ${opts.status}.</p>
    ${opts.sapPrNumber ? `<p style="font-size:14px;color:#5B6470;">SAP Purchase Requisition created: <b style="color:#14181D;">${opts.sapPrNumber}</b></p>` : ""}
    ${opts.approverNote ? `<p style="font-size:13px;color:#5B6470;background:#F4F5F2;border-radius:8px;padding:10px 14px;">Note: "${opts.approverNote}"</p>` : ""}
  `);
}
