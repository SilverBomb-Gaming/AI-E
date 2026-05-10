import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { resolveRepoRoot } from "@/lib/aie/repoContext";

export const runtime = "nodejs";

const ALLOWED_SANDBOX_ROOTS = [
  path.join(".aie", "governed_micro_sequence_sandbox"),
  path.join(".aie", "governed_motion_preview_sandbox"),
  path.join(".aie", "governed_anime_character_preview_sandbox"),
];

function resolveAllowedAssetPath(repoRoot: string, requestedPath: string | null): string | null {
  if (!requestedPath) {
    return null;
  }

  const normalizedPath = requestedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  const absolutePath = path.resolve(repoRoot, normalizedPath);
  const allowed = ALLOWED_SANDBOX_ROOTS.some((relativeRoot) => {
    const absoluteRoot = path.resolve(repoRoot, relativeRoot);
    return absolutePath === absoluteRoot || absolutePath.startsWith(`${absoluteRoot}${path.sep}`);
  });
  if (!allowed) {
    return null;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  return [".png", ".gif", ".ppm", ".json"].includes(extension) ? absolutePath : null;
}

function contentTypeForAsset(absolutePath: string): string {
  const extension = path.extname(absolutePath).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  return "image/x-portable-pixmap";
}

export async function GET(request: Request) {
  const repoRoot = await resolveRepoRoot();
  const searchParams = new URL(request.url).searchParams;
  const absolutePath = resolveAllowedAssetPath(repoRoot, searchParams.get("path"));
  if (!absolutePath) {
    return NextResponse.json({ error: "Requested asset is outside the governed preview sandbox." }, { status: 400 });
  }

  try {
    const fileBuffer = await readFile(absolutePath);
    const headers = new Headers({
      "content-type": contentTypeForAsset(absolutePath),
      "cache-control": "no-store",
    });
    if (searchParams.get("download") === "1") {
      headers.set("content-disposition", `attachment; filename="${path.basename(absolutePath)}"`);
    }
    return new NextResponse(new Uint8Array(fileBuffer), { headers });
  } catch {
    return NextResponse.json({ error: "Requested governed preview asset is unavailable." }, { status: 404 });
  }
}