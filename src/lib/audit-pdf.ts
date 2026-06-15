import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuditReportData } from "@/lib/audit-data";
import { buildAuditReportHtml } from "@/lib/audit-report-html";
import { generateAuditPdf as pdfLibFallback } from "@/lib/audit-report-pdf";

/**
 * Feature 08 — render the branded audit report to PDF.
 *
 * Primary: Puppeteer prints the React report page (audit-report-html). If a
 * headless browser can't launch (serverless without Chromium), it falls back
 * to the pdf-lib renderer so a report is always produced. Both consume the
 * same org-scoped, decrypted data.
 */
export async function renderAuditPdf(
  admin: SupabaseClient,
  runId: string,
  orgId: string,
  companyName: string,
): Promise<Uint8Array> {
  const data = await getAuditReportData(admin, runId, orgId);
  if (!data) throw new Error("Audit run not found");
  const { run, clusters } = data;

  try {
    const html = await buildAuditReportHtml(run, clusters, companyName);
    // Dynamic import so puppeteer is only loaded when actually rendering.
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "0", bottom: "0", left: "0", right: "0" } });
      return new Uint8Array(pdf);
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn("Puppeteer render failed; using pdf-lib fallback:", err instanceof Error ? err.message : err);
    return pdfLibFallback(run, clusters, companyName);
  }
}
