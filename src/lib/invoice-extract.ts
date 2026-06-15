/**
 * Feature 12 — invoice data extraction (OCR).
 *
 * Vendor invoices in India are a mess of Tally/Busy/Zoho layouts, scanned
 * paper, regional fonts and ₹ formatting. Open-source OCR (Tesseract) is not
 * reliable enough on these, so extraction goes through a vision LLM:
 *   - default: Claude vision (Anthropic SDK), strong on PDFs + scans
 *   - alternative: Google Document AI, selected via INVOICE_OCR=docai
 * Both read the document natively (PDF document block / image block) — there is
 * no Tesseract / open-source OCR step anywhere in this path.
 *
 * Contract: extraction returns a discriminated ExtractionResult — never a bare
 * null. A failure carries a machine-readable reason + message so the pipeline
 * records WHY (invoices.extraction_error) and the buyer is told, rather than a
 * silently empty invoice slipping into matching.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  ExtractedInvoice,
  ExtractionResult,
  ExtractionErrorReason,
} from "@/types/invoice";

type MediaKind = "pdf" | "image";

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/webp": "webp",
};

function classifyMedia(mime: string): { kind: MediaKind; mediaType: string } | null {
  if (mime === "application/pdf") return { kind: "pdf", mediaType: "application/pdf" };
  if (mime in IMAGE_TYPES) return { kind: "image", mediaType: mime === "image/jpg" ? "image/jpeg" : mime };
  return null;
}

const fail = (reason: ExtractionErrorReason, message: string, raw?: unknown): ExtractionResult => ({
  ok: false,
  reason,
  message,
  raw,
});

/* ── Extraction prompt + output schema ── */

const SYSTEM_PROMPT = `You are an expert at reading Indian GST tax invoices (Tally, Busy, Zoho, Marg, and handwritten/scanned formats).
Extract the fields exactly as printed. Do not infer, calculate, or invent values that are not visible.
Rules:
- Amounts are numbers in rupees (e.g. 12500.50), no currency symbol, no thousands separators.
- A GSTIN is 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 alphanumeric, 'Z', 1 alphanumeric.
- invoice_date as ISO YYYY-MM-DD. Indian invoices usually print DD/MM/YYYY — interpret accordingly.
- Bank details are the VENDOR's account printed on the invoice (account number, IFSC, bank name). null if absent.
- subtotal is the taxable value (before GST); tax_amount is total GST (CGST+SGST+IGST); total_amount is the grand total.
- Use null for any field you cannot read. Never guess.
Call the emit_invoice tool exactly once with the result.`;

const EMIT_TOOL: Anthropic.Tool = {
  name: "emit_invoice",
  description: "Return the structured invoice extracted from the document.",
  input_schema: {
    type: "object",
    properties: {
      invoice_number: { type: ["string", "null"] },
      invoice_date: { type: ["string", "null"], description: "ISO YYYY-MM-DD" },
      vendor_name: { type: ["string", "null"] },
      gstin: { type: ["string", "null"] },
      subtotal: { type: ["number", "null"], description: "taxable value, rupees" },
      tax_amount: { type: ["number", "null"], description: "total GST, rupees" },
      total_amount: { type: ["number", "null"], description: "grand total, rupees" },
      bank: {
        type: "object",
        properties: {
          account_number: { type: ["string", "null"] },
          ifsc: { type: ["string", "null"] },
          bank_name: { type: ["string", "null"] },
        },
        required: ["account_number", "ifsc", "bank_name"],
      },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            description: { type: "string" },
            quantity: { type: ["number", "null"] },
            unit_price: { type: ["number", "null"], description: "rupees per unit" },
            line_total: { type: ["number", "null"], description: "rupees" },
          },
          required: ["description", "quantity", "unit_price", "line_total"],
        },
      },
    },
    required: ["invoice_number", "invoice_date", "vendor_name", "gstin", "total_amount", "bank", "items"],
  } as Anthropic.Tool.InputSchema,
};

const toNumOrNull = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const toStrOrNull = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
};

/** Coerce the model's tool input into our typed ExtractedInvoice. */
function coerce(input: Record<string, unknown>): ExtractedInvoice {
  const bankRaw = (input.bank ?? {}) as Record<string, unknown>;
  const itemsRaw = Array.isArray(input.items) ? input.items : [];
  return {
    invoice_number: toStrOrNull(input.invoice_number),
    invoice_date: toStrOrNull(input.invoice_date),
    vendor_name: toStrOrNull(input.vendor_name),
    gstin: toStrOrNull(input.gstin)?.toUpperCase() ?? null,
    subtotal: toNumOrNull(input.subtotal),
    tax_amount: toNumOrNull(input.tax_amount),
    total_amount: toNumOrNull(input.total_amount),
    bank: {
      account_number: toStrOrNull(bankRaw.account_number)?.replace(/\s+/g, "") ?? null,
      ifsc: toStrOrNull(bankRaw.ifsc)?.toUpperCase().replace(/\s+/g, "") ?? null,
      bank_name: toStrOrNull(bankRaw.bank_name),
    },
    items: (itemsRaw as Record<string, unknown>[])
      .map((it) => ({
        description: toStrOrNull(it.description) ?? "",
        quantity: toNumOrNull(it.quantity),
        unit_price: toNumOrNull(it.unit_price),
        line_total: toNumOrNull(it.line_total),
      }))
      .filter((it) => it.description.length > 0),
  };
}

/**
 * Extract an invoice from a file buffer + its MIME type.
 * @param buffer raw file bytes
 * @param mime   content-type ("application/pdf", "image/png", "image/jpeg")
 */
export async function extractInvoice(buffer: Buffer, mime: string): Promise<ExtractionResult> {
  if (!buffer || buffer.length === 0) {
    return fail("empty_document", "The uploaded file is empty.");
  }
  const media = classifyMedia(mime);
  if (!media) {
    return fail("unsupported_media", `Unsupported file type "${mime}". Upload a PDF, PNG or JPEG invoice.`);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return fail("no_api_key", "Invoice OCR is not configured (ANTHROPIC_API_KEY missing). Contact your administrator.");
  }

  const model = process.env.INVOICE_OCR_MODEL || "claude-opus-4-8";
  const base64 = buffer.toString("base64");
  const docBlock: Anthropic.ContentBlockParam =
    media.kind === "pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
      : { type: "image", source: { type: "base64", media_type: media.mediaType as any, data: base64 } };

  let response: Anthropic.Message;
  try {
    const client = new Anthropic();
    response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools: [EMIT_TOOL],
      tool_choice: { type: "tool", name: "emit_invoice" },
      messages: [
        {
          role: "user",
          content: [docBlock, { type: "text", text: "Extract this invoice. Call emit_invoice once." }],
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : err instanceof Error ? err.message : "Unknown OCR error";
    return fail("api_error", `Invoice OCR request failed: ${message}`, err instanceof Anthropic.APIError ? err.error : undefined);
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "emit_invoice",
  );
  if (!toolUse) {
    return fail("unparseable_response", "OCR model did not return structured invoice data.", response);
  }

  try {
    const data = coerce(toolUse.input as Record<string, unknown>);
    return { ok: true, data, provider: "claude", model, raw: toolUse.input };
  } catch (err) {
    return fail("unparseable_response", `Could not parse OCR output: ${err instanceof Error ? err.message : "shape error"}`, toolUse.input);
  }
}
