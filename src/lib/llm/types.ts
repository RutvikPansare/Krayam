/**
 * Provider-agnostic LLM interface for the conversational PR assistant.
 *
 * The agent loop (src/app/api/assistant) is written against these types only.
 * Swapping Gemini ↔ Claude is one env var (LLM_PROVIDER=gemini|claude) —
 * each provider adapts these shapes to its own wire format.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool's input */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  id: string;        // matches ToolCall.id
  name: string;
  result: unknown;   // JSON-serializable
}

/**
 * One conversation turn.
 * - user turn: content set, toolResults set when answering the model's tool calls
 * - assistant turn: content and/or toolCalls set
 */
export interface ChatMessage {
  role: "user" | "assistant";
  content?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface LLMResponse {
  text: string | null;
  toolCalls: ToolCall[];
}

export interface LLMProvider {
  readonly name: string;
  chat(opts: {
    system: string;
    messages: ChatMessage[];
    tools: ToolDefinition[];
  }): Promise<LLMResponse>;
}
