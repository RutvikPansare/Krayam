import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeSpend } from "@/lib/spend";
import { generateSpendReportPdf } from "@/lib/spend-report";

export const dynamic = "force-dynamic";

const COMPANY_NAME = process.env.COMPANY_NAME || "Krayam Manufacturing";

/** Phase 2 Feature 05 — download the board-ready spend report PDF. */
export async function GET(req: Request) {
  const supa = await createClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const months = Math.min(24, Math.max(1, Number(new URL(req.url).searchParams.get("months") ?? "6")));
  const data = await computeSpend(months);
  const pdf = await generateSpendReportPdf(data, {
    companyName: COMPANY_NAME,
    periodLabel: `Last ${months} months · to ${new Date().toISOString().slice(0, 10)}`,
  });

  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="krayam-spend-report.pdf"`,
    },
  });
}
