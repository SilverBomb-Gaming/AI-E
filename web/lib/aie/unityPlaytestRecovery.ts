import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { detectGameProjectRoot, inspectGameProject } from "./gameProjectInspector";

const execFileAsync = promisify(execFile);

export type UnityPlaytestRecoverySnapshot = {
  projectPath: string;
  detectedIssues: {
    accidentalGeneratedFiles: string[];
    modifiedMovementScripts: string[];
    duplicateClassRisks: string[];
  };
  recommendedActions: {
    action: "delete-file" | "restore-file" | "inspect-file";
    path: string;
    reason: string;
  }[];
  safeToResumePlaytest: boolean;
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

const ACCIDENTAL_GENERATED_FILES = [
  "Assets/PlayerController.cs",
  "Assets/PlayerController.cs.meta",
] as const;

const MONOBEHAVIOUR_METHODS = ["Awake", "Start", "Update", "FixedUpdate", "LateUpdate", "OnEnable", "OnDisable"] as const;
const DUPLICATE_ATTRIBUTES = ["DisallowMultipleComponent", "RequireComponent"] as const;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function detectRepoRoot(targetPath: string): Promise<string | null> {
  let currentPath = path.resolve(targetPath);

  while (true) {
    if (await pathExists(path.join(currentPath, ".git"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

async function queryModifiedFiles(repoRoot: string | null, candidatePaths: readonly string[]): Promise<string[]> {
  if (!repoRoot || candidatePaths.length === 0) {
    return [];
  }

  const repoRelativePaths = candidatePaths
    .map((candidatePath) => path.relative(repoRoot, candidatePath).split(path.sep).join("/"))
    .filter((candidatePath) => candidatePath.length > 0 && !candidatePath.startsWith(".."));

  if (repoRelativePaths.length === 0) {
    return [];
  }

  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--", ...repoRelativePaths], { cwd: repoRoot });
    const modified = new Set<string>();

    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }

      const relativePath = line.slice(3).trim();
      if (relativePath) {
        modified.add(relativePath.split(path.posix.sep).join("/"));
      }
    }

    return repoRelativePaths.filter((candidatePath) => modified.has(candidatePath));
  } catch {
    return [];
  }
}

async function queryTrackedFiles(repoRoot: string | null, candidatePaths: readonly string[]): Promise<string[]> {
  if (!repoRoot || candidatePaths.length === 0) {
    return [];
  }

  const tracked: string[] = [];

  for (const candidatePath of candidatePaths) {
    const repoRelativePath = path.relative(repoRoot, candidatePath).split(path.sep).join("/");
    if (!repoRelativePath || repoRelativePath.startsWith("..")) {
      continue;
    }

    try {
      await execFileAsync("git", ["ls-files", "--error-unmatch", repoRelativePath], { cwd: repoRoot });
      tracked.push(candidatePath);
    } catch {
      continue;
    }
  }

  return tracked;
}

function collectClassNames(source: string): string[] {
  return Array.from(source.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g), (match) => match[1] ?? "").filter(Boolean);
}

function duplicateMethodRisks(relativePath: string, source: string): string[] {
  const risks: string[] = [];

  for (const methodName of MONOBEHAVIOUR_METHODS) {
    const matches = source.match(new RegExp(`\\b${methodName}\\s*\\(`, "g")) ?? [];
    if (matches.length > 1) {
      risks.push(`${relativePath}: duplicate MonoBehaviour method ${methodName}`);
    }
  }

  return risks;
}

function duplicateAttributeRisks(relativePath: string, source: string): string[] {
  const risks: string[] = [];

  for (const attributeName of DUPLICATE_ATTRIBUTES) {
    const matches = source.match(new RegExp(`\\[\\s*${attributeName}\\b`, "g")) ?? [];
    if (matches.length > 1) {
      risks.push(`${relativePath}: duplicate attribute ${attributeName}`);
    }
  }

  return risks;
}

export async function inspectUnityPlaytestRecovery(targetPath: string): Promise<UnityPlaytestRecoverySnapshot> {
  const projectRoot = await detectGameProjectRoot(targetPath);
  const snapshot = await inspectGameProject(projectRoot);
  const repoRoot = await detectRepoRoot(projectRoot);
  const accidentalGeneratedFiles: string[] = [];

  for (const relativePath of ACCIDENTAL_GENERATED_FILES) {
    if (await pathExists(path.join(projectRoot, relativePath))) {
      accidentalGeneratedFiles.push(relativePath);
    }
  }

  const movementScriptAbsolutePaths = snapshot.analysis.scriptSignals.movementScripts
    .filter((relativePath) => !accidentalGeneratedFiles.includes(relativePath as typeof ACCIDENTAL_GENERATED_FILES[number]))
    .map((relativePath) => path.join(projectRoot, relativePath));
  const trackedMovementScriptAbsolutePaths = await queryTrackedFiles(repoRoot, movementScriptAbsolutePaths);
  const modifiedMovementScriptPaths = await queryModifiedFiles(repoRoot, trackedMovementScriptAbsolutePaths);
  const modifiedMovementScripts = modifiedMovementScriptPaths.map((repoRelativePath) => path.relative(projectRoot, path.join(repoRoot ?? projectRoot, repoRelativePath)).split(path.sep).join("/"));

  const candidateRelativePaths = Array.from(new Set([
    ...snapshot.analysis.scriptSignals.movementScripts,
    ...accidentalGeneratedFiles,
  ])).sort((left, right) => left.localeCompare(right));

  const classToPaths = new Map<string, string[]>();
  const duplicateClassRisks: string[] = [];

  for (const relativePath of candidateRelativePaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    if (!(await pathExists(absolutePath)) || !relativePath.endsWith(".cs")) {
      continue;
    }

    const source = await readFile(absolutePath, "utf-8");
    for (const className of collectClassNames(source)) {
      const existingPaths = classToPaths.get(className) ?? [];
      existingPaths.push(relativePath);
      classToPaths.set(className, existingPaths);
    }

    duplicateClassRisks.push(...duplicateMethodRisks(relativePath, source));
    duplicateClassRisks.push(...duplicateAttributeRisks(relativePath, source));
  }

  for (const [className, filePaths] of classToPaths.entries()) {
    if (filePaths.length > 1) {
      duplicateClassRisks.push(`duplicate class ${className}: ${filePaths.join(" and ")}`);
    }
  }

  const recommendedActions: UnityPlaytestRecoverySnapshot["recommendedActions"] = [
    ...accidentalGeneratedFiles.map((relativePath) => ({
      action: "delete-file" as const,
      path: relativePath,
      reason: "Accidental generated playtest artifact detected.",
    })),
    ...modifiedMovementScripts.map((relativePath) => ({
      action: "restore-file" as const,
      path: relativePath,
      reason: "Tracked movement script differs from git and should be restored before another playtest.",
    })),
  ];

  for (const relativePath of snapshot.analysis.scriptSignals.movementScripts) {
    if (!recommendedActions.some((action) => action.path === relativePath)) {
      recommendedActions.push({
        action: "inspect-file",
        path: relativePath,
        reason: "Movement script should be inspected before another generated gameplay task is applied.",
      });
      break;
    }
  }

  const safeToResumePlaytest = accidentalGeneratedFiles.length === 0 && modifiedMovementScripts.length === 0 && duplicateClassRisks.length === 0;

  return {
    projectPath: projectRoot,
    detectedIssues: {
      accidentalGeneratedFiles,
      modifiedMovementScripts,
      duplicateClassRisks,
    },
    recommendedActions,
    safeToResumePlaytest,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export function renderUnityPlaytestRecovery(snapshot: UnityPlaytestRecoverySnapshot, repoRoot?: string): string {
  const lines = [
    "UNITY PLAYTEST RECOVERY",
    "",
    `Safe to Resume: ${snapshot.safeToResumePlaytest ? "YES" : "NO"}`,
    "",
    "Detected Issues:",
  ];

  if (snapshot.detectedIssues.accidentalGeneratedFiles.length === 0
    && snapshot.detectedIssues.modifiedMovementScripts.length === 0
    && snapshot.detectedIssues.duplicateClassRisks.length === 0) {
    lines.push("- none");
  } else {
    for (const filePath of snapshot.detectedIssues.accidentalGeneratedFiles) {
      lines.push(`- Accidental file: ${filePath}`);
    }
    for (const filePath of snapshot.detectedIssues.modifiedMovementScripts) {
      lines.push(`- Movement script may need restore: ${filePath}`);
    }
    for (const risk of snapshot.detectedIssues.duplicateClassRisks) {
      lines.push(`- Compile risk: ${risk}`);
    }
  }

  lines.push("", "Recommended Recovery:");
  if (snapshot.recommendedActions.length === 0) {
    lines.push("1. No recovery actions required.");
  } else {
    snapshot.recommendedActions.forEach((action, index) => {
      const verb = action.action === "delete-file"
        ? "Delete accidental generated file"
        : action.action === "restore-file"
          ? "Restore tracked movement script"
          : "Inspect movement script";
      lines.push(`${index + 1}. ${verb}: ${action.path} (${action.reason})`);
    });
    lines.push(`${snapshot.recommendedActions.length + 1}. Wait for Unity compile errors to clear`);
    lines.push(`${snapshot.recommendedActions.length + 2}. Re-run game task generator`);
  }

  lines.push("", "REVIEW BEFORE RUNNING:");
  for (const action of snapshot.recommendedActions) {
    const commandPath = repoRoot
      ? path.relative(repoRoot, path.join(snapshot.projectPath, action.path)).split(path.sep).join("/")
      : action.path;

    if (action.action === "delete-file") {
      lines.push(`Remove-Item "${commandPath}"`);
      continue;
    }

    if (action.action === "restore-file") {
      lines.push(`git checkout -- "${commandPath}"`);
      continue;
    }

    lines.push(`# Inspect file before editing: ${commandPath}`);
  }

  lines.push("", "Safety:", "- read-only inspection only", "- no Unity execution", "- playtesting blocked until safe");
  return lines.join("\n");
}