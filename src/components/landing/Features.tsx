"use client";

import { motion } from "framer-motion";
import {
  Smartphone, MailCheck, Database, Send, ScanSearch, ReceiptText, TrendingUp,
  Paperclip, CheckCircle2, PackageCheck, FileText, AlertTriangle,
} from "lucide-react";

/* ── shared animation helpers ── */

const rise = {
  hidden: { opacity: 0, y: 26 },
  show: (i = 0) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.55, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

const pop = {
  hidden: { opacity: 0, scale: 0.85 },
  show: (i = 0) => ({
    opacity: 1, scale: 1,
    transition: { duration: 0.45, delay: 0.25 + i * 0.18, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

/* ── feature visuals: animated mini product UIs ── */

function VisualMobilePR() {
  return (
    <div className="feature-visual p-8 flex items-center justify-center" style={{ minHeight: 320 }}>
      <motion.div variants={rise} className="mini-card w-[240px] p-5 float-slow">
        <div className="mini-row mb-4">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "var(--navy)" }}>
            <span className="font-logo" style={{ fontSize: 11, color: "var(--amber)" }}>K</span>
          </div>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text-dark)" }}>New purchase request</p>
        </div>
        {[0.9, 0.6, 0.75].map((w, i) => (
          <motion.div
            key={i}
            className="mini-bar mb-2.5"
            initial={{ width: 0 }}
            whileInView={{ width: `${w * 100}%` }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 + i * 0.22 }}
          />
        ))}
        <motion.div variants={pop} custom={1} className="mini-row mt-4 px-3 py-2 rounded-lg" style={{ background: "rgba(245,166,35,0.1)", border: "1px dashed rgba(245,166,35,0.45)" }}>
          <Paperclip size={12} style={{ color: "#B97A0A" }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: "#B97A0A" }}>spindle-drawing.pdf</span>
        </motion.div>
        <motion.div variants={pop} custom={2} className="mt-4 py-2.5 rounded-lg text-center" style={{ background: "var(--navy)" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff" }}>Submit · 47 seconds</span>
        </motion.div>
      </motion.div>
    </div>
  );
}

function VisualApproval() {
  return (
    <div className="feature-visual p-8 flex flex-col items-center justify-center gap-4" style={{ minHeight: 320 }}>
      <motion.div variants={rise} className="mini-card w-[270px] p-5">
        <p className="label mb-2" style={{ fontSize: 9, color: "#B97A0A" }}>Approval required</p>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text-dark)" }}>PR-1042 · Ball Bearing 6205</p>
        <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 14 }}>Ramesh Kumar · Maintenance · urgent</p>
        <div className="mini-row">
          <motion.div
            className="flex-1 py-2 rounded-lg text-center relative"
            style={{ background: "#15803D" }}
            whileInView={{ scale: [1, 1, 0.93, 1] }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, delay: 1.1, times: [0, 0.6, 0.8, 1] }}
          >
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#fff" }}>✓ Approve</span>
          </motion.div>
          <div className="flex-1 py-2 rounded-lg text-center" style={{ border: "1.5px solid rgba(220,38,38,0.4)" }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "#DC2626" }}>✕ Reject</span>
          </div>
        </div>
      </motion.div>
      <motion.div variants={pop} custom={3} className="mini-row px-4 py-2.5 rounded-full mini-card">
        <CheckCircle2 size={14} style={{ color: "#15803D" }} />
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dark)" }}>Approved from a phone, no login</span>
      </motion.div>
    </div>
  );
}

function VisualSAP() {
  const calls = [
    ["POST", "A_PurchaseRequisitionHeader", "PR 1000041288"],
    ["POST", "A_PurchaseOrder", "PO 4500067231"],
    ["POST", "A_MaterialDocumentHeader · 101", "GRN 5000091104"],
  ];
  return (
    <div className="feature-visual p-8 flex items-center justify-center" style={{ minHeight: 320 }}>
      <motion.div variants={rise} className="mini-card w-[320px] overflow-hidden">
        <div className="mini-row px-4 py-2.5" style={{ background: "var(--navy)" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: "#FF5F57" }} />
          <span className="w-2 h-2 rounded-full" style={{ background: "#FEBC2E" }} />
          <span className="w-2 h-2 rounded-full" style={{ background: "#28C840" }} />
          <span style={{ fontSize: 10.5, color: "rgba(255,255,255,0.55)", marginLeft: 6, fontFamily: "monospace" }}>krayam → sap odata</span>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {calls.map(([verb, path, result], i) => (
            <motion.div key={path} variants={pop} custom={i} className="flex items-start gap-2.5">
              <span style={{ fontSize: 10, fontWeight: 700, fontFamily: "monospace", color: "#fff", background: "var(--steel)", padding: "1px 6px", borderRadius: 4, marginTop: 1 }}>{verb}</span>
              <div className="flex-1">
                <p style={{ fontSize: 11, fontFamily: "monospace", color: "var(--text-dark)" }}>{path}</p>
                <p className="mini-row" style={{ fontSize: 10.5, fontFamily: "monospace", color: "#15803D" }}>
                  <CheckCircle2 size={10} /> {result}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function VisualRFQ() {
  const quotes = [
    ["Sharma Bearings", "₹192", true],
    ["Patel Industrial", "₹210", false],
    ["Verma Tools", "₹198", false],
  ] as const;
  return (
    <div className="feature-visual p-8 flex flex-col items-center justify-center gap-3" style={{ minHeight: 320 }}>
      <motion.div variants={pop} custom={0} className="mini-row px-4 py-2 rounded-full mini-card">
        <Send size={13} style={{ color: "var(--navy)" }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-dark)" }}>RFQ-512 sent to 5 vendors</span>
        <span className="pulse-dot" style={{ marginLeft: 2 }} />
      </motion.div>
      <motion.div variants={rise} className="mini-card w-[290px] p-4">
        <p className="label mb-3" style={{ fontSize: 9 }}>Live quote comparison · per piece</p>
        {quotes.map(([vendor, price, best], i) => (
          <motion.div
            key={vendor}
            variants={pop}
            custom={i + 1}
            className="mini-row justify-between px-3 py-2.5 rounded-lg mb-1.5"
            style={{
              background: best ? "rgba(34,197,94,0.09)" : "var(--paper)",
              border: best ? "1px solid rgba(34,197,94,0.35)" : "1px solid transparent",
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dark)" }}>{vendor}</span>
            <span className="mini-row">
              <span style={{ fontSize: 12.5, fontWeight: 800, color: best ? "#15803D" : "var(--text-mid)" }}>{price}</span>
              {best && <span className="pill pill-green" style={{ fontSize: 9 }}>best</span>}
            </span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

function VisualDedup() {
  return (
    <div className="feature-visual p-8 flex items-center justify-center" style={{ minHeight: 320 }}>
      <motion.div variants={rise} className="mini-card w-[290px] p-4">
        <div className="mini-row px-3 py-2.5 rounded-lg mb-3" style={{ border: "1.5px solid var(--navy)", background: "#fff" }}>
          <ScanSearch size={13} style={{ color: "var(--text-muted)" }} />
          <span style={{ fontSize: 12, color: "var(--text-dark)" }}>bearing 6205</span>
          <motion.span
            style={{ width: 1.5, height: 14, background: "var(--navy)", display: "inline-block" }}
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 1, repeat: Infinity }}
          />
        </div>
        <p className="label mb-2" style={{ fontSize: 9, color: "#B97A0A" }}>Already in material master</p>
        {[
          ["MAT-10001", "Bearing 6205", "6 in stock"],
          ["MAT-10002", "SKF Brg 6205ZZ", "12 in stock"],
          ["MAT-10003", "Ball Bearing 6205", "4 in stock"],
        ].map(([code, desc, stock], i) => (
          <motion.div key={code} variants={pop} custom={i} className="mini-row justify-between px-3 py-2 rounded-lg mb-1.5" style={{ background: "var(--paper)" }}>
            <div>
              <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--text-dark)" }}>{desc}</p>
              <p style={{ fontSize: 9.5, fontFamily: "monospace", color: "var(--text-muted)" }}>{code}</p>
            </div>
            <span className="pill pill-green" style={{ fontSize: 9 }}>{stock}</span>
          </motion.div>
        ))}
        <motion.p variants={pop} custom={3} style={{ fontSize: 10.5, fontWeight: 600, color: "#15803D", marginTop: 6 }}>
          ✓ Duplicate caught before ordering. Stock used instead.
        </motion.p>
      </motion.div>
    </div>
  );
}

function VisualInvoice() {
  return (
    <div className="feature-visual p-8 flex flex-col items-center justify-center gap-3" style={{ minHeight: 320 }}>
      <div className="flex items-center gap-2.5">
        {[
          [FileText, "Invoice"],
          [Database, "PO"],
          [PackageCheck, "GRN"],
        ].map(([Icon, label]: any, i) => (
          <motion.div key={label} variants={pop} custom={i} className="mini-card px-4 py-3 flex flex-col items-center gap-1.5" style={{ width: 86 }}>
            <Icon size={17} style={{ color: "var(--navy)" }} />
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--text-dark)" }}>{label}</span>
          </motion.div>
        ))}
      </div>
      <motion.div variants={pop} custom={3} aria-hidden>
        <svg width="180" height="26" viewBox="0 0 180 26">
          <path d="M20 2 L90 22 L160 2" fill="none" stroke="rgba(11,34,57,0.3)" strokeWidth="1.5" className="flow-line" />
        </svg>
      </motion.div>
      <motion.div variants={rise} className="mini-card w-[290px] p-4">
        <p className="label mb-2.5" style={{ fontSize: 9 }}>3-way match · INV SB/2026/0451</p>
        {[
          ["ok", "Totals match PO within 2% tolerance"],
          ["ok", "All quantities received per GRN"],
          ["flag", "Rate ₹240 vs PO ₹192 on line 2"],
        ].map(([kind, msg], i) => (
          <motion.div key={msg} variants={pop} custom={i + 4} className="mini-row px-3 py-2 rounded-lg mb-1.5"
            style={{ background: kind === "ok" ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.07)" }}>
            {kind === "ok"
              ? <CheckCircle2 size={12} style={{ color: "#15803D", flexShrink: 0 }} />
              : <AlertTriangle size={12} style={{ color: "#DC2626", flexShrink: 0 }} />}
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dark)" }}>{msg}</span>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

function VisualSpend() {
  const bars = [42, 68, 55, 80, 64, 92];
  return (
    <div className="feature-visual p-8 flex items-center justify-center gap-5" style={{ minHeight: 320 }}>
      <motion.div variants={rise} className="mini-card p-5 flex flex-col items-center" style={{ width: 150 }}>
        <p className="label mb-3" style={{ fontSize: 9 }}>By category</p>
        <svg width="92" height="92" viewBox="0 0 36 36" aria-hidden>
          {[
            ["#0B2239", 38, 0], ["#F5A623", 26, 38], ["#3D7EA6", 20, 64], ["#8CA66B", 16, 84],
          ].map(([color, len, off], i) => (
            <motion.circle
              key={i} cx="18" cy="18" r="14" fill="none" stroke={color as string} strokeWidth="6"
              strokeDasharray={`${len} ${88 - Number(len)}`} strokeDashoffset={-Number(off) + 22}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 + i * 0.15 }}
            />
          ))}
        </svg>
        <p style={{ fontSize: 13, fontWeight: 800, color: "var(--navy)", marginTop: 8 }}>₹1.4 Cr</p>
        <p style={{ fontSize: 10, color: "var(--text-muted)" }}>6-month spend</p>
      </motion.div>
      <motion.div variants={rise} className="mini-card p-5" style={{ width: 170 }}>
        <p className="label mb-3" style={{ fontSize: 9 }}>Budget vs actual</p>
        <div className="flex items-end gap-1.5" style={{ height: 86 }}>
          {bars.map((h, i) => (
            <motion.div
              key={i}
              className="flex-1 rounded-t"
              style={{ background: i === 5 ? "var(--amber)" : "var(--navy)" }}
              initial={{ height: 0 }}
              whileInView={{ height: `${h}%` }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.35 + i * 0.09, ease: [0.22, 1, 0.36, 1] }}
            />
          ))}
        </div>
        <motion.p variants={pop} custom={5} style={{ fontSize: 10.5, fontWeight: 600, color: "#B97A0A", marginTop: 8 }}>
          Board PDF emailed monthly, automatically
        </motion.p>
      </motion.div>
    </div>
  );
}

/* ── feature content ── */

const FEATURES = [
  {
    n: "01",
    icon: Smartphone,
    tag: "Any phone, no app",
    title: "Purchase requests from the shop floor",
    body: "A maintenance engineer raises a request in under a minute from any phone browser. Engineering drawings and spec PDFs attach right on the form and travel with the request all the way to vendors.",
    points: ["Works as a PWA, no install", "Spec sheets attach once, sent with every RFQ", "Lands instantly in the purchase queue"],
    Visual: VisualMobilePR,
  },
  {
    n: "02",
    icon: MailCheck,
    tag: "No login needed",
    title: "One-click approvals by email",
    body: "The manager gets the full request in an email with two buttons. One tap from their phone and the cycle moves forward automatically. The requester gets notified the same second.",
    points: ["Secure signed links, valid 14 days", "Full item table inside the email", "Approve or reject with a note"],
    Visual: VisualApproval,
  },
  {
    n: "03",
    icon: Database,
    tag: "Zero typing in SAP",
    title: "SAP writes itself: PR, PO and GRN",
    body: "On approval, Krayam creates the Purchase Requisition in SAP via OData. The winning quote becomes a Purchase Order. Delivery confirmation posts the Goods Receipt with movement type 101. Three manual SAP screens, gone.",
    points: ["Standard S/4HANA OData APIs", "ME21N, ME21 and MIGO replaced", "Every SAP number tracked back in Krayam"],
    Visual: VisualSAP,
  },
  {
    n: "04",
    icon: Send,
    tag: "Days become minutes",
    title: "RFQ blast and live quote comparison",
    body: "The moment a PR is approved, every relevant vendor gets an RFQ email with a structured quote link. Quotes land in a live comparison table, normalized to per-piece prices even when one vendor quotes in dozens and another in boxes.",
    points: ["All vendors contacted at once", "Unit normalization built in", "Best price highlighted automatically"],
    Visual: VisualRFQ,
  },
  {
    n: "05",
    icon: ScanSearch,
    tag: "Crores recovered",
    title: "Duplicate detection and stock check",
    body: "As the engineer types, Krayam fuzzy-searches the material master and shows existing codes with live stock. Before any PO goes out, a final stock check trims quantities already sitting in the warehouse.",
    points: ["Trigram search catches misspellings", "Stock across all plants shown inline", "Dedup audit finds existing duplicate clusters"],
    Visual: VisualDedup,
  },
  {
    n: "06",
    icon: ReceiptText,
    tag: "Pay with confidence",
    title: "3-way invoice match before payment",
    body: "Upload a vendor invoice PDF and Krayam extracts the data, then checks it against the PO and the goods actually received. Price inflation, over-billing and undelivered lines get flagged before money leaves.",
    points: ["GST invoice extraction built for Indian formats", "Invoice vs PO vs GRN, line by line", "Discrepancies blocked until reviewed"],
    Visual: VisualInvoice,
  },
  {
    n: "07",
    icon: TrendingUp,
    tag: "For the CFO",
    title: "Spend analytics and board reports",
    body: "Real-time spend by category, vendor, plant and month, computed from Krayam's own transaction data. Vendor concentration risk surfaces automatically. A board-ready PDF lands in the CFO's inbox every month.",
    points: ["Category, vendor, plant and trend views", "Budget vs actual tracking", "Monthly PDF report, fully automatic"],
    Visual: VisualSpend,
  },
];

export default function Features() {
  return (
    <section id="features" className="section-paper py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="label mb-4" style={{ color: "var(--amber)" }}>The platform</p>
          <h2 className="heading-xl mb-4" style={{ maxWidth: 680 }}>
            Everything between SAP and your shop floor
          </h2>
          <p className="body-lg mb-16" style={{ maxWidth: 600 }}>
            The ERP is there. The workflow automation is not. Krayam closes that gap with
            13 features covering the entire purchase cycle.
          </p>
        </motion.div>

        <div className="flex flex-col gap-20">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.n}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-90px" }}
              transition={{ staggerChildren: 0.08 }}
              className={`grid lg:grid-cols-2 gap-10 items-center ${i % 2 === 1 ? "lg:[&>*:first-child]:order-2" : ""}`}
            >
              <motion.div variants={rise}>
                <div className="flex items-center gap-3 mb-4">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(11,34,57,0.06)", border: "1px solid rgba(11,34,57,0.1)" }}
                  >
                    <f.icon size={20} style={{ color: "var(--navy)" }} />
                  </div>
                  <span className="font-logo" style={{ fontSize: 13, color: "var(--text-muted)" }}>{f.n}</span>
                  <span className="pill pill-amber">{f.tag}</span>
                </div>
                <h3 className="heading-lg mb-4">{f.title}</h3>
                <p className="body-md mb-6">{f.body}</p>
                <ul className="flex flex-col gap-2.5">
                  {f.points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 body-sm" style={{ color: "var(--text-dark)" }}>
                      <span
                        className="mt-1 w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                        style={{ background: "rgba(245,166,35,0.18)", color: "#B97A0A" }}
                      >
                        ✓
                      </span>
                      {pt}
                    </li>
                  ))}
                </ul>
              </motion.div>
              <f.Visual />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
