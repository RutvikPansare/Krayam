import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createToken } from "@/lib/tokens";
import { sendEmail, approvalEmailHtml } from "@/lib/email";
import { prFormSchema } from "@/lib/pr-schema";
import { estimatePrValue, resolveApprover, logAudit } from "@/lib/approvals";
import { notifyRoles } from "@/lib/notify";
import { ATTACH_BUCKET, MAX_ATTACH_PER_PR, prPathFromStaging } from "@/lib/attachments";

export const dynamic = "force-dynamic";

/**
 * Feature 01 + 02: create a purchase request from the mobile PWA form,
 * then email the approver a one-click approve/reject link.
 * Validation mirrors the client: same Zod schema, so nothing relies on
 * the browser behaving.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.json().catch(() => null);
    const parsed = prFormSchema.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json({ error: first?.message ?? "Invalid request." }, { status: 400 });
    }
    const {
      requester_name, requester_email, department, plant, cost_center,
      priority, needed_by, justification, approver_email, items,
    } = parsed.data;

    const supabase = createAdminClient();

    // Approval routing: estimate the PR value from material master prices,
    // then pick the approver from approval_rules. The form's approver email
    // is only the fallback when no rule matches.
    const estimatedValue = await estimatePrValue(supabase, items);
    const approver = await resolveApprover(supabase, {
      costCenter: cost_center,
      estimatedValue,
      fallbackEmail: approver_email,
    });

    const { data: pr, error: prError } = await supabase
      .from("purchase_requests")
      .insert({
        requester_name,
        requester_email,
        department: department || null,
        plant: plant || null,
        cost_center,
        priority: priority || "normal",
        needed_by: needed_by || null,
        justification: justification || null,
        approver_email: approver.email,
        estimated_value: estimatedValue,
      })
      .select()
      .single();

    if (prError || !pr) {
      return NextResponse.json({ error: prError?.message ?? "Could not create request" }, { status: 500 });
    }

    const { error: itemsError } = await supabase.from("pr_items").insert(
      items.map((it: any) => ({
        pr_id: pr.id,
        item_name: it.item_name,
        material_code: it.material_code || null,
        quantity: Number(it.quantity),
        unit: it.unit || "piece",
        notes: it.notes || null,
      }))
    );
    if (itemsError) {
      return NextResponse.json({ error: itemsError.message }, { status: 500 });
    }

    // Feature 11 — link staged spec sheets to this PR. Only verified, this-org,
    // not-yet-linked rows; capped at the max; each file is MOVED from the
    // staging folder into <org>/<pr_id>/ so the storage path carries both the
    // customer (org) and PR prefixes (isolation at the storage layer).
    const attachmentIds = (parsed.data.attachment_ids ?? []).slice(0, MAX_ATTACH_PER_PR);
    if (attachmentIds.length > 0) {
      const { data: staged } = await supabase
        .from("pr_attachments")
        .select("id, storage_path")
        .in("id", attachmentIds)
        .eq("org_id", pr.org_id)
        .eq("checksum_verified", true)
        .is("pr_id", null)
        .is("deleted_at", null);
      for (const a of staged ?? []) {
        const dest = prPathFromStaging(a.storage_path, pr.id);
        const { error: moveErr } = await supabase.storage.from(ATTACH_BUCKET).move(a.storage_path, dest);
        await supabase
          .from("pr_attachments")
          .update({ pr_id: pr.id, ...(moveErr ? {} : { storage_path: dest }) })
          .eq("id", a.id);
      }
    }

    // Feature 02 — one-click approval email. Token carries the approver's
    // email (identity for the audit trail) and expires in 48h by default.
    const ttlHours = Number(process.env.APPROVAL_TOKEN_TTL_HOURS || "48");
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const token = createToken({ kind: "approval", id: pr.id, email: approver.email }, ttlHours / 24);
    const approveUrl = `${origin}/approve/${token}?action=approve`;
    const rejectUrl  = `${origin}/approve/${token}?action=reject`;

    await logAudit(supabase, {
      entity_type: "purchase_request",
      entity_id: pr.id,
      action: "submitted",
      actor: requester_email,
      org_id: pr.org_id,
      detail: {
        estimated_value: estimatedValue,
        routed_to: approver.email,
        routing_source: approver.source,
        rule_id: approver.rule_id,
      },
    });

    await sendEmail({
      to: approver.email,
      subject: `[Krayam] Approval needed — ${pr.pr_number} from ${requester_name}`,
      html: approvalEmailHtml({
        prNumber: pr.pr_number,
        requesterName: requester_name,
        department: department || null,
        priority: priority || "normal",
        justification: justification || null,
        estimatedValue,
        items,
        approveUrl,
        rejectUrl,
        validHours: ttlHours,
      }),
    });

    // Role-routed in-app notification (purchase team + IT admin)
    await notifyRoles({
      orgId: pr.org_id,
      type: "pr_created",
      title: `New purchase request ${pr.pr_number}`,
      body: `${requester_name}${department ? ` (${department})` : ""} raised ${items.length} item${items.length === 1 ? "" : "s"}${priority === "urgent" ? " — URGENT" : ""}.`,
      link: `/dashboard/requests/${pr.id}`,
    });

    return NextResponse.json({ ok: true, pr_number: pr.pr_number, id: pr.id });
  } catch (err) {
    console.error("PR create error:", err);
    // Internal details (config, stack) stay in server logs; the shop-floor
    // user gets something they can act on.
    return NextResponse.json(
      { error: "The server could not save your request. Please try again in a minute." },
      { status: 500 }
    );
  }
}
