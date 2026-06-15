"use client";

import { motion } from "framer-motion";
import {
  ClipboardList, PhoneCall, Copy, Warehouse, FileWarning, BarChart3,
} from "lucide-react";

const PAINS = [
  {
    n: "01",
    icon: ClipboardList,
    title: "Purchase requests are slow and error-prone",
    body: "A maintenance engineer fills a paper form or sends a WhatsApp message. A purchase officer manually types it into SAP. 15 to 20 minutes per request, often with wrong item codes.",
    stat: "3-5 people's time wasted daily on data entry",
  },
  {
    n: "02",
    icon: PhoneCall,
    title: "Getting vendor quotes takes days",
    body: "Officers individually call or email 4 to 6 vendors for every request. Vendors respond in different formats. Someone re-types everything into a comparison sheet by hand. 2 to 4 days, every time.",
    stat: "Machine sits idle waiting for a part that takes 3 days to order",
  },
  {
    n: "03",
    icon: Copy,
    title: "Duplicate material codes everywhere",
    body: "“Bearing 6205”, “SKF Brg 6205ZZ”, “Ball Bearing 6205”. The same part, three codes, ordered three times, sitting in three corners of the warehouse.",
    stat: "20-30% of material codes are duplicates, industry average",
  },
  {
    n: "04",
    icon: Warehouse,
    title: "Stock sitting unused in the warehouse",
    body: "Because of duplicate codes, parts get ordered again even when stock is already available under a different code or in a different location. Working capital locked in inventory nobody can find.",
    stat: "₹4-15 crore of dead stock is typical for a mid-size plant",
  },
  {
    n: "05",
    icon: FileWarning,
    title: "Invoice checking is manual and risky",
    body: "When a delivery arrives, someone manually checks invoice vs purchase order vs goods received. It takes time, gets missed under pressure, and leaves the door open for errors, or fraud.",
    stat: "Small discrepancies add up to lakhs over a year",
  },
  {
    n: "06",
    icon: BarChart3,
    title: "Management has no procurement visibility",
    body: "The CFO knows total spend from accounts. But which vendors get too much business, which categories are overspent, where prices are rising? Decisions made on gut feel, not data.",
    stat: "Strategic decisions made blind",
  },
];

function setSpotlight(e: React.MouseEvent<HTMLDivElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
}

export default function PainPoints() {
  return (
    <section id="problems" className="section-navy relative py-24 px-6 overflow-hidden">
      <div aria-hidden className="bg-blueprint-dark absolute inset-0" />
      <div className="max-w-6xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.6 }}
        >
          <p className="label-amber mb-4">What is going wrong</p>
          <h2 className="heading-xl text-white mb-4" style={{ maxWidth: 620 }}>
            The 6 daily pain points
          </h2>
          <p className="body-lg mb-14" style={{ color: "rgba(255,255,255,0.5)", maxWidth: 620 }}>
            These are not minor inefficiencies. Each one costs real money, real time, and
            real frustration for your purchase team every single day.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PAINS.map((p, i) => (
            <motion.div
              key={p.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: (i % 3) * 0.08 }}
              onMouseMove={setSpotlight}
              className="spotlight-card p-7 rounded-2xl flex flex-col"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center justify-between mb-5">
                <span className="font-logo" style={{ fontSize: 14, color: "rgba(255,255,255,0.25)" }}>{p.n}</span>
                <p.icon size={20} style={{ color: "var(--amber)" }} />
              </div>
              <h3 className="heading-sm text-white mb-3">{p.title}</h3>
              <p className="body-sm mb-5 flex-1" style={{ color: "rgba(255,255,255,0.5)" }}>{p.body}</p>
              <p
                className="text-xs font-semibold px-3 py-2 rounded-lg"
                style={{ background: "rgba(245,166,35,0.1)", color: "var(--amber)", border: "1px solid rgba(245,166,35,0.2)" }}
              >
                {p.stat}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
