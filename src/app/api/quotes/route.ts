import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyToken } from "@/lib/tokens";
import { sendEmail } from "@/lib/email";
import { notifyRoles } from "@/lib/notify";
import { logAudit } from "@/lib/approvals";
import { toPaise } from "@/lib/money";
import { convertPrice, UnknownConversionError, type UnitDef } from "@/lib/unit-convert";

export const dynamic = "force-dynamic";

import { getCompany } from "@/lib/company";

const round2 = (n: number) => Math.round(n * 100) / 100;

function rfqIsClosed(rfq: { status: string; due_at?: string | null }): boolean {
  if (rfq.status === "closed") return true;
  if (rfq.due_at && new Date(rfq.due_at) < new Date()) return true;
  return false;
}

/** GET ?token= — vendor quote form context (Feature 05). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.kind !== "quote") {
    return NextResponse.json({ error: "This quote link is invalid or has expired." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: rv } = await supabase
    .from("rfq_vendors")
    .select("id, vendor_id, vendors(name), rfqs(id, org_id, rfq_number, due_date, due_at, status, pr_id)")
    .eq("id", payload.id)
    .single();
  if (!rv) return NextResponse.json({ error: "RFQ invitation not found." }, { status: 404 });

  const rfq = (rv as any).rfqs;
  const [{ data: items }, { data: existing }] = await Promise.all([
    supabase.from("pr_items").select("id, item_name, quantity, unit, notes").eq("pr_id", rfq.pr_id).order("created_at"),
    supabase
      .from("quotes")
      .select("id, delivery_days, payment_terms, delivery_terms, validity_days, notes, submitted_at, quote_items(pr_item_id, price, quote_unit, available, available_qty)")
      .eq("rfq_id", rfq.id)
      .eq("vendor_id", (rv as any).vendor_id)
      .maybeSingle(),
  ]);

  return NextResponse.json({
    rfq_number: rfq.rfq_number,
    due_date: rfq.due_date,
    rfq_closed: rfqIsClosed(rfq),
    vendor_name: (rv as any).vendors?.name ?? "Vendor",
    company_name: (await getCompany(rfq.org_id)).company_name,
    already_submitted: !!existing,
    previous_quote: existing ?? null,
    items: items ?? [],
  });
}

interface QuoteLineInput {
  pr_item_id: string;
  price: number;
  quote_unit?: string;
  available_qty?: number | null;
  pack_size?: number | null;
}

function validateQuoteInput(body: any): string | null {
  const items: QuoteLineInput[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return "Quote at least one item.";
  for (const it of items) {
    const p = Number(it.price);
    if (!Number.isFinite(p) || p <= 0) return "Every quoted price must be a positive number.";
    if (p > 100_000_000) return "A price looks unrealistically large — check for typos.";
    if (it.available_qty != null) {
      const q = Number(it.available_qty);
      if (!Number.isFinite(q) || q < 0) return "Available quantity must be 0 or more.";
    }
  }
  if (body.delivery_days != null) {
    const d = Number(body.delivery_days);
    if (!Number.isInteger(d) || d < 0 || d > 365) return "Lead time must be between 0 and 365 days.";
  }
  if (body.validity_days != null) {
    const v = Number(body.validity_days);
    if (!Number.isInteger(v) || v < 1 || v > 365) return "Quote validity must be between 1 and 365 days.";
  }
  return null;
}

/**
 * POST — submit a quote.
 * Two paths:
 *   { token, ... }              — vendor portal submission (Feature 05)
 *   { rfq_id, vendor_name, source: "manual", ... } — manual entry from dashboard
 * Vendor resubmission with the same token UPDATES the existing quote
 * (idempotent) — the comparison table always shows one row per vendor.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body." }, { status: 400 });

  const supabase = createAdminClient();
  let rfqId: string;
  let vendorId: string | null = null;
  let vendorName: string;
  let source: "portal" | "manual";
  let submittedBy: string | null = null; // officer email for manual; vendor for portal

  const method = body.method ?? (body.token ? "portal" : body.source === "manual" ? "manual" : null);

  if (method === "portal" && body.token) {
    const payload = verifyToken(body.token);
    if (!payload || payload.kind !== "quote") {
      return NextResponse.json({ error: "This quote link is invalid or has expired." }, { status: 401 });
    }
    const { data: rv } = await supabase
      .from("rfq_vendors")
      .select("rfq_id, vendor_id, vendors(name), rfqs(status, due_at)")
      .eq("id", payload.id)
      .single();
    if (!rv) return NextResponse.json({ error: "RFQ invitation not found." }, { status: 404 });
    if (rfqIsClosed((rv as any).rfqs)) {
      return NextResponse.json({ error: "This RFQ has closed — quotes are no longer being accepted." }, { status: 410 });
    }
    rfqId = (rv as any).rfq_id;
    vendorId = (rv as any).vendor_id;
    vendorName = (rv as any).vendors?.name ?? "Vendor";
    submittedBy = vendorName; // the vendor themselves
    source = "portal";
  } else if (method === "manual" && body.rfq_id && body.vendor_name) {
    // Manual entry MUST be an authenticated purchase officer — both for access
    // control and so the audit trail records who keyed the phone quote.
    const authed = await createClient();
    const { data: { user } } = await authed.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in to enter a manual quote." }, { status: 401 });
    rfqId = body.rfq_id;
    vendorId = body.vendor_id ?? null;
    vendorName = body.vendor_name;
    submittedBy = user.email ?? user.id;
    source = "manual";
  } else {
    return NextResponse.json({ error: "Missing token or manual entry fields." }, { status: 400 });
  }

  const validationError = validateQuoteInput(body);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
  const items: QuoteLineInput[] = body.items;

  const quoteFields = {
    delivery_days: body.delivery_days ?? null,
    payment_terms: body.payment_terms ?? null,
    delivery_terms: body.delivery_terms ?? null,
    validity_days: body.validity_days ?? null,
    notes: body.notes ?? null,
  };

  // Resolve the org + the RFQ's locked base units (pr_item.unit) + the
  // conversion table — every row written below is tagged with the org.
  const { data: rfqOrg } = await supabase.from("rfqs").select("org_id, pr_id").eq("id", rfqId).single();
  const orgId = rfqOrg?.org_id ?? null;
  const { data: prItems } = await supabase
    .from("pr_items").select("id, unit").eq("pr_id", rfqOrg?.pr_id);
  const baseUnitOf = new Map<string, string>((prItems ?? []).map((p: any) => [p.id, p.unit || "piece"]));
  const { data: convRows } = await supabase
    .from("unit_conversions").select("unit, dimension, to_base, ambiguous");
  const defs = (convRows ?? []) as UnitDef[];

  // Idempotent portal resubmission: update the existing quote in place.
  // Manual entry over an existing quote requires explicit confirmation.
  const { data: existing } = vendorId
    ? await supabase.from("quotes").select("id, source").eq("rfq_id", rfqId).eq("vendor_id", vendorId).maybeSingle()
    : { data: null };
  if (existing && source === "manual" && !body.confirm_overwrite) {
    return NextResponse.json(
      { error: "A quote already exists for this vendor. Confirm to overwrite it.", needs_confirm: true },
      { status: 409 },
    );
  }

  // ── Normalize each line to its RFQ base unit, server-side, in paise.
  //    Raw and normalized are both stored (non-destructive). Unknown unit
  //    pairs throw and abort — never store a wrong conversion. ──
  let lineRows;
  try {
    lineRows = items.map((it) => {
      const rawUnit = it.quote_unit || "piece";
      const baseUnit = baseUnitOf.get(it.pr_item_id) || "piece";
      const rawPaise = toPaise(Number(it.price));
      const sizes = it.pack_size != null ? { [rawUnit]: Number(it.pack_size) } : {};
      const conv = convertPrice(rawPaise, rawUnit, baseUnit, defs, sizes); // throws UnknownConversionError
      return {
        org_id: orgId,
        quote_id: "", // filled after quote upsert
        pr_item_id: it.pr_item_id,
        price: round2(Number(it.price)),                 // legacy rupee mirror (raw)
        quote_unit: rawUnit,
        raw_price_paise: rawPaise,
        raw_unit: rawUnit,
        normalized_price_paise: conv.normalizedPaise,
        normalized_unit: baseUnit,
        conversion_factor: conv.factor,
        needs_clarification: conv.needsClarification,
        available_qty: it.available_qty != null ? Number(it.available_qty) : null,
        available: true,
      };
    });
  } catch (err) {
    if (err instanceof UnknownConversionError) {
      return NextResponse.json({ error: err.message, conversion_error: true }, { status: 400 });
    }
    throw err;
  }

  let quoteId: string;
  let resubmitted = false;
  if (existing) {
    const { error } = await supabase
      .from("quotes")
      .update({ ...quoteFields, source, submitted_by: submittedBy, submitted_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await supabase.from("quote_items").delete().eq("quote_id", existing.id);
    quoteId = existing.id;
    resubmitted = true;
  } else {
    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({ org_id: orgId, rfq_id: rfqId, vendor_id: vendorId, vendor_name: vendorName, source, submitted_by: submittedBy, ...quoteFields })
      .select()
      .single();
    if (qErr || !quote) {
      return NextResponse.json({ error: qErr?.message ?? "Could not save quote" }, { status: 500 });
    }
    quoteId = quote.id;
  }

  const { error: qiErr } = await supabase
    .from("quote_items")
    .insert(lineRows.map((r) => ({ ...r, quote_id: quoteId })));
  if (qiErr) return NextResponse.json({ error: qiErr.message }, { status: 500 });

  // Audit trail — every quote, regardless of method: who, how, when.
  if (orgId) {
    await logAudit(supabase, {
      entity_type: "quote",
      entity_id: quoteId,
      action: resubmitted ? "quote_resubmitted" : "quote_submitted",
      actor: submittedBy,
      org_id: orgId,
      detail: { method: source, vendor: vendorName, rfq_id: rfqId, lines: lineRows.length },
    });
  }

  // Track the vendor's response + log it
  if (vendorId) {
    await supabase
      .from("rfq_vendors")
      .update({ status: "quote_received" })
      .eq("rfq_id", rfqId)
      .eq("vendor_id", vendorId);
  }
  const { data: rfqRow } = await supabase
    .from("rfqs")
    .select("pr_id, rfq_number, status")
    .eq("id", rfqId)
    .single();
  await supabase.from("rfq_log").insert({
    org_id: orgId,
    rfq_id: rfqId,
    vendor_id: vendorId,
    event: "quote_received",
    detail: { vendor_name: vendorName, source, resubmitted },
  });

  const { count: quoteCount } = await supabase
    .from("quotes")
    .select("id", { count: "exact", head: true })
    .eq("rfq_id", rfqId);

  // First quote: tell the purchase officer quotes are arriving.
  // Third quote (or the 48h cron, whichever first): RFQ flips to quotes_in.
  const officerEmail = process.env.PURCHASE_OFFICER_EMAIL;
  if (quoteCount === 1 && !resubmitted && officerEmail && rfqRow) {
    await sendEmail({
      to: officerEmail,
      subject: `[Krayam] First quote in for ${rfqRow.rfq_number} — ${vendorName}`,
      html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h2 style="color:#0B2239;margin:0 0 8px;">Quotes are arriving</h2>
        <p style="color:#5B6470;font-size:14px;"><b style="color:#14181D;">${vendorName}</b> just submitted the first quote for ${rfqRow.rfq_number}. The comparison table updates live in the dashboard.</p>
      </div>`,
    });
  }
  if ((quoteCount ?? 0) >= 3 && rfqRow && rfqRow.status !== "quotes_in") {
    await supabase.from("rfqs").update({ status: "quotes_in" }).eq("id", rfqId);
    await supabase.from("purchase_requests").update({ status: "quotes_in" }).eq("id", rfqRow.pr_id);
  }

  if (rfqRow && !resubmitted && orgId) {
    await notifyRoles({
      orgId,
      type: "quote_received",
      title: `Quote received — ${rfqRow.rfq_number}`,
      body: `${vendorName} submitted a quote${source === "manual" ? " (entered manually)" : ""}. ${quoteCount ?? 1} quote${(quoteCount ?? 1) === 1 ? "" : "s"} in so far.`,
      link: `/dashboard/rfqs/${rfqId}`,
    });
  }

  return NextResponse.json({ ok: true, quote_id: quoteId, resubmitted });
}
