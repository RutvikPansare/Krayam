"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export default function CTA() {
  return (
    <section className="section-paper py-24 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 28, scale: 0.98 }}
          whileInView={{ opacity: 1, y: 0, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="glow-card rounded-3xl p-12 md:p-20 text-center relative"
        >
          {/* decorative spinning ring */}
          <div
            aria-hidden
            className="spin-slow absolute pointer-events-none"
            style={{
              width: 480, height: 480, top: -240, left: "50%", marginLeft: -240,
              borderRadius: "50%",
              background: "conic-gradient(from 0deg, transparent 0%, rgba(245,166,35,0.16) 12%, transparent 26%)",
            }}
          />
          <div aria-hidden className="bg-blueprint-dark absolute inset-0 rounded-3xl" />

          <div className="relative">
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="label-amber mb-4"
            >
              Get started
            </motion.p>
            <h2 className="heading-xl text-white mb-5" style={{ maxWidth: 680, margin: "0 auto 20px" }}>
              Your SAP investment deserves a{" "}
              <span className="text-gradient-amber">working purchase cycle.</span>
            </h2>
            <p className="body-lg mb-10" style={{ color: "rgba(255,255,255,0.55)", maxWidth: 520, margin: "0 auto 40px" }}>
              Requests on paper. Vendor calls by phone. Quotes re-typed into spreadsheets.
              Invoices checked by eye. That ends here.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/pr/new" className="btn btn-amber group" style={{ textDecoration: "none", padding: "17px 34px", boxShadow: "0 12px 40px rgba(245,166,35,0.35)" }}>
                Raise your first request
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link href="/login" className="btn btn-outline-white" style={{ textDecoration: "none", padding: "17px 34px" }}>
                Sign in to dashboard
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
