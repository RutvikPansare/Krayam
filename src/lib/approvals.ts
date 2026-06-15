import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Approval routing + audit trail helpers.
 *
 * Routing: estimate the PR's value from material master prices, then pick
 * the approver from approval_rules (most specific cost center match, then
 * highest min_amount at or below the estimate). The form's approver field
 * is the fallback for plants that haven't configured rules yet.
 */

export interface ResolvedApprover {
  email: string;
  name: string | null;
  source: "rule" | "form";
  rule_id: string | null;
}

export interface PRItemForEstimate {
  material_code?: string | null;
  quantity: number;
}

/** Sum of unit_price × qty for items with a known material code. Items
 *  without a code contribute 0 — the estimate is a routing signal, not
 *  an exact valuation, and it is stored so the audit shows what was used. */
export async function estimatePrValue(
  supabase: SupabaseClient,
  items: PRItemForEstimate[]
): Promise<number> {
  const codes = items.map((i) => i.material_code).filter((c): c is string => !!c);
  if (codes.length === 0) return 0;
  const { data: mats } = await supabase
    .from("materials")
    .select("material_code, unit_price")
    .in("material_code", codes);
  const priceOf: Record<string, number> = {};
  for (const m of mats ?? []) priceOf[m.material_code] = Number(m.unit_price);
  return items.reduce((sum, it) => {
    const p = it.material_code ? priceOf[it.material_code] : undefined;
    return sum + (p != null ? p * Number(it.quantity) : 0);
  }, 0);
}

export async function resolveApprover(
  supabase: SupabaseClient,
  opts: { costCenter: string | null; estimatedValue: number; fallbackEmail: string }
): Promise<ResolvedApprover> {
  const { data: rules } = await supabase
    .from("approval_rules")
    .select("id, cost_center, min_amount, approver_email, approver_name")
    .eq("active", true)
    .lte("min_amount", opts.estimatedValue);

  // exact cost-center rules beat wildcards; within a tier, highest threshold wins
  const candidates = (rules ?? []).sort((a, b) => {
    const aSpecific = a.cost_center === opts.costCenter ? 1 : 0;
    const bSpecific = b.cost_center === opts.costCenter ? 1 : 0;
    if (aSpecific !== bSpecific) return bSpecific - aSpecific;
    return Number(b.min_amount) - Number(a.min_amount);
  });
  const match = candidates.find((r) => r.cost_center === null || r.cost_center === opts.costCenter);

  if (match) {
    return { email: match.approver_email, name: match.approver_name, source: "rule", rule_id: match.id };
  }
  return { email: opts.fallbackEmail, name: null, source: "form", rule_id: null };
}

/** Append-only audit entry. Never throws — an audit hiccup must not block
 *  the business action; the failure itself is logged server-side. */
export async function logAudit(
  supabase: SupabaseClient,
  entry: {
    entity_type: string;
    entity_id: string;
    action: string;
    actor?: string | null;
    org_id?: string | null;     // stamp the tenant so org-scoped audit reads find it
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    entity_type: entry.entity_type,
    entity_id: entry.entity_id,
    action: entry.action,
    actor: entry.actor ?? null,
    ...(entry.org_id ? { org_id: entry.org_id } : {}), // else DB default → install org
    detail: entry.detail ?? null,
  });
  if (error) console.error("audit_log insert failed:", error.message, entry);
}
