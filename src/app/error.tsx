"use client";

/** Root error boundary — catches anything a route-level boundary didn't. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="min-h-dvh flex items-center justify-center px-6" style={{ background: "var(--paper)" }}>
      <div className="card w-full text-center p-10" style={{ maxWidth: 420 }}>
        <h1 className="heading-md mb-2">Something went wrong</h1>
        <p className="body-sm mb-7">An unexpected error occurred. Nothing was saved.</p>
        <button onClick={reset} className="btn btn-dark w-full">Try again</button>
      </div>
    </div>
  );
}
