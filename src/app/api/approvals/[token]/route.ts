import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyToken, createToken } from "@/lib/tokens";
import { sendEmail, sendEmailBatch, rfqEmailHtml, statusEmailHtml } from "@/lib/email";
import { createSapPurchaseRequisition } from "@/lib/sap";
import { logAudit } from "@/lib/approvals";
import { selectVendors } from "@/lib/vendor-select";
import { notifyRoles } from "@/lib/notify";
import { ATTACH_BUCKET, SIGNED_URL_TTL_S } from "@/lib/attachments";

export const dynamic = "force-dynamic";

import { getCompany } from "@/lib/company";

/** GET — load the PR for the approval page. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const payload = verifyToken(params.token);
  if (!payload || payload.kind !== "approval") {
    return NextResponse.json({ error: "This approval link is invalid or has expired." }, { status: 401 });
  }
  const supabase = createAdminClient();
  const { data: pr } = await supabase
    .from("purchase_requests")
    .select("pr_number, requester_name, department, priority, justification, status, needed_by, pr_items(id, item_name, quantity, unit, notes)")
    .eq("id", payload.id)
    .single();
  if (!pr) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  return NextResponse.json({ pr });
}

/**
 * POST — approve or reject.
 * On approve, the rest of the cycle fires automatically:
 *   Feature 03: create the PR in SAP (mock or live per SAP_MODE)
 *   Feature 04: generate an RFQ + email blast all active vendors
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  try {
  const payload = verifyToken(params.token);
  if (!payload || payload.kind !== "approval") {
    return NextResponse.json({ error: "This approval link is invalid or has expired." }, { status: 401 });
  }

  const { action, note } = await req.json().catch(() => ({ action: null, note: null }));
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Action must be approve or reject." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data: pr, error: prReadErr } = await supabase
    .from("purchase_requests")
    .select("*, pr_items(*)")
    .eq("id", payload.id)
    .single();
  if (prReadErr || !pr) return NextResponse.json({ error: "Request not found." }, { status: 404 });

  // The approver identity for the audit trail: bound into the token when
  // the email was sent, falling back to the PR's routed approver.
  const actor = payload.email ?? pr.approver_email;

  // Atomic claim — the status filter makes this idempotent under races:
  // two concurrent clicks both reach here, but only one row update matches
  // status='pending_approval'. The loser gets no row back and a 409, so the
  // SAP push and RFQ blast can never double-fire.
  const newStatus = action === "reject" ? "rejected" : "approved";
  const { data: claimed, error: claimErr } = await supabase
    .from("purchase_requests")
    .update({ status: newStatus, approver_note: note, approved_at: new Date().toISOString() })
    .eq("id", pr.id)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();
  if (claimErr) return NextResponse.json({ error: "Could not update the request. Try again." }, { status: 500 });
  if (!claimed) {
    return NextResponse.json({ error: `This request was already ${pr.status.replace("_", " ")}.` }, { status: 409 });
  }

  await logAudit(supabase, {
    entity_type: "purchase_request",
    entity_id: pr.id,
    action: newStatus,
    actor,
    org_id: pr.org_id,
    detail: { note: note ?? null, pr_number: pr.pr_number },
  });

  if (action === "reject") {
    await sendEmail({
      to: pr.requester_email,
      subject: `[Krayam] ${pr.pr_number} rejected`,
      html: statusEmailHtml({ prNumber: pr.pr_number, status: "rejected", approverNote: note }),
    });
    await notifyRoles({
      orgId: pr.org_id,
      type: "pr_rejected",
      title: `${pr.pr_number} rejected`,
      body: `Rejected by ${actor}${note ? ` — "${note}"` : ""}.`,
      link: `/dashboard/requests/${pr.id}`,
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── Approve — status already claimed above; now run the workflow ──

  // Feature 03 — SAP PR creation (ME21N via OData)
  const sap = await createSapPurchaseRequisition({
    prNumber: pr.pr_number,
    items: pr.pr_items.map((it: any) => ({
      material: it.material_code || it.item_name,
      description: it.item_name,
      quantity: Number(it.quantity),
      unit: it.unit,
      deliveryDate: pr.needed_by ?? undefined,
    })),
  });
  await supabase
    .from("purchase_requests")
    .update({
      sap_pr_number: sap.sapPrNumber,
      sap_mode: sap.mode,
      sap_error: sap.error ?? null,
      ...(sap.success ? { status: "sap_created" } : {}),
    })
    .eq("id", pr.id);

  // Feature 04 — RFQ auto-generation + vendor email blast.
  // Vendors are selected by item category (from the material master);
  // 48h quote deadline; emails go out via Resend's batch API unless spec
  // sheets force individual sends (batch doesn't support attachments).
  const dueHours = Number(process.env.RFQ_DUE_HOURS || "48");
  const quoteTtlHours = Number(process.env.QUOTE_TOKEN_TTL_HOURS || "72");
  const officerEmail = process.env.PURCHASE_OFFICER_EMAIL || pr.requester_email;
  const dueAt = new Date(Date.now() + dueHours * 3600000);
  const dueDate = dueAt.toISOString().slice(0, 10);
  const dueLabel = dueAt.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) + " IST";

  const { data: rfq } = await supabase
    .from("rfqs")
    .insert({ org_id: pr.org_id, pr_id: pr.id, due_date: dueDate, due_at: dueAt.toISOString(), status: "sent" })
    .select()
    .single();

  let vendorsEmailed = 0;
  if (rfq) {
    // item categories via material master
    const codes = pr.pr_items.map((it: any) => it.material_code).filter(Boolean);
    let itemCategories: string[] = [];
    if (codes.length > 0) {
      const { data: mats } = await supabase.from("materials").select("category").eq("org_id", pr.org_id).in("material_code", codes);
      itemCategories = Array.from(new Set((mats ?? []).map((m) => m.category).filter(Boolean)));
    }

    const { data: allVendors } = await supabase.from("vendors").select("*").eq("org_id", pr.org_id);
    const selected = selectVendors(allVendors ?? [], itemCategories);

    if (selected.length === 0) {
      // Never fail silently: the officer must know no RFQ went out.
      await supabase.from("rfq_log").insert({
        org_id: pr.org_id, rfq_id: rfq.id, event: "no_vendors",
        detail: { categories: itemCategories, pr_number: pr.pr_number },
      });
      await sendEmail({
        to: officerEmail,
        subject: `[Krayam] ACTION NEEDED — no vendors found for ${rfq.rfq_number}`,
        html: statusEmailHtml({ prNumber: pr.pr_number, status: "approved" }).replace(
          "Your purchase request has been approved.",
          `${rfq.rfq_number} could not be sent: no active vendor covers ${itemCategories.length ? `categories "${itemCategories.join('", "')}"` : "these items"}. Add a vendor or send the RFQ manually from the dashboard.`
        ),
      });
    } else {
      const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

      const COMPANY_NAME = (await getCompany(pr.org_id)).company_name;
      // Feature 11 — spec sheets go out as 7-day SIGNED URL references (never
      // base64 inline, never public URLs). Verified + non-deleted only.
      const specAttachments: { file_name: string; size_bytes: number; url: string }[] = [];
      const { data: specs } = await supabase
        .from("pr_attachments")
        .select("file_name, storage_path, size_bytes")
        .eq("pr_id", pr.id)
        .eq("checksum_verified", true)
        .is("deleted_at", null);
      for (const s of specs ?? []) {
        const { data: signed } = await supabase.storage.from(ATTACH_BUCKET).createSignedUrl(s.storage_path, SIGNED_URL_TTL_S);
        if (signed?.signedUrl) specAttachments.push({ file_name: s.file_name, size_bytes: s.size_bytes, url: signed.signedUrl });
      }

      // invitation rows first, so every email has its token + tracking row
      const invites: { rv: any; vendor: any; html: string; subject: string }[] = [];
      for (const v of selected) {
        const { data: rv } = await supabase
          .from("rfq_vendors")
          .insert({ org_id: pr.org_id, rfq_id: rfq.id, vendor_id: v.id })
          .select()
          .single();
        if (!rv) continue;
        const quoteToken = createToken({ kind: "quote", id: rv.id, email: v.email }, quoteTtlHours / 24);
        invites.push({
          rv, vendor: v,
          subject: `[RFQ] ${rfq.rfq_number} — ${COMPANY_NAME} requests your quote by ${dueLabel}`,
          html: rfqEmailHtml({
            vendorName: v.name,
            rfqNumber: rfq.rfq_number,
            companyName: COMPANY_NAME,
            dueDate: dueLabel,
            items: pr.pr_items,
            quoteUrl: `${origin}/quote/${quoteToken}`,
            attachments: specAttachments,
          }),
        });
      }

      // URL-referenced attachments ⇒ always one batched Resend call.
      const results = await sendEmailBatch(invites.map((i) => ({ to: i.vendor.email, subject: i.subject, html: i.html })));

      const now = new Date().toISOString();
      for (let i = 0; i < invites.length; i++) {
        const inv = invites[i];
        const res = results[i];
        const ok = !res.error;
        if (ok) vendorsEmailed++;
        await supabase
          .from("rfq_vendors")
          .update(ok ? { email_sent_at: now, status: "sent" } : { status: "failed" })
          .eq("id", inv.rv.id);
        await supabase.from("rfq_log").insert({
          org_id: pr.org_id,
          rfq_id: rfq.id,
          rfq_vendor_id: inv.rv.id,
          vendor_id: inv.vendor.id,
          event: ok ? "sent" : "send_failed",
          provider_message_id: res.id,
          detail: res.error ? { error: res.error } : null,
        });
        if (!ok) console.error(`RFQ email to ${inv.vendor.email} failed:`, res.error);
      }
    }
    await supabase.from("purchase_requests").update({ status: "rfq_sent" }).eq("id", pr.id);
  }

  // Notify requester
  await sendEmail({
    to: pr.requester_email,
    subject: `[Krayam] ${pr.pr_number} approved ✓`,
    html: statusEmailHtml({
      prNumber: pr.pr_number,
      status: "approved",
      approverNote: note,
      sapPrNumber: sap.sapPrNumber,
    }),
  });

  await notifyRoles({
    orgId: pr.org_id,
    type: "pr_approved",
    title: `${pr.pr_number} approved`,
    body: `Approved by ${actor}.${sap.sapPrNumber ? ` SAP PR ${sap.sapPrNumber}.` : ""}${rfq ? ` ${rfq.rfq_number} sent to ${vendorsEmailed} vendor${vendorsEmailed === 1 ? "" : "s"}.` : ""}`,
    link: `/dashboard/requests/${pr.id}`,
  });

  await logAudit(supabase, {
    entity_type: "purchase_request",
    entity_id: pr.id,
    action: "workflow_completed",
    actor: "system",
    org_id: pr.org_id,
    detail: {
      sap_pr_number: sap.sapPrNumber,
      sap_mode: sap.mode,
      sap_error: sap.error ?? null,
      rfq_number: rfq?.rfq_number ?? null,
      vendors_emailed: vendorsEmailed,
    },
  });

  return NextResponse.json({
    ok: true,
    status: "approved",
    sap_pr_number: sap.sapPrNumber,
    sap_mode: sap.mode,
    rfq_number: rfq?.rfq_number ?? null,
    vendors_emailed: vendorsEmailed,
  });
  } catch (err) {
    console.error("Approval action error:", err);
    return NextResponse.json(
      { error: "Something went wrong processing this approval. Try the link again." },
      { status: 500 }
    );
  }
}
