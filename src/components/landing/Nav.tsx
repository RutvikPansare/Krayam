"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all ${scrolled ? "nav-scrolled" : ""}`}
    >
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-logo" style={{ fontSize: 26, color: "var(--navy)", textDecoration: "none" }}>
          Krayam<span style={{ color: "var(--amber)" }}>.</span>
        </Link>
        <div className="hidden md:flex items-center gap-8">
          <a href="#problems" className="body-sm" style={{ textDecoration: "none", fontWeight: 500 }}>The problem</a>
          <a href="#features" className="body-sm" style={{ textDecoration: "none", fontWeight: 500 }}>Platform</a>
          <a href="#workflow" className="body-sm" style={{ textDecoration: "none", fontWeight: 500 }}>How it works</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="btn btn-outline" style={{ padding: "10px 20px", textDecoration: "none" }}>
            Sign in
          </Link>
          <Link href="/pr/new" className="btn btn-dark hidden sm:inline-flex" style={{ padding: "10px 20px", textDecoration: "none" }}>
            Raise a request
          </Link>
        </div>
      </div>
    </nav>
  );
}
