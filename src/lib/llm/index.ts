import type { LLMProvider } from "./types";
import { GeminiProvider } from "./gemini";
import { ClaudeProvider } from "./claude";

export * from "./types";

/** LLM_PROVIDER=gemini (default) | claude — swap providers with one env var. */
export function getLLM(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
  switch (provider) {
    case "claude":
      return new ClaudeProvider();
    case "gemini":
      return new GeminiProvider();
    default:
      throw new Error(`Unknown LLM_PROVIDER "${provider}" — use "gemini" or "claude".`);
  }
}
