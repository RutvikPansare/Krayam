"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import Link from "next/link";
import { useRef } from "react";
import { Smartphone, MailCheck, Database, Send, FileCheck2, ArrowRight } from "lucide-react";

const HEADLINE = ["Procurement", "that", "runs"];
const HEADLINE2 = ["itself."];

const PIPELINE = [
  { icon: Smartphone, label: "PR raised", sub: "shop floor, 47s", state: "done" },
  { icon: MailCheck, label: "Approved", sub: "one click, email", state: "done" },
  { icon: Database, label: "PR in SAP", sub: "no typing", state: "done" },
  { icon: Send, label: "RFQ sent", sub: "5 vendors", state: "live" },
  { icon: FileCheck2, label: "PO + GRN", sub: "auto-matched", state: "next" },
] as const;

const wordAnim = {
  hidden: { opacity: 0, y: 38, rotateX: 35 },
  show: (i: number) => ({
    opacity: 1, y: 0, rotateX: 0,
    transition: { duration: 0.7, delay: 0.1 + i * 0.09, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

export default function Hero() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const bgY = useTransform(scrollYProgress, [0, 1], [0, 110]);
  const mockY = useTransform(scrollYProgress, [0, 1], [0, -60]);

  return (
    <section ref={ref} className="section-paper relative overflow-hidden pt-36 pb-24 px-6">
      {/* parallax blueprint grid */}
      <motion.div aria-hidden className="bg-blueprint absolute inset-0" style={{ y: bgY }} />
      {/* ambient color blobs */}
      <div aria-hidden className="absolute pointer-events-none" style={{ top: -180, right: -120, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,166,35,0.13), transparent 65%)" }} />
      <div aria-hidden className="absolute pointer-events-none" style={{ bottom: -220, left: -160, width: 560, height: 560, borderRadius: "50%", background: "radial-gradient(circle, rgba(61,126,166,0.12), transparent 65%)" }} />

      <div className="max-w-6xl mx-auto relative grid lg:grid-cols-[1.15fr_1fr] gap-14 items-center">
        <div>
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full mb-7"
            style={{ background: "rgba(11,34,57,0.05)", border: "1px solid rgba(11,34,57,0.12)" }}
          >
            <span className="pulse-dot" />
            <span className="label" style={{ color: "var(--navy)", fontSize: 11 }}>
              Live on SAP S/4HANA · 13 features shipped
            </span>
          </motion.div>

          <h1 className="heading-hero mb-7" style={{ perspective: 700 }}>
            {HEADLINE.map((w, i) => (
              <motion.span key={w} custom={i} variants={wordAnim} initial="hidden" animate="show" className="inline-block mr-[0.22em]">
                {w}
              </motion.span>
            ))}
            <br />
            {HEADLINE2.map((w, i) => (
              <motion.span key={w} custom={i + HEADLINE.length} variants={wordAnim} initial="hidden" animate="show" className="inline-block text-gradient-amber">
                {w}
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="body-lg mb-10"
            style={{ maxWidth: 540 }}
          >
            Krayam sits on top of SAP and automates the full purchase cycle for Indian
            manufacturers: request, approval, RFQ, quotes, purchase order, goods receipt
            and invoice check. No paper, no re-typing, no duplicate stock.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.62 }}
            className="flex flex-wrap items-center gap-4 mb-12"
          >
            <Link href="/pr/new" className="btn btn-dark group" style={{ textDecoration: "none", padding: "16px 30px", boxShadow: "0 14px 36px rgba(11,34,57,0.28)" }}>
              Raise a purchase request
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
            </Link>
            <Link href="/login" className="btn btn-outline" style={{ textDecoration: "none", padding: "16px 30px", background: "rgba(255,255,255,0.6)", backdropFilter: "blur(6px)" }}>
              Open the dashboard
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.78 }}
            className="flex flex-wrap gap-x-10 gap-y-4"
          >
            {[
              ["2-4 days", "quote cycle, now minutes"],
              ["15 min", "SAP entry per PR, now zero"],
              ["20-30%", "duplicate codes, caught live"],
            ].map(([v, l]) => (
              <div key={l}>
                <p className="font-logo" style={{ fontSize: 24, color: "var(--navy)" }}>{v}</p>
                <p className="body-sm" style={{ fontSize: 12.5 }}>{l}</p>
              </div>
            ))}
          </motion.div>
        </div>

        {/* animated pipeline mockup */}
        <motion.div
          style={{ y: mockY }}
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative hidden lg:block"
          aria-hidden
        >
          {/* connecting line */}
          <svg className="absolute left-[27px] top-8 bottom-8 h-[calc(100%-64px)]" width="2" viewBox="0 0 2 100" preserveAspectRatio="none">
            <line x1="1" y1="0" x2="1" y2="100" stroke="rgba(11,34,57,0.18)" strokeWidth="2" className="flow-line" />
          </svg>

          <div className="flex flex-col gap-3.5">
            {PIPELINE.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.55, delay: 0.7 + i * 0.16 }}
                className={`mini-card flex items-center gap-4 px-5 py-4 ${i % 2 === 0 ? "float-slow" : "float-slower"}`}
                style={{
                  marginLeft: i * 14,
                  opacity: s.state === "next" ? 0.55 : 1,
                  borderColor: s.state === "live" ? "rgba(245,166,35,0.55)" : undefined,
                }}
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: s.state === "live" ? "rgba(245,166,35,0.15)" : "rgba(11,34,57,0.06)" }}
                >
                  <s.icon size={18} style={{ color: s.state === "live" ? "#B97A0A" : "var(--navy)" }} />
                </div>
                <div className="flex-1">
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-dark)" }}>{s.label}</p>
                  <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.sub}</p>
                </div>
                {s.state === "done" && (
                  <span className="pill pill-green" style={{ fontSize: 10 }}>done</span>
                )}
                {s.state === "live" && (
                  <span className="mini-row">
                    <span className="pulse-dot" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#B97A0A" }}>live</span>
                  </span>
                )}
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
