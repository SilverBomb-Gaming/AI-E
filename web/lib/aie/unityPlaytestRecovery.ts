import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { detectGameProjectRoot, inspectGameProject } from "./gameProjectInspector";

const execFileAsync = promisify(execFile);

export type UnityRecoveryAction = {
  action:
    | "delete-file"
    | "restore-file"
    | "inspect-file"
    | "move-folder-outside-assets"
    | "add-asmdef-exclusion"
    | "add-compatibility-stubs";
  path: string;
  reason: string;
  destinationPath?: string;
};

export type LegacyCompileRecoverySnapshot = {
  projectPath: string;
  legacyScriptsDetected: string[];
  compileRiskFiles: string[];
  compatibilityIssues: string[];
  recommendedActions: UnityRecoveryAction[];
  playtestBlocked: boolean;
  preferredRecoveryTarget?: string;
  safety: {
    readOnly: true;
    noUnityExecution: true;
  };
};

export type UnityPlaytestRecoverySnapshot = {
  projectPath: string;
  detectedIssues: {
    accidentalGeneratedFiles: string[];
    modifiedMovementScripts: string[];
    duplicateClassRisks: string[];
    legacyCompileRiskFiles: string[];
    legacyCompileCompatibilityIssues: string[];
  };
  recommendedActions: UnityRecoveryAction[];
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
const LEGACY_FOLDER_RELATIVE_PATH = "Assets/_LEGACY_DO_NOT_TOUCH";
const LEGACY_RECOVERY_TARGET_ROOT = "_LegacyOutsideUnity";
const LEGACY_REQUIRED_CALLBACKS = ["OnThrowLethal", "OnThrowTactical"] as const;

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

async function collectRelativeFiles(rootPath: string, relativeDirectoryPath: string): Promise<string[]> {
  const absoluteDirectoryPath = path.join(rootPath, relativeDirectoryPath);
  if (!(await pathExists(absoluteDirectoryPath))) {
    return [];
  }

  const results: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      results.push(path.relative(rootPath, entryPath).split(path.sep).join("/"));
    }
  }

  await walk(absoluteDirectoryPath);
  return results.sort((left, right) => left.localeCompare(right));
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

function detectLegacyCompatibilityIssues(relativePath: string, source: string): string[] {
  const issues: string[] = [];
  const looksLikeInputActionConsumer = source.includes("InputAction.CallbackContext")
    || source.includes("using UnityEngine.InputSystem")
    || source.includes("PlayerInput")
    || /class\s+PlayerController\b/.test(source);

  if (!looksLikeInputActionConsumer) {
    return issues;
  }

  for (const callbackName of LEGACY_REQUIRED_CALLBACKS) {
    if (!new RegExp(`\\b${callbackName}\\s*\\(\\s*InputAction\\.CallbackContext`).test(source)) {
      issues.push(`${relativePath}: missing ${callbackName}(InputAction.CallbackContext) compatibility callback.`);
    }
  }

  return issues;
}

function buildLegacyRecoveryTarget(relativePath: string): string {
  const suffix = relativePath.slice(LEGACY_FOLDER_RELATIVE_PATH.length).replace(/^\/+/, "");
  return [LEGACY_RECOVERY_TARGET_ROOT, path.basename(LEGACY_FOLDER_RELATIVE_PATH), suffix].filter(Boolean).join("/");
}

export async function inspectLegacyCompileRecovery(targetPath: string): Promise<LegacyCompileRecoverySnapshot> {
  const projectRoot = await detectGameProjectRoot(targetPath);
  const legacyFiles = await collectRelativeFiles(projectRoot, LEGACY_FOLDER_RELATIVE_PATH);
  const legacyScriptsDetected = legacyFiles.filter((relativePath) => relativePath.endsWith(".cs"));
  const compileRiskFiles = [...legacyScriptsDetected];
  const compatibilityIssues: string[] = [];

  for (const relativePath of legacyScriptsDetected) {
    const source = await readFile(path.join(projectRoot, relativePath), "utf-8");
    compatibilityIssues.push(...detectLegacyCompatibilityIssues(relativePath, source));
  }

  const recommendedActions: UnityRecoveryAction[] = [];
  if (legacyScriptsDetected.length > 0) {
    recommendedActions.push({
      action: "move-folder-outside-assets",
      path: LEGACY_FOLDER_RELATIVE_PATH,
      destinationPath: buildLegacyRecoveryTarget(LEGACY_FOLDER_RELATIVE_PATH),
      reason: "Preferred safe default: move legacy scripts outside Unity's Assets compilation path so current playtests are not blocked.",
    });
    recommendedActions.push({
      action: "add-asmdef-exclusion",
      path: LEGACY_FOLDER_RELATIVE_PATH,
      reason: "If the legacy folder must remain near the project, isolate it with an assembly definition exclusion so Unity does not compile it into the active gameplay assembly.",
    });
  }

  if (compatibilityIssues.length > 0) {
    recommendedActions.push({
      action: "add-compatibility-stubs",
      path: legacyScriptsDetected[0] ?? LEGACY_FOLDER_RELATIVE_PATH,
      reason: "Only if the legacy script is intentionally active: add safe compatibility stubs for the expected callbacks instead of editing current gameplay systems.",
    });
  }

  return {
    projectPath: projectRoot,
    legacyScriptsDetected,
    compileRiskFiles,
    compatibilityIssues,
    recommendedActions,
    playtestBlocked: compileRiskFiles.length > 0 || compatibilityIssues.length > 0,
    preferredRecoveryTarget: legacyScriptsDetected.length > 0 ? buildLegacyRecoveryTarget(LEGACY_FOLDER_RELATIVE_PATH) : undefined,
    safety: {
      readOnly: true,
      noUnityExecution: true,
    },
  };
}

export async function inspectUnityPlaytestRecovery(targetPath: string): Promise<UnityPlaytestRecoverySnapshot> {
  const projectRoot = await detectGameProjectRoot(targetPath);
  const snapshot = await inspectGameProject(projectRoot);
  const repoRoot = await detectRepoRoot(projectRoot);
  const legacyCompileRecovery = await inspectLegacyCompileRecovery(projectRoot);
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

  for (const action of legacyCompileRecovery.recommendedActions) {
    if (!recommendedActions.some((candidate) => candidate.action === action.action && candidate.path === action.path)) {
      recommendedActions.push(action);
    }
  }

  const safeToResumePlaytest = accidentalGeneratedFiles.length === 0
    && modifiedMovementScripts.length === 0
    && duplicateClassRisks.length === 0
    && !legacyCompileRecovery.playtestBlocked;

  return {
    projectPath: projectRoot,
    detectedIssues: {
      accidentalGeneratedFiles,
      modifiedMovementScripts,
      duplicateClassRisks,
      legacyCompileRiskFiles: legacyCompileRecovery.compileRiskFiles,
      legacyCompileCompatibilityIssues: legacyCompileRecovery.compatibilityIssues,
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
    && snapshot.detectedIssues.duplicateClassRisks.length === 0
    && snapshot.detectedIssues.legacyCompileRiskFiles.length === 0
    && snapshot.detectedIssues.legacyCompileCompatibilityIssues.length === 0) {
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
    for (const filePath of snapshot.detectedIssues.legacyCompileRiskFiles) {
      lines.push(`- Legacy compile risk: ${filePath}`);
    }
    for (const issue of snapshot.detectedIssues.legacyCompileCompatibilityIssues) {
      lines.push(`- Legacy compatibility issue: ${issue}`);
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
          : action.action === "move-folder-outside-assets"
            ? "Move legacy folder outside Assets"
            : action.action === "add-asmdef-exclusion"
              ? "Add asmdef exclusion strategy"
              : action.action === "add-compatibility-stubs"
                ? "Add compatibility stubs only if intentionally active"
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

    if (action.action === "move-folder-outside-assets") {
      const destinationPath = action.destinationPath ?? buildLegacyRecoveryTarget(action.path);
      lines.push(`Move-Item "${commandPath}" "${destinationPath}"`);
      continue;
    }

    if (action.action === "add-asmdef-exclusion") {
      lines.push(`# Add asmdef exclusion for: ${commandPath}`);
      continue;
    }

    if (action.action === "add-compatibility-stubs") {
      lines.push(`# Only if intentionally active, add compatibility stubs in: ${commandPath}`);
      continue;
    }

    lines.push(`# Inspect file before editing: ${commandPath}`);
  }

  lines.push("", "Safety:", "- read-only inspection only", "- no Unity execution", "- playtesting blocked until safe");
  return lines.join("\n");
}

export function renderLegacyCompileRecovery(snapshot: LegacyCompileRecoverySnapshot, repoRoot?: string): string {
  const lines = [
    "LEGACY COMPILE RECOVERY",
    "",
    `Playtest Blocked: ${snapshot.playtestBlocked ? "YES" : "NO"}`,
    `Preferred Recovery Target: ${snapshot.preferredRecoveryTarget ?? "n/a"}`,
    "",
    "Legacy Scripts Detected:",
  ];

  if (snapshot.legacyScriptsDetected.length === 0) {
    lines.push("- none");
  } else {
    snapshot.legacyScriptsDetected.forEach((filePath) => lines.push(`- ${filePath}`));
  }

  lines.push("", "Compile-Risk Files:");
  if (snapshot.compileRiskFiles.length === 0) {
    lines.push("- none");
  } else {
    snapshot.compileRiskFiles.forEach((filePath) => lines.push(`- ${filePath}`));
  }

  lines.push("", "Compatibility Issues:");
  if (snapshot.compatibilityIssues.length === 0) {
    lines.push("- none detected");
  } else {
    snapshot.compatibilityIssues.forEach((issue) => lines.push(`- ${issue}`));
  }

  lines.push("", "Recommended Safe Recovery:");
  if (snapshot.recommendedActions.length === 0) {
    lines.push("1. No legacy compile recovery required.");
  } else {
    snapshot.recommendedActions.forEach((action, index) => {
      const suffix = action.destinationPath ? ` -> ${action.destinationPath}` : "";
      lines.push(`${index + 1}. ${action.reason} (${action.path}${suffix})`);
    });
  }

  lines.push("", "REVIEW BEFORE RUNNING:");
  for (const action of snapshot.recommendedActions) {
    const commandPath = repoRoot
      ? path.relative(repoRoot, path.join(snapshot.projectPath, action.path)).split(path.sep).join("/")
      : action.path;
    if (action.action === "move-folder-outside-assets") {
      lines.push(`Move-Item "${commandPath}" "${action.destinationPath ?? buildLegacyRecoveryTarget(action.path)}"`);
      continue;
    }
    if (action.action === "add-asmdef-exclusion") {
      lines.push(`# Add asmdef exclusion for: ${commandPath}`);
      continue;
    }
    if (action.action === "add-compatibility-stubs") {
      lines.push(`# Only if intentionally active, add compatibility stubs in: ${commandPath}`);
      continue;
    }
    lines.push(`# Inspect legacy path: ${commandPath}`);
  }

  lines.push("", "Safety:", "- read-only inspection only", "- no Unity execution", "- do not resume playtest until compile blockers are cleared");
  return lines.join("\n");
}