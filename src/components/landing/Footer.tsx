import Link from "next/link";

export default function Footer() {
  return (
    <footer className="section-navy px-6 py-12">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <span className="font-logo text-white" style={{ fontSize: 22 }}>
            Krayam<span style={{ color: "var(--amber)" }}>.</span>
          </span>
          <p className="body-sm mt-1" style={{ color: "rgba(255,255,255,0.4)" }}>
            Procurement intelligence for Indian manufacturers 🇮🇳
          </p>
        </div>
        <div className="flex items-center gap-8">
          <Link href="/pr/new" className="body-sm" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Raise a request</Link>
          <Link href="/login" className="body-sm" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Sign in</Link>
          <a href="#features" className="body-sm" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>Platform</a>
        </div>
        <p className="body-sm" style={{ color: "rgba(255,255,255,0.3)" }}>© 2026 Krayam</p>
      </div>
    </footer>
  );
}
