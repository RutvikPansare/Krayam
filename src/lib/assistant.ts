import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolDefinition } from "@/lib/llm";
import { UNIT_OPTIONS } from "@/lib/units";

/**
 * Conversational procurement assistant — system prompt, tools, executors.
 *
 * The engineer describes what they need in plain language (English, Hindi,
 * or Hinglish). The model matches items against the material master via the
 * search tool, collects the required PR fields conversationally, and submits
 * through the same /api/pr pipeline as the form — so validation, approval
 * routing, audit and emails are identical.
 */

export function buildSystemPrompt(costCenters: { code: string; name: string }[]): string {
  const units = UNIT_OPTIONS.map((u) => `${u.value} (${u.label})`).join(", ");
  const ccList = costCenters.map((c) => `${c.code} = ${c.name}`).join("; ") || "none configured — ask the user for a code";
  return `You are Krayam's procurement assistant for an Indian manufacturing plant. Factory floor engineers talk to you to raise purchase requests without knowing any SAP terminology or material codes.

LANGUAGE: Reply in the language the user writes in. Hinglish (mixed Hindi and English) is common — respond naturally in kind. Keep replies short and practical, like a helpful colleague on WhatsApp.

YOUR JOB:
1. Understand what parts/materials they need (they use abbreviations, brand names, nicknames, misspellings).
2. For EVERY item, call search_materials to find existing material codes. Prefer matching an existing code over free text — duplicates cost the company crores. If a match has stock, tell the user how much is available and where.
3. Collect what a PR needs, conversationally and only what is missing:
   - items (name, quantity, unit)
   - requester name and email
   - cost center (one of: ${ccList})
   - priority (low/normal/high/urgent) — infer from context (machine down = urgent), confirm only if unclear
   - optional: needed-by date, justification (why they need it), department, plant
4. Ask clarifying questions ONLY when genuinely ambiguous (e.g. bearing size missing, quantity unclear). Never interrogate — one short question at a time, and make sensible assumptions for the rest.
5. Before submitting, show a one-line summary of what you'll order and confirm.
6. On confirmation, call submit_purchase_request. Then tell them the PR number and that their approver has been emailed.

UNITS: use one of: ${units}.

RULES:
- Never invent material codes. Only use codes returned by search_materials, or leave material_code empty.
- Quantities must be positive numbers. If the user says "a few", ask how many.
- If search returns a match with enough stock to cover the need, say so prominently — they may not need to order at all. Still raise the PR if they insist.
- Approver is chosen automatically by company rules — do not ask who should approve. If asked, say it routes by cost center and value.
- Do not discuss anything unrelated to procurement. Politely steer back.`;
}

export const ASSISTANT_TOOLS: ToolDefinition[] = [
  {
    name: "search_materials",
    description:
      "Fuzzy-search the company's material master (mirrors SAP). Call this for every item the user mentions, with the best English description you can form (e.g. 'bearing 6205', 'v belt b68'). Handles misspellings and partial text. Returns material codes, descriptions, units, prices and live stock per warehouse.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Item description to search, in English, e.g. 'ball bearing 6205'" },
      },
      required: ["query"],
    },
  },
  {
    name: "submit_purchase_request",
    description:
      "Submit the purchase request once all required information is collected AND the user has confirmed the summary. Creates the PR, routes it to the right approver automatically, and emails everyone involved.",
    inputSchema: {
      type: "object",
      properties: {
        requester_name: { type: "string" },
        requester_email: { type: "string", description: "Valid email address" },
        cost_center: { type: "string", description: "Cost center code, e.g. CC-1010" },
        department: { type: "string" },
        plant: { type: "string" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        needed_by: { type: "string", description: "YYYY-MM-DD, optional" },
        justification: { type: "string", description: "Why this is needed, optional but helpful for approval" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_name: { type: "string" },
              material_code: { type: "string", description: "Only a code returned by search_materials; omit if no match" },
              quantity: { type: "number" },
              unit: { type: "string" },
              notes: { type: "string" },
            },
            required: ["item_name", "quantity", "unit"],
          },
        },
      },
      required: ["requester_name", "requester_email", "cost_center", "priority", "items"],
    },
  },
];

export async function executeAssistantTool(
  supabase: SupabaseClient,
  origin: string,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === "search_materials") {
    const q = String(args.query ?? "").trim();
    if (q.length < 2) return { results: [], note: "query too short" };
    const { data, error } = await supabase.rpc("search_materials", { q, max_results: 6 });
    if (error) return { results: [], error: error.message };
    return {
      results: (data ?? []).map((m: any) => ({
        material_code: m.material_code,
        description: m.description,
        unit: m.unit,
        unit_price_inr: Number(m.unit_price),
        stock: m.stock,
        total_stock: Object.values((m.stock ?? {}) as Record<string, number>).reduce((s, v) => s + Number(v), 0),
      })),
    };
  }

  if (name === "submit_purchase_request") {
    // Same pipeline as the form: zod validation, approval routing, audit,
    // emails — one code path for both entry points.
    const fallbackApprover = process.env.DEFAULT_APPROVER_EMAIL || String(args.requester_email ?? "");
    const res = await fetch(`${origin}/api/pr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requester_name: args.requester_name,
        requester_email: args.requester_email,
        department: args.department ?? "",
        plant: args.plant ?? "",
        cost_center: args.cost_center,
        priority: args.priority ?? "normal",
        needed_by: args.needed_by ?? "",
        justification: args.justification ?? "",
        approver_email: fallbackApprover,
        items: args.items,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: body?.error ?? "Submission failed" };
    return { ok: true, pr_number: body.pr_number, pr_id: body.id };
  }

  return { error: `Unknown tool: ${name}` };
}
