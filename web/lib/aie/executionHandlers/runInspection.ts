import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ExecutionActionPreview, ExecutionRuntimeResult } from "../types";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const MAX_SCAN_ENTRIES = 500;
const MAX_MATCHES = 6;
const MAX_PREVIEW_BYTES = 1600;
const MAX_PREVIEW_FILES = 3;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "node_modules",
  "build",
  "build_artifacts",
  "runner_artifacts",
  "Logs",
]);
const TEXT_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".py",
  ".ps1",
  ".mjs",
  ".cjs",
  ".css",
]);
const STOP_WORDS = new Set([
  "this",
  "that",
  "with",
  "from",
  "into",
  "only",
  "safe",
  "step",
  "same",
  "bounded",
  "compare",
  "before",
  "after",
  "whether",
  "should",
  "around",
  "during",
  "under",
  "through",
  "current",
  "targeted",
  "issue",
  "cause",
  "confirm",
  "validate",
  "check",
  "inspection",
  "run",
  "read",
  "review",
]);

type InspectionMatch = {
  absolutePath: string;
  relativePath: string;
  kind: "file" | "directory";
};

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toRelativePath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function isWithinRepo(absolutePath: string): boolean {
  const relative = path.relative(REPO_ROOT, absolutePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function extractKeywords(action: ExecutionActionPreview): string[] {
  const combined = [action.description, action.expectedOutcome, action.metadata?.context]
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const tokens = combined.match(/[a-z][a-z0-9_-]{3,}/g) ?? [];
  return [...new Set(tokens.filter((token) => !STOP_WORDS.has(token)).slice(0, 8))];
}

function extractExplicitPathTokens(action: ExecutionActionPreview): string[] {
  const combined = [action.description, action.expectedOutcome, action.metadata?.context]
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join(" ");

  const matches = combined.match(/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+/g) ?? [];
  return [...new Set(matches.map((token) => token.replace(/[.,;:]+$/g, "").trim()))];
}

async function resolveExplicitMatches(tokens: string[]): Promise<InspectionMatch[]> {
  const matches: InspectionMatch[] = [];

  for (const token of tokens) {
    const absolutePath = path.isAbsolute(token) ? token : path.resolve(REPO_ROOT, token);
    if (!isWithinRepo(absolutePath)) {
      continue;
    }

    try {
      const targetStats = await stat(absolutePath);
      matches.push({
        absolutePath,
        relativePath: toRelativePath(absolutePath),
        kind: targetStats.isDirectory() ? "directory" : "file",
      });
    } catch {
      // Ignore explicit paths that do not exist inside the bounded repo root.
    }
  }

  return matches.slice(0, MAX_MATCHES);
}

async function scanWorkspaceForKeywordMatches(keywords: string[]): Promise<InspectionMatch[]> {
  if (keywords.length === 0) {
    return [];
  }

  const matches: InspectionMatch[] = [];
  let scannedEntries = 0;
  const queue = [REPO_ROOT];

  while (queue.length > 0 && scannedEntries < MAX_SCAN_ENTRIES && matches.length < MAX_MATCHES) {
    const currentDirectory = queue.shift();
    if (!currentDirectory) {
      break;
    }

    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      scannedEntries += 1;
      if (scannedEntries > MAX_SCAN_ENTRIES || matches.length >= MAX_MATCHES) {
        break;
      }

      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = toRelativePath(absolutePath);
      const lowerRelativePath = relativePath.toLowerCase();
      const keywordMatched = keywords.some((keyword) => lowerRelativePath.includes(keyword));

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }

        if (keywordMatched) {
          matches.push({ absolutePath, relativePath, kind: "directory" });
        }
        continue;
      }

      if (keywordMatched) {
        matches.push({ absolutePath, relativePath, kind: "file" });
      }
    }
  }

  return matches.slice(0, MAX_MATCHES);
}

async function readPreview(relativePath: string): Promise<string | null> {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!isWithinRepo(absolutePath) || !TEXT_FILE_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
    return null;
  }

  try {
    const contents = await readFile(absolutePath, "utf8");
    const preview = contents
      .slice(0, MAX_PREVIEW_BYTES)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join(" | ");

    return preview || null;
  } catch {
    return null;
  }
}

function dedupeMatches(matches: InspectionMatch[]): InspectionMatch[] {
  const seen = new Set<string>();
  return matches.filter((match) => {
    if (seen.has(match.relativePath)) {
      return false;
    }

    seen.add(match.relativePath);
    return true;
  });
}

export async function runInspection(action: ExecutionActionPreview): Promise<ExecutionRuntimeResult> {
  const explicitMatches = await resolveExplicitMatches(extractExplicitPathTokens(action));
  const keywordMatches = await scanWorkspaceForKeywordMatches(extractKeywords(action));
  const matches = dedupeMatches([...explicitMatches, ...keywordMatches]).slice(0, MAX_MATCHES);
  const previewableMatches = matches.filter((match) => match.kind === "file").slice(0, MAX_PREVIEW_FILES);
  const previews = await Promise.all(
    previewableMatches.map(async (match) => ({
      relativePath: match.relativePath,
      preview: await readPreview(match.relativePath),
    })),
  );

  const outputLines = [
    "Inspection completed in read-only mode.",
    `Requested step: ${normalizeText(action.description)}`,
    `Workspace root: ${path.basename(REPO_ROOT)}`,
  ];

  if (matches.length > 0) {
    outputLines.push("Filesystem findings:");
    for (const match of matches) {
      outputLines.push(`- ${match.relativePath} (${match.kind})`);
    }
  } else {
    outputLines.push("No safe filesystem targets matched the inspection request.");
  }

  const previewLines = previews
    .filter((item) => item.preview)
    .map((item) => `- ${item.relativePath}: ${item.preview}`);
  if (previewLines.length > 0) {
    outputLines.push("File previews:");
    outputLines.push(...previewLines);
  }

  outputLines.push("No files were modified and no shell commands were executed.");

  if (matches.length === 0) {
    return {
      status: "blocked",
      output: outputLines.join("\n"),
      error: "No safe filesystem targets matched this inspection step.",
    };
  }

  return {
    status: "success",
    output: outputLines.join("\n"),
  };
}