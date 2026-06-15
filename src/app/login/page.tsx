"use client";

export const dynamic = "force-dynamic";

import { useState } from "react";
import { motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";

const stats = [
  { number: "2–4d→min", label: "vendor quote turnaround, automated" },
  { number: "20–30%",   label: "duplicate material codes Krayam catches" },
  { number: "₹4–15cr",  label: "typical dead stock per mid-size plant" },
];

const quote = {
  text: "We're onboarding our first manufacturing plants. Join early and help us fix Indian procurement.",
  name: "Rutvik, Founder",
  brand: "Krayam · Building in public",
};

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  ) : (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1={1} y1={1} x2={23} y2={23} />
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const supabase = createClient();

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    setError(null);
    try {
      const origin = window.location.origin;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback`,
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        setError(error.message);
        setGoogleLoading(false);
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setGoogleLoading(false);
    }
  }

  async function handleEmailSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      window.location.href = "/dashboard";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-dvh flex items-stretch"
      style={{ background: "var(--navy)" }}
    >

      {/* ── LEFT PANEL — Navy brand strip ── */}
      <div
        className="hidden lg:flex flex-col justify-between w-[44%] flex-shrink-0 p-10 xl:p-14 self-stretch"
        style={{ background: "var(--navy)", minHeight: "100dvh" }}
      >
        <a href="/" className="font-logo text-white" style={{ fontSize: 32, textDecoration: "none" }}>
          Krayam<span style={{ color: "var(--amber)" }}>.</span>
        </a>

        <div>
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, delay: 0.1 }}
            className="heading-xl text-white mb-4"
            style={{ maxWidth: 400 }}
          >
            Your purchase cycle, finally automated.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="body-lg mb-12"
            style={{ color: "rgba(255,255,255,0.45)", maxWidth: 360 }}
          >
            Krayam sits on top of SAP and runs the cycle from request to order.
          </motion.p>

          <div className="flex flex-col gap-3">
            {stats.map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.28 + i * 0.1 }}
                className="flex items-center gap-5 p-5 rounded-2xl"
                style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
              >
                <span
                  className="heading-sm flex-shrink-0"
                  style={{ color: "var(--amber)", lineHeight: 1.1, minWidth: 96 }}
                >
                  {s.number}
                </span>
                <span className="body-sm" style={{ color: "rgba(255,255,255,0.5)" }}>
                  {s.label}
                </span>
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.65 }}
          className="p-6 rounded-2xl mt-10"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.07)" }}
        >
          <p className="body-sm mb-4" style={{ color: "rgba(255,255,255,0.6)", fontStyle: "italic" }}>
            &ldquo;{quote.text}&rdquo;
          </p>
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "rgba(245,166,35,0.15)", color: "var(--amber)" }}
            >
              {quote.name[0]}
            </div>
            <div>
              <p className="body-sm font-semibold" style={{ color: "rgba(255,255,255,0.8)", fontSize: 13 }}>
                {quote.name}
              </p>
              <p className="label" style={{ color: "rgba(255,255,255,0.3)" }}>{quote.brand}</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* ── RIGHT PANEL — Form ── */}
      <div
        className="flex-1 flex flex-col items-center px-6 py-12 relative self-stretch"
        style={{ background: "var(--paper)", minHeight: "100dvh", justifyContent: "safe center" }}
      >

        <div className="lg:hidden mb-10">
          <a href="/" className="font-logo" style={{ fontSize: 30, color: "var(--navy)", textDecoration: "none" }}>
            Krayam<span style={{ color: "var(--amber)" }}>.</span>
          </a>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="card w-full"
          style={{ maxWidth: 440, padding: "40px 40px 36px" }}
        >
          <div className="mb-8">
            <h1 className="heading-lg text-[var(--text-dark)] mb-2">Welcome back</h1>
            <p className="body-md">Sign in to your Krayam dashboard.</p>
          </div>

          {error && (
            <div
              className="mb-5 px-4 py-3 rounded-xl"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <p style={{ fontSize: 13, color: "#EF4444" }}>{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 mb-6 transition-colors"
            style={{
              padding: "13px 20px",
              borderRadius: "var(--radius-btn)",
              border: "1.5px solid var(--border)",
              background: "white",
              fontSize: 14,
              fontWeight: 600,
              color: "var(--text-dark)",
              cursor: googleLoading ? "not-allowed" : "pointer",
              opacity: googleLoading ? 0.7 : 1,
            }}
            onMouseOver={(e) => !googleLoading && (e.currentTarget.style.background = "var(--paper)")}
            onMouseOut={(e)  => (e.currentTarget.style.background = "white")}
          >
            {googleLoading ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={3} strokeOpacity={0.25} />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
            )}
            {googleLoading ? "Redirecting…" : "Continue with Google"}
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            <span className="label">or</span>
            <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
          </div>

          <form onSubmit={handleEmailSignIn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="label" style={{ color: "var(--text-dark)" }}>
                Email
              </label>
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="app-input"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="label" style={{ color: "var(--text-dark)" }}>
                  Password
                </label>
                <a
                  href="#"
                  className="label"
                  style={{ color: "var(--text-mid)", textDecoration: "none" }}
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPass ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="app-input"
                  style={{ paddingRight: 44 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-4 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                >
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-dark w-full mt-2"
              style={{ position: "relative", opacity: loading ? 0.75 : 1 }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx={12} cy={12} r={10} stroke="currentColor" strokeWidth={3} strokeOpacity={0.25} />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
                  </svg>
                  Signing in…
                </span>
              ) : (
                "Continue →"
              )}
            </button>
          </form>

        </motion.div>

        <p className="label text-center mt-8" style={{ color: "var(--text-muted)" }}>
          © 2026 Krayam · Made for Indian manufacturers 🇮🇳
        </p>
      </div>
    </div>
  );
}
