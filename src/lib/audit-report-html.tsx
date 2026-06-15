import React from "react";
import { formatPaise } from "@/lib/money";
import type { DecryptedCluster } from "@/lib/audit-data";

/**
 * The branded audit report as a React page, rendered to static HTML for
 * Puppeteer to print to PDF. Krayam masthead + customer company name.
 */
function ReportDoc({ run, clusters, companyName }: { run: any; clusters: DecryptedCluster[]; companyName: string }) {
  const top = clusters.slice(0, 10);
  const card = (label: string, value: string, color: string) => (
    <div style={{ flex: 1, background: "#F4F5F2", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 8, letterSpacing: 1, color: "#8A929D", fontWeight: 700 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, marginTop: 4 }}>{value}</div>
    </div>
  );
  return (
    <html>
      <head><meta charSet="utf-8" /><style>{`*{margin:0;box-sizing:border-box;font-family:Helvetica,Arial,sans-serif}`}</style></head>
      <body style={{ color: "#14181D" }}>
        <div style={{ background: "#0B2239", color: "#fff", padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span style={{ fontSize: 22, fontWeight: 800 }}>Krayam<span style={{ color: "#F5A623" }}>.</span></span>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "#B3BAC2" }}>MATERIAL MASTER DUPLICATE AUDIT</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 700 }}>{companyName}</div>
            <div style={{ fontSize: 10, color: "#B3BAC2" }}>Report v{run.version} · {new Date(run.started_at).toLocaleDateString("en-IN")}</div>
          </div>
        </div>

        <div style={{ padding: 32 }}>
          <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
            {card("Materials analyzed", String(run.materials_analyzed), "#14181D")}
            {card("Confirmed duplicates", String(run.confirmed_count), "#DC2626")}
            {card("Probable duplicates", String(run.probable_count), "#B97A0A")}
            {card("Value in duplicate stock", formatPaise(run.duplicate_value_paise), "#0B2239")}
          </div>

          <div style={{ fontSize: 11, fontWeight: 800, color: "#0B2239", borderBottom: "2px solid #0B2239", paddingBottom: 6, marginBottom: 12 }}>
            TOP DUPLICATE FAMILIES BY VALUE
          </div>

          {top.map((c, i) => {
            const lc = c.label === "confirmed" ? "#DC2626" : c.label === "probable" ? "#B97A0A" : "#5B6470";
            return (
              <div key={i} style={{ marginBottom: 12, border: "1px solid #E6E8E4", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#FAFBF9" }}>
                  <div>
                    <span style={{ color: lc, fontWeight: 700, fontSize: 10, textTransform: "uppercase" }}>{c.label}</span>
                    <span style={{ color: "#5B6470", fontSize: 11, marginLeft: 8 }}>{c.member_count} codes · cohesion {(c.cohesion * 100).toFixed(0)}%</span>
                  </div>
                  <span style={{ fontWeight: 800, color: "#0B2239" }}>{formatPaise(c.duplicate_value_paise)}</span>
                </div>
                {c.members.map((m) => (
                  <div key={m.material_code} style={{ display: "flex", justifyContent: "space-between", padding: "5px 12px", fontSize: 11, borderTop: "1px solid #F0F1EE" }}>
                    <span style={{ color: m.is_primary ? "#0B2239" : "#14181D", fontWeight: m.is_primary ? 700 : 400 }}>
                      {m.is_primary ? "★ keep " : "  dup  "}<span style={{ fontFamily: "monospace" }}>{m.material_code}</span> · {m.description ?? "—"}
                    </span>
                    <span style={{ color: "#5B6470" }}>{m.stock_qty} {m.unit ?? ""} · {formatPaise(m.stock_value_paise)}</span>
                  </div>
                ))}
              </div>
            );
          })}

          <div style={{ fontSize: 9, color: "#8A929D", marginTop: 16 }}>
            Confirmed ≥92% similarity · Probable ≥82%. No SAP changes made — review and confirm each family before any merge.
          </div>
        </div>
      </body>
    </html>
  );
}

export async function buildAuditReportHtml(run: any, clusters: DecryptedCluster[], companyName: string): Promise<string> {
  // Dynamic import keeps react-dom/server out of the static module graph
  // (Next forbids importing it at module top level).
  const { renderToStaticMarkup } = await import("react-dom/server");
  return "<!DOCTYPE html>" + renderToStaticMarkup(<ReportDoc run={run} clusters={clusters} companyName={companyName} />);
}
