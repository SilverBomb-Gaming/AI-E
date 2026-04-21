import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertAllowedExecutionPath } from "../executionPathPolicy";
import { createRestoreFileRollback, rememberRollbackSnapshot } from "../executionRollback";
import type { ExecutionActionPreview, ExecutionRuntimeResult } from "../types";

type RunFileWriteDependencies = {
  allowedRoots?: string[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeDiff(previousContent: string | null, nextContent: string): string {
  const previousLines = (previousContent ?? "").split(/\r?\n/);
  const nextLines = nextContent.split(/\r?\n/);
  const previousLineCount = previousContent === null ? 0 : previousLines.length;
  const nextLineCount = nextLines.length;
  return previousContent === null
    ? `Created new file with ${nextLineCount} lines.`
    : `Replaced file contents (${previousLineCount} lines -> ${nextLineCount} lines).`;
}

function getTargetPath(action: ExecutionActionPreview): string {
  const targetPath = normalizeText(action.metadata.targetPath);
  if (!targetPath) {
    throw new Error("A bounded file write requires a targetPath.");
  }

  return targetPath;
}

function getAllowedRoots(action: ExecutionActionPreview, dependencies?: RunFileWriteDependencies): string[] | undefined {
  if (dependencies?.allowedRoots?.length) {
    return dependencies.allowedRoots;
  }

  const allowedRoot = normalizeText(action.metadata.allowedRoot);
  return allowedRoot ? [allowedRoot] : undefined;
}

function getContent(action: ExecutionActionPreview): string {
  if (typeof action.metadata.content === "string") {
    return action.metadata.content;
  }

  throw new Error("A bounded file write requires complete file content in metadata.content.");
}

export async function runFileWrite(
  action: ExecutionActionPreview,
  dependencies?: RunFileWriteDependencies,
): Promise<ExecutionRuntimeResult> {
  try {
    if (typeof action.metadata.patch === "string" && !action.metadata.content) {
      return {
        status: "blocked",
        error: "patch-only writes are not enabled in Phase 4B",
        output: "AI-E blocked this file write because Phase 4B only supports bounded whole-file content writes unless content is already fully materialized.",
      };
    }

    const targetPath = getTargetPath(action);
    const allowedPath = assertAllowedExecutionPath(targetPath, getAllowedRoots(action, dependencies));
    const nextContent = getContent(action);
    const parentDirectory = path.dirname(allowedPath.absolutePath);

    let previousContent: string | null = null;
    try {
      const fileStats = await stat(allowedPath.absolutePath);
      if (fileStats.isFile()) {
        previousContent = await readFile(allowedPath.absolutePath, "utf8");
      }
    } catch {
      previousContent = null;
    }

    await mkdir(parentDirectory, { recursive: true });
    await writeFile(allowedPath.absolutePath, nextContent, "utf8");

    const rollback = previousContent !== null
      ? createRestoreFileRollback(allowedPath.relativePath, previousContent)
      : undefined;
    if (rollback) {
      rememberRollbackSnapshot(rollback);
    }

    return {
      status: "success",
      output: [
        "Bounded file write applied.",
        `Target path: ${allowedPath.relativePath}`,
        `Allowed root: ${allowedPath.allowedRoot}`,
        rollback ? "Rollback snapshot captured for the previous file contents." : "No rollback snapshot was captured because this created a new file.",
      ].join("\n"),
      changedPaths: [allowedPath.relativePath],
      diffSummary: summarizeDiff(previousContent, nextContent),
      rollback,
    };
  } catch (error) {
    return {
      status: "blocked",
      error: error instanceof Error ? error.message : "The bounded file write failed.",
      output: "AI-E blocked this file write because it fell outside the approved file-write policy.",
    };
  }
}