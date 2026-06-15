"use client";

/** Scrolling capability strip between hero and pain points. */

const ITEMS = [
  "SAP S/4HANA OData",
  "One-click approvals",
  "RFQ auto-blast",
  "Quote normalization",
  "Duplicate code detection",
  "Stock check before PO",
  "PO PDF generation",
  "GRN automation",
  "3-way invoice match",
  "GST invoice extraction",
  "Spec sheet attachments",
  "CFO spend analytics",
  "Board-ready PDF reports",
];

export default function Marquee() {
  return (
    <div
      className="py-5 overflow-hidden relative"
      style={{ background: "var(--navy)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
      aria-hidden
    >
      <div className="marquee-track">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex items-center flex-shrink-0">
            {ITEMS.map((item) => (
              <span key={`${dup}-${item}`} className="flex items-center flex-shrink-0">
                <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.65)", whiteSpace: "nowrap" }}>
                  {item}
                </span>
                <span className="mx-6" style={{ color: "var(--amber)", fontSize: 11 }}>✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
