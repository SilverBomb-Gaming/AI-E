import { NextResponse } from "next/server";

import { isLlmConfigured, resolveChatMode } from "@/lib/aie/spine/mode";
import { SPINE_TOOLS } from "@/lib/aie/spine/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    mode: resolveChatMode(),
    llmConfigured: isLlmConfigured(),
    tools: SPINE_TOOLS,
  });
}
