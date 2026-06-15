"use client";

import { motion } from "framer-motion";

const STEPS = [
  { n: 1, title: "Engineer raises request", body: "From any phone on the shop floor. Under a minute, spec PDFs attached.", who: "Maintenance / Stores" },
  { n: 2, title: "Manager approves by email", body: "One click to approve or reject. No login, no SAP screen.", who: "Plant / Purchase head" },
  { n: 3, title: "PR lands in SAP", body: "Krayam creates the Purchase Requisition via OData. Zero typing.", who: "Krayam → SAP" },
  { n: 4, title: "RFQ blasts to vendors", body: "Every relevant vendor emailed at once with a quote link and the spec sheets.", who: "Krayam → Vendors" },
  { n: 5, title: "Quotes compared, PO placed", body: "Live comparison, normalized prices, PO pushed to SAP and PDF'd.", who: "Purchase officer" },
  { n: 6, title: "Goods received, invoice matched", body: "GRN posts to SAP on delivery. Invoice checked 3 ways before payment.", who: "Stores / Accounts" },
];

export default function Workflow() {
  return (
    <section id="workflow" className="section-paper-2 py-24 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="label mb-4" style={{ color: "var(--amber)" }}>How it works</p>
          <h2 className="heading-xl mb-14" style={{ maxWidth: 640 }}>
            From shop floor to paid invoice, without a single re-type
          </h2>
        </motion.div>

        <div className="relative">
          {/* animated connector line (desktop) */}
          <svg
            className="absolute hidden md:block"
            style={{ top: 38, left: "4%", width: "92%", height: 4 }}
            viewBox="0 0 100 2"
            preserveAspectRatio="none"
            aria-hidden
          >
            <motion.line
              x1="0" y1="1" x2="100" y2="1"
              stroke="var(--amber)" strokeWidth="2"
              initial={{ pathLength: 0 }}
              whileInView={{ pathLength: 1 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 1.6, ease: "easeInOut" }}
            />
          </svg>

          <div className="grid md:grid-cols-3 lg:grid-cols-6 gap-4">
            {STEPS.map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.12 }}
                whileHover={{ y: -5 }}
                className="card p-5 relative"
              >
                <motion.div
                  className="w-9 h-9 rounded-full flex items-center justify-center mb-4 font-logo relative z-10"
                  style={{ background: "var(--navy)", color: "var(--amber)", fontSize: 15, boxShadow: "0 0 0 5px var(--paper-2)" }}
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.4, delay: 0.2 + i * 0.12, type: "spring", stiffness: 260 }}
                >
                  {s.n}
                </motion.div>
                <h3 className="heading-sm mb-2" style={{ fontSize: 15 }}>{s.title}</h3>
                <p className="body-sm mb-4" style={{ fontSize: 12.5 }}>{s.body}</p>
                <p className="label" style={{ fontSize: 9.5 }}>{s.who}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mt-14">
          {[
            { v: "2-4 days → minutes", l: "vendor quote turnaround" },
            { v: "15-20 min → 0", l: "manual SAP entry per request" },
            { v: "₹4-15 crore", l: "typical dead stock Krayam helps unlock" },
          ].map((s, i) => (
            <motion.div
              key={s.l}
              initial={{ opacity: 0, scale: 0.92 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.45, delay: i * 0.1 }}
              className="stat-badge w-full justify-center py-5"
            >
              <span className="heading-sm" style={{ color: "var(--navy)" }}>{s.v}</span>
              <span className="body-sm">{s.l}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
