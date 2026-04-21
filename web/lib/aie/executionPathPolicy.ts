import path from "node:path";

const REPO_ROOT = path.resolve(process.cwd(), "..");
const DISALLOWED_SEGMENTS = new Set([
  ".git",
  ".next",
  "node_modules",
  "dist",
  "build",
  "build_artifacts",
  "runner_artifacts",
  "Logs",
]);

export type AllowedExecutionPath = {
  absolutePath: string;
  relativePath: string;
  allowedRoot: string;
};

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .trim();
}

function getRepoRelativePath(absolutePath: string): string {
  return path.relative(REPO_ROOT, absolutePath).split(path.sep).join("/");
}

function isWithinRepoRoot(absolutePath: string): boolean {
  const relativePath = path.relative(REPO_ROOT, absolutePath);
  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function containsDisallowedSegment(relativePath: string): boolean {
  const segments = relativePath.split("/").filter(Boolean);
  return segments.some((segment) => DISALLOWED_SEGMENTS.has(segment) || (segment.startsWith(".") && segment !== "web"));
}

export function normalizeExecutionPath(targetPath: string): string {
  const normalizedTargetPath = normalizeText(targetPath);
  if (!normalizedTargetPath) {
    throw new Error("A target path is required.");
  }

  const absolutePath = path.isAbsolute(normalizedTargetPath)
    ? path.normalize(normalizedTargetPath)
    : path.resolve(REPO_ROOT, normalizedTargetPath);

  if (!isWithinRepoRoot(absolutePath)) {
    throw new Error("Execution paths must stay inside the repository boundary.");
  }

  const relativePath = getRepoRelativePath(absolutePath);
  if (!relativePath || containsDisallowedSegment(relativePath)) {
    throw new Error("The requested path is outside the allowed execution policy.");
  }

  return relativePath;
}

export function getDefaultAllowedExecutionRoots(): string[] {
  return ["web/app", "web/components", "web/lib", "web/tests", "web/docs", "web/sandbox"];
}

export function isPathWithinAllowedRoot(targetPath: string, allowedRoot: string): boolean {
  const normalizedTargetPath = normalizeExecutionPath(targetPath);
  const normalizedAllowedRoot = normalizeExecutionPath(allowedRoot);
  return normalizedTargetPath === normalizedAllowedRoot || normalizedTargetPath.startsWith(`${normalizedAllowedRoot}/`);
}

export function assertAllowedExecutionPath(targetPath: string, allowedRoots = getDefaultAllowedExecutionRoots()): AllowedExecutionPath {
  const normalizedTargetPath = normalizeExecutionPath(targetPath);
  const normalizedAllowedRoots = allowedRoots.map((entry) => normalizeExecutionPath(entry));
  const matchedAllowedRoot = normalizedAllowedRoots.find((allowedRoot) => isPathWithinAllowedRoot(normalizedTargetPath, allowedRoot));

  if (!matchedAllowedRoot) {
    throw new Error("The requested path is outside the approved execution roots.");
  }

  return {
    absolutePath: path.resolve(REPO_ROOT, normalizedTargetPath),
    relativePath: normalizedTargetPath,
    allowedRoot: matchedAllowedRoot,
  };
}