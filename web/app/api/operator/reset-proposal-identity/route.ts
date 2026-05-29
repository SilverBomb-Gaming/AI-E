import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

async function findReceiptsDir(sandboxId: string): Promise<string | null> {
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "..", "..")];
  for (const c of candidates) {
    const candidate = path.join(c, ".ai-e", "sandboxes", sandboxId, "receipts");
    if (fs.existsSync(candidate)) return candidate;
  }
  // fallback: use repo root (one level up) even if receipts missing
  const fallback = path.join(cwd, "..", ".ai-e", "sandboxes", sandboxId, "receipts");
  return fallback;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const src = body as Record<string, unknown>;
  const sandboxId = typeof src.sandboxId === "string" && src.sandboxId ? src.sandboxId : "sandbox-EXEC-0052-H-execution";

  try {
    const receiptsDir = await findReceiptsDir(sandboxId);
    if (!receiptsDir) throw new Error("Could not locate receipts directory for sandbox.");
    // ensure directory exists
    fs.mkdirSync(receiptsDir, { recursive: true });
    const markerPath = path.join(receiptsDir, "reset-proposal-identity.marker");
    const content = JSON.stringify({ resetAt: new Date().toISOString(), operator: "operator" }, null, 2);
    fs.writeFileSync(markerPath, content, { encoding: "utf8" });
    return NextResponse.json({ ok: true, path: markerPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/operator/reset-proposal-identity] error", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
