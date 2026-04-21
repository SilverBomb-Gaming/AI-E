import { NextResponse } from "next/server";

import { createRuntimeExecutionNodeDescriptor } from "@/lib/aie/executionNode";
import { listExecutionNodes } from "@/lib/aie/executionNodeRegistry";
import { registerExecutionNode } from "@/lib/aie/executionNodeRegistry";

export const runtime = "nodejs";

export async function GET() {
  try {
    const existingNodes = listExecutionNodes();
    const nodes = existingNodes.length
      ? existingNodes
      : [registerExecutionNode(createRuntimeExecutionNodeDescriptor({
          runtimeMode: "web",
          cwd: process.cwd(),
        }))];

    return NextResponse.json({ nodes });
  } catch (error) {
    console.error("[api/autonomous/nodes] list failed", error);
    return NextResponse.json({ error: "We couldn't load registered execution nodes right now." }, { status: 500 });
  }
}