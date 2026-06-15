/**
 * Feature 12 — vendor bank account change detection (fraud control).
 *
 * Invoice-redirection fraud works by changing the bank account on an otherwise
 * legitimate-looking invoice. So if the bank details printed on the invoice
 * differ from the vendor master, we raise a HIGH-priority CFO alert IMMEDIATELY
 * — regardless of whether the 3-way match itself is clean.
 *
 * Two hard guarantees from the spec, enforced here:
 *   1. The alert is sent SYNCHRONOUSLY, before any further processing. The
 *      pipeline awaits alertCfoBankChange() and only continues once the alert
 *      has been recorded (and the email attempted).
 *   2. It must NEVER fail silently. The alert row is written first (durable
 *      record), and if the email send throws we surface it on the returned
 *      object and log loudly — we never swallow it into a void.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyRoles } from "@/lib/notify";
import { sendEmail } from "@/lib/email";
import type { ExtractedBankDetails } from "@/types/invoice";

export interface VendorBankMaster {
  vendor_id: string | null;
  vendor_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  bank_name: string | null;
}

/** Normalize for comparison: ignore spacing/case, treat empty as absent. */
const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, "").toUpperCase();

export interface BankChangeFinding {
  changed: boolean;
  /** True only when there is a master to compare against AND it differs. */
  accountChanged: boolean;
  ifscChanged: boolean;
}

/**
 * Pure comparison — no side effects. Returns whether the invoice's bank details
 * differ from the master. If the vendor master has no bank on file yet, this is
 * the first time we've seen one: not treated as a "change" (nothing to diverge
 * from), so it does not fire a fraud alert.
 */
export function compareBank(invoice: ExtractedBankDetails, master: VendorBankMaster): BankChangeFinding {
  const masterHasBank = !!norm(master.account_number) || !!norm(master.ifsc);
  if (!masterHasBank) return { changed: false, accountChanged: false, ifscChanged: false };

  const accountChanged = !!norm(invoice.account_number) && norm(invoice.account_number) !== norm(master.account_number);
  const ifscChanged = !!norm(invoice.ifsc) && norm(invoice.ifsc) !== norm(master.ifsc);
  return { changed: accountChanged || ifscChanged, accountChanged, ifscChanged };
}

export interface BankAlertResult {
  alerted: boolean;
  alertId: string | null;
  /** Non-null when the synchronous notification could not be delivered. */
  error: string | null;
}

/**
 * Record + dispatch a high-priority bank-change alert SYNCHRONOUSLY.
 * Caller MUST await this before continuing the pipeline.
 *
 * Order: persist the alert row → email the CFO(s) → in-app notify. The row is
 * written first so the change is durably recorded even if email delivery later
 * fails; a delivery failure is returned (not thrown) so the pipeline can decide
 * to halt while the record still exists for audit.
 */
export async function alertCfoBankChange(opts: {
  orgId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  vendor: VendorBankMaster;
  invoiceBank: ExtractedBankDetails;
}): Promise<BankAlertResult> {
  const admin = createAdminClient();

  // 1. Durable record (written before anything else can fail).
  const { data: alertRow, error: insErr } = await admin
    .from("bank_change_alerts")
    .insert({
      org_id: opts.orgId,
      invoice_id: opts.invoiceId,
      vendor_id: opts.vendor.vendor_id,
      vendor_name: opts.vendor.vendor_name,
      old_account: opts.vendor.account_number,
      new_account: opts.invoiceBank.account_number,
      old_ifsc: opts.vendor.ifsc,
      new_ifsc: opts.invoiceBank.ifsc,
      severity: "high",
      notified: false,
    })
    .select("id")
    .single();

  if (insErr || !alertRow) {
    // Could not even record it — this is loud, not silent.
    const error = `Failed to record bank-change alert: ${insErr?.message ?? "unknown"}`;
    console.error("[bank-detect]", error, { invoiceId: opts.invoiceId });
    return { alerted: false, alertId: null, error };
  }

  const subject = `⚠ HIGH PRIORITY: Vendor bank details changed — ${opts.vendor.vendor_name ?? "vendor"}`;
  const html = bankChangeEmailHtml({
    vendorName: opts.vendor.vendor_name,
    invoiceNumber: opts.invoiceNumber,
    oldAccount: opts.vendor.account_number,
    newAccount: opts.invoiceBank.account_number,
    oldIfsc: opts.vendor.ifsc,
    newIfsc: opts.invoiceBank.ifsc,
    bankName: opts.invoiceBank.bank_name,
    invoiceId: opts.invoiceId,
  });

  let error: string | null = null;
  try {
    // 2. Synchronous email to every CFO/finance controller in the org.
    const recipients = await cfoEmails(opts.orgId);
    if (recipients.length > 0) {
      await sendEmail({ to: recipients, subject, html });
    }
    // 3. In-app notification (best-effort, never throws).
    await notifyRoles({
      orgId: opts.orgId,
      type: "invoice_bank_change",
      title: subject,
      body: `Bank details on invoice ${opts.invoiceNumber ?? ""} differ from the vendor master. Verify before any payment.`.trim(),
      link: `/dashboard/invoices/${opts.invoiceId}`,
    });
    await admin.from("bank_change_alerts").update({ notified: true }).eq("id", alertRow.id);
  } catch (err) {
    error = err instanceof Error ? err.message : "Bank-change alert delivery failed";
    // Loud — never swallowed. Row already persisted; delivery failure surfaced.
    console.error("[bank-detect] CFO alert delivery failed:", error, { alertId: alertRow.id });
  }

  return { alerted: true, alertId: alertRow.id, error };
}

/** Resolve CFO + owner email addresses for the org (owner oversees finance). */
async function cfoEmails(orgId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("team_members")
    .select("email, role")
    .eq("org_id", orgId)
    .in("role", ["cfo", "owner"]);
  return Array.from(new Set((data ?? []).map((m) => m.email).filter(Boolean)));
}

function mask(acc: string | null): string {
  if (!acc) return "—";
  const a = acc.replace(/\s+/g, "");
  return a.length <= 4 ? a : "••••" + a.slice(-4);
}

function bankChangeEmailHtml(o: {
  vendorName: string | null;
  invoiceNumber: string | null;
  oldAccount: string | null;
  newAccount: string | null;
  oldIfsc: string | null;
  newIfsc: string | null;
  bankName: string | null;
  invoiceId: string;
}): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL || "";
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;">
    <div style="background:#DC2626;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">High priority · fraud check</div>
      <div style="font-size:18px;font-weight:800;margin-top:4px;">Vendor bank details changed</div>
    </div>
    <div style="background:#fff;border:1px solid #eee;border-top:0;border-radius:0 0 12px 12px;padding:20px;">
      <p style="font-size:14px;color:#14181D;">The bank details on invoice <b>${o.invoiceNumber ?? "(unnumbered)"}</b> from <b>${o.vendorName ?? "vendor"}</b> do not match the vendor master. Verify directly with the vendor by phone before approving any payment.</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:14px 0;">
        <tr><td style="padding:6px 8px;color:#8A929D;">On file (master)</td><td style="padding:6px 8px;text-align:right;color:#14181D;">A/C ${mask(o.oldAccount)} · ${o.oldIfsc ?? "—"}</td></tr>
        <tr><td style="padding:6px 8px;color:#8A929D;">On this invoice</td><td style="padding:6px 8px;text-align:right;color:#DC2626;font-weight:700;">A/C ${mask(o.newAccount)} · ${o.newIfsc ?? "—"}${o.bankName ? ` · ${o.bankName}` : ""}</td></tr>
      </table>
      <a href="${base}/dashboard/invoices/${o.invoiceId}" style="display:inline-block;background:#0B2239;color:#fff;font-weight:600;font-size:14px;padding:11px 24px;border-radius:8px;text-decoration:none;">Review invoice</a>
    </div>
  </div>`;
}
