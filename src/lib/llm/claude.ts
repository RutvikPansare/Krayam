import Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, LLMProvider, LLMResponse, ToolDefinition } from "./types";

/**
 * Claude provider — official Anthropic SDK.
 *
 * Env:
 *   ANTHROPIC_API_KEY
 *   CLAUDE_MODEL   (default claude-opus-4-8; claude-sonnet-4-6 is a good
 *                   cheaper option for this assistant)
 *
 * Activate with LLM_PROVIDER=claude — no code change needed.
 */

function toClaudeMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m): Anthropic.MessageParam => {
    if (m.role === "assistant") {
      const content: Anthropic.ContentBlockParam[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
      }
      return { role: "assistant", content };
    }
    const content: Anthropic.ContentBlockParam[] = [];
    for (const tr of m.toolResults ?? []) {
      content.push({ type: "tool_result", tool_use_id: tr.id, content: JSON.stringify(tr.result) });
    }
    if (m.content) content.push({ type: "text", text: m.content });
    return { role: "user", content };
  });
}

export class ClaudeProvider implements LLMProvider {
  readonly name = "claude";

  async chat(opts: { system: string; messages: ChatMessage[]; tools: ToolDefinition[] }): Promise<LLMResponse> {
    const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
    const model = process.env.CLAUDE_MODEL || "claude-opus-4-8";

    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: opts.system,
      messages: toClaudeMessages(opts.messages),
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      })),
    });

    let text: string | null = null;
    const toolCalls = [];
    for (const block of response.content) {
      if (block.type === "text") text = (text ?? "") + block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, name: block.name, args: block.input as Record<string, unknown> });
      }
    }
    return { text, toolCalls };
  }
}
