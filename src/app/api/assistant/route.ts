import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOrgId } from "@/lib/org";
import { getLLM, type ChatMessage, type ToolResult } from "@/lib/llm";
import { buildSystemPrompt, ASSISTANT_TOOLS, executeAssistantTool } from "@/lib/assistant";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TOOL_ROUNDS = 6;
const MAX_MESSAGE_CHARS = 2000;

/**
 * Conversational PR assistant — agent loop.
 * POST { conversation_id?, message } →
 *      { conversation_id, reply, pr_created?: { pr_number } }
 *
 * Public like the PR form (shop-floor engineers, no login). History persists
 * in Supabase so a conversation survives page reloads and patchy networks.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const userText = String(body?.message ?? "").trim();
    if (!userText) return NextResponse.json({ error: "Say something first." }, { status: 400 });
    if (userText.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: "Message too long — keep it under 2000 characters." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;
    const orgId = await getOrgId(); // install org for this public assistant

    // conversation: load or create (org-scoped)
    let conversationId: string = body?.conversation_id ?? "";
    let history: ChatMessage[] = [];
    if (conversationId) {
      const { data: rows } = await supabase
        .from("assistant_messages")
        .select("content")
        .eq("conversation_id", conversationId)
        .eq("org_id", orgId)
        .order("created_at");
      history = (rows ?? []).map((r) => r.content as ChatMessage);
    } else {
      const { data: conv, error } = await supabase
        .from("assistant_conversations").insert({ org_id: orgId }).select().single();
      if (error || !conv) return NextResponse.json({ error: "Could not start conversation." }, { status: 500 });
      conversationId = conv.id;
    }

    const { data: costCenters } = await supabase
      .from("cost_centers").select("code, name").eq("org_id", orgId).eq("active", true).order("code");
    const system = buildSystemPrompt(costCenters ?? []);

    const llm = getLLM();
    const messages: ChatMessage[] = [...history, { role: "user", content: userText }];
    const newMessages: ChatMessage[] = [{ role: "user", content: userText }];
    let prCreated: { pr_number: string; pr_id: string } | null = null;
    let reply = "";

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const res = await llm.chat({ system, messages, tools: ASSISTANT_TOOLS });

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: res.text ?? undefined,
        toolCalls: res.toolCalls.length ? res.toolCalls : undefined,
      };
      messages.push(assistantMsg);
      newMessages.push(assistantMsg);

      if (res.toolCalls.length === 0) {
        reply = res.text ?? "";
        break;
      }

      const toolResults: ToolResult[] = [];
      for (const call of res.toolCalls) {
        const result = await executeAssistantTool(supabase, origin, call.name, call.args);
        toolResults.push({ id: call.id, name: call.name, result });
        if (call.name === "submit_purchase_request" && (result as any)?.ok) {
          prCreated = { pr_number: (result as any).pr_number, pr_id: (result as any).pr_id };
        }
      }
      const toolMsg: ChatMessage = { role: "user", toolResults };
      messages.push(toolMsg);
      newMessages.push(toolMsg);

      if (round === MAX_TOOL_ROUNDS) {
        reply = res.text ?? "I hit a snag processing that — try rephrasing.";
      }
    }

    // persist the new turns + link the PR if one was created
    await supabase.from("assistant_messages").insert(
      newMessages.map((m) => ({ org_id: orgId, conversation_id: conversationId, role: m.role, content: m }))
    );
    if (prCreated) {
      await supabase
        .from("assistant_conversations")
        .update({ status: "completed", pr_id: prCreated.pr_id })
        .eq("id", conversationId);
    }

    return NextResponse.json({
      conversation_id: conversationId,
      reply,
      pr_created: prCreated ? { pr_number: prCreated.pr_number } : undefined,
    });
  } catch (err) {
    console.error("Assistant error:", err);
    const msg = err instanceof Error && /API key|not configured/i.test(err.message)
      ? "The assistant is not configured yet (missing AI API key)."
      : "Something went wrong. Try again.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
