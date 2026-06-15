import type { ChatMessage, LLMProvider, LLMResponse, ToolDefinition } from "./types";

/**
 * Gemini provider — REST API (generateContent), no SDK dependency.
 *
 * Env:
 *   GEMINI_API_KEY
 *   GEMINI_MODEL   (default gemini-2.0-flash)
 *
 * Wire format: contents[{role: "user"|"model", parts:[{text}|{functionCall}|
 * {functionResponse}]}], tools:[{functionDeclarations}], systemInstruction.
 */

function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const contents: unknown[] = [];
  for (const m of messages) {
    const parts: unknown[] = [];
    if (m.role === "assistant") {
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: tc.name, args: tc.args } });
      }
      contents.push({ role: "model", parts });
    } else {
      for (const tr of m.toolResults ?? []) {
        parts.push({ functionResponse: { name: tr.name, response: { result: tr.result } } });
      }
      if (m.content) parts.push({ text: m.content });
      contents.push({ role: "user", parts });
    }
  }
  return contents;
}

export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";

  async chat(opts: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not configured");
    const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: opts.system }] },
          contents: toGeminiContents(opts.messages),
          tools: [
            {
              functionDeclarations: opts.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.inputSchema,
              })),
            },
          ],
        }),
      }
    );

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = (body as any)?.error?.message ?? `${res.status} ${res.statusText}`;
      throw new Error(`Gemini API error: ${msg}`);
    }

    const parts: any[] = (body as any)?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === "string").map((p) => p.text).join("") || null;
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        // Gemini has no call ids — synthesize stable ones for the transcript
        id: `call_${Date.now()}_${i}`,
        name: p.functionCall.name as string,
        args: (p.functionCall.args ?? {}) as Record<string, unknown>,
      }));

    return { text, toolCalls };
  }
}
