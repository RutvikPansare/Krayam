"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, Sparkles, CheckCircle2, ClipboardList } from "lucide-react";

/**
 * Conversational PR assistant — describe what you need in plain language
 * (English or Hinglish), no SAP codes required.
 */

interface Bubble {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "I need 10 bearings for machine 4 in the press shop",
  "Press shop ke liye 2 V-belt chahiye, urgent hai",
  "Welding rods khatam ho gaye, 20 packet order karo",
];

export default function AssistantPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      role: "assistant",
      text: "Namaste! Tell me what you need: item, quantity, and which machine or department it's for. Hindi, English ya Hinglish, sab chalega. 🔧",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [prNumber, setPrNumber] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [bubbles, busy]);

  async function send(text: string) {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput("");
    setBubbles((b) => [...b, { role: "user", text: msg }]);
    setBusy(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: conversationId, message: msg }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Something went wrong");
      setConversationId(body.conversation_id);
      setBubbles((b) => [...b, { role: "assistant", text: body.reply || "…" }]);
      if (body.pr_created) setPrNumber(body.pr_created.pr_number);
    } catch (err) {
      setBubbles((b) => [
        ...b,
        { role: "assistant", text: err instanceof Error ? err.message : "Network problem — try again." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-dvh flex flex-col" style={{ background: "var(--paper)" }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4 flex-shrink-0" style={{ background: "var(--navy)" }}>
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <a href="/" className="font-logo text-white" style={{ fontSize: 22, textDecoration: "none" }}>
              Krayam<span style={{ color: "var(--amber)" }}>.</span>
            </a>
            <p className="body-sm flex items-center gap-1.5 mt-1" style={{ color: "rgba(255,255,255,0.55)" }}>
              <Sparkles size={12} style={{ color: "var(--amber)" }} /> Procurement assistant
            </p>
          </div>
          <a href="/pr/new" className="body-sm flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>
            <ClipboardList size={13} /> Use the form instead
          </a>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          {bubbles.map((b, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className={`px-4 py-3 rounded-2xl ${b.role === "user" ? "self-end" : "self-start"}`}
              style={{
                maxWidth: "85%",
                background: b.role === "user" ? "var(--navy)" : "white",
                color: b.role === "user" ? "white" : "var(--text-dark)",
                border: b.role === "user" ? "none" : "1px solid var(--border)",
                fontSize: 14.5,
                lineHeight: 1.55,
                whiteSpace: "pre-wrap",
                borderBottomRightRadius: b.role === "user" ? 6 : undefined,
                borderBottomLeftRadius: b.role === "assistant" ? 6 : undefined,
              }}
            >
              {b.text}
            </motion.div>
          ))}

          {busy && (
            <div className="self-start px-4 py-3 rounded-2xl" style={{ background: "white", border: "1px solid var(--border)" }}>
              <motion.span
                className="flex gap-1.5"
                initial="hidden"
                animate="show"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ background: "var(--text-muted)" }}
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18 }}
                  />
                ))}
              </motion.span>
            </div>
          )}

          {prNumber && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="self-center card p-5 text-center w-full"
              style={{ maxWidth: 320, border: "1.5px solid rgba(34,197,94,0.4)" }}
            >
              <CheckCircle2 size={32} className="mx-auto mb-2" style={{ color: "#15803D" }} />
              <p className="body-sm mb-0.5">Purchase request raised</p>
              <p className="heading-md" style={{ color: "var(--navy)" }}>{prNumber}</p>
              <button
                onClick={() => { setPrNumber(null); setConversationId(null); setBubbles([bubbles[0]]); }}
                className="btn btn-outline w-full mt-4"
                style={{ padding: "9px" }}
              >
                Raise another
              </button>
            </motion.div>
          )}

          {/* Suggestion chips — first message only */}
          {bubbles.length === 1 && !busy && (
            <div className="flex flex-col gap-2 mt-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-left px-4 py-2.5 rounded-xl"
                  style={{ background: "rgba(11,34,57,0.05)", border: "1px dashed rgba(11,34,57,0.2)", fontSize: 13, color: "var(--text-mid)", cursor: "pointer" }}
                >
                  &ldquo;{s}&rdquo;
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 px-4 pb-5 pt-2" style={{ background: "var(--paper)", borderTop: "1px solid var(--border)" }}>
        <form
          className="max-w-md mx-auto flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); send(input); }}
        >
          <textarea
            className="app-textarea flex-1"
            rows={1}
            style={{ resize: "none", maxHeight: 120, fontSize: 15 }}
            placeholder="10 bearing chahiye machine 4 ke liye…"
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }
            }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="btn btn-dark flex-shrink-0"
            style={{ padding: "12px 14px", opacity: busy || !input.trim() ? 0.5 : 1 }}
            aria-label="Send message"
          >
            <Send size={17} />
          </button>
        </form>
        <p className="label text-center mt-2.5" style={{ fontSize: 9 }}>
          No SAP codes needed · works in Hinglish · powered by Krayam AI
        </p>
      </div>
    </div>
  );
}
