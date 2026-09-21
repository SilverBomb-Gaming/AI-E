import { NextResponse } from "next/server";

import { runSpineChat } from "@/lib/aie/spine/chat";
import { resolveChatMode } from "@/lib/aie/spine/mode";
import { SPINE_TOOLS } from "@/lib/aie/spine/tools";
import type { ChatMessage } from "@/lib/aie/spine/types";

export const runtime = "nodejs";

const SAFE_ERROR = "The demo spine could not complete that turn. Please try again.";

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const source = entry as Record<string, unknown>;
      const role = source.role === "assistant" ? "assistant" : source.role === "user" ? "user" : null;
      const content = typeof source.content === "string" ? source.content.trim() : "";
      if (!role || !content) {
        return null;
      }
      return { role, content } satisfies ChatMessage;
    })
    .filter((entry): entry is ChatMessage => entry !== null)
    .slice(-12);
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: resolveChatMode(),
    tools: SPINE_TOOLS,
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { messages?: unknown };
    const messages = normalizeMessages(body.messages);
    if (messages.length === 0) {
      return NextResponse.json({ error: "Send at least one chat message." }, { status: 400 });
    }

    const result = await runSpineChat(messages);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[api/chat] failed", error);
    return NextResponse.json({ error: SAFE_ERROR }, { status: 500 });
  }
}
