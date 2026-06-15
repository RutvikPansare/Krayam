"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Route error boundary for the PR form. Written for a shop-floor user on a
 * basic phone: plain words, one button, no stack traces.
 */
export default function PRFormError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--paper)" }}>
      <div className="card w-full text-center p-10" style={{ maxWidth: 420 }}>
        <AlertTriangle size={44} className="mx-auto mb-4" style={{ color: "#B97A0A" }} />
        <h1 className="heading-md mb-2">Something went wrong</h1>
        <p className="body-sm mb-7">
          The form hit a problem. Your request was not submitted. Tap the button to
          try again — if it keeps happening, check your network signal.
        </p>
        <button onClick={reset} className="btn btn-dark w-full">Try again</button>
      </div>
    </div>
  );
}
