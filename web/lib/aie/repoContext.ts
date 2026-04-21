import { readdir, stat } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  "node_modules",
  "build",
  "build_artifacts",
  "runner_artifacts",
  "Logs",
]);

const RELEVANT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".py",
  ".ps1",
  ".mjs",
  ".cjs",
  ".css",
]);

const TEST_FILE_PATTERN = /(?:^|\/|\\)[^/\\]+\.(?:test|spec)\.[a-z0-9]+$/i;
const ENTRY_POINT_PATTERN = /(?:^|\/|\\)(?:main|index|app|server|cli|route|headless_autonomy|local_node)\.[a-z0-9]+$/i;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "this",
  "that",
  "safe",
  "bounded",
  "goal",
  "repo",
  "file",
  "files",
  "test",
  "tests",
  "verify",
  "validation",
  "check",
  "run",
  "summarize",
  "locate",
  "used",
]);

export type RepoContextRelevantFile = {
  path: string;
  score: number;
  reasons: string[];
  pairedTestFiles: string[];
};

export type RepoDirectorySummary = {
  root: string;
  topLevelDirectories: string[];
  topLevelFiles: string[];
  notableDirectories: string[];
  fileCount: number;
  sampleFiles: string[];
  summary: string;
};

type RepoWalkOptions = {
  maxFiles?: number;
  includeDirectories?: boolean;
};

type RepoWalkEntry = {
  relativePath: string;
  isDirectory: boolean;
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveRepoRoot(root = process.cwd()): Promise<string> {
  const normalizedRoot = path.resolve(root);
  const directWebDirectory = path.join(normalizedRoot, "web");

  if (path.basename(normalizedRoot).toLowerCase() === "web") {
    return path.resolve(normalizedRoot, "..");
  }

  if (await pathExists(directWebDirectory)) {
    return normalizedRoot;
  }

  return normalizedRoot;
}

async function walkRepo(root: string, options?: RepoWalkOptions): Promise<RepoWalkEntry[]> {
  const maxFiles = Math.max(1, options?.maxFiles ?? 600);
  const queue = [root];
  const entries: RepoWalkEntry[] = [];

  while (queue.length > 0 && entries.length < maxFiles) {
    const currentDirectory = queue.shift();
    if (!currentDirectory) {
      break;
    }

    let currentEntries;
    try {
      currentEntries = await readdir(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of currentEntries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      const relativePath = normalizePathForMatch(path.relative(root, absolutePath));
      if (!relativePath) {
        continue;
      }

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          queue.push(absolutePath);
        }

        if (options?.includeDirectories) {
          entries.push({ relativePath, isDirectory: true });
        }
        continue;
      }

      if (!RELEVANT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }

      entries.push({ relativePath, isDirectory: false });
      if (entries.length >= maxFiles) {
        break;
      }
    }
  }

  return entries;
}

function tokenizeGoal(goal: string): string[] {
  return [...new Set(
    normalizeText(goal)
      .toLowerCase()
      .match(/[a-z][a-z0-9_-]{2,}/g) ?? []
  )].filter((token) => !STOP_WORDS.has(token));
}

function extractGoalPathHints(goal: string): string[] {
  return [...new Set(
    (normalizeText(goal).match(/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+/g) ?? [])
      .map((entry) => normalizePathForMatch(entry).replace(/^\.\//, "").toLowerCase())
  )];
}

function clusterPaths(paths: string[], limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const targetPath of paths) {
    const normalized = normalizePathForMatch(targetPath);
    const directory = path.posix.dirname(normalized);
    if (!directory || directory === ".") {
      continue;
    }

    counts.set(directory, (counts.get(directory) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([directory, count]) => `${directory} (${count})`);
}

function findPairedTests(candidatePath: string, testFiles: string[]): string[] {
  const normalizedCandidate = normalizePathForMatch(candidatePath).toLowerCase();
  const candidateBase = path.posix.basename(normalizedCandidate, path.posix.extname(normalizedCandidate));
  const strippedBase = candidateBase.replace(/\.(?:test|spec)$/i, "");

  return testFiles
    .filter((testFile) => {
      const normalizedTestFile = normalizePathForMatch(testFile).toLowerCase();
      const testBase = path.posix.basename(normalizedTestFile, path.posix.extname(normalizedTestFile)).replace(/\.(?:test|spec)$/i, "");
      return normalizedTestFile.includes(strippedBase) || strippedBase.includes(testBase);
    })
    .slice(0, 3);
}

export async function listRepoFiles(root: string): Promise<string[]> {
  const repoRoot = await resolveRepoRoot(root);
  const entries = await walkRepo(repoRoot, { maxFiles: 800 });
  return entries.filter((entry) => !entry.isDirectory).map((entry) => entry.relativePath);
}

export async function summarizeDirectoryStructure(root: string): Promise<RepoDirectorySummary> {
  const repoRoot = await resolveRepoRoot(root);
  const entries = await walkRepo(repoRoot, { maxFiles: 800, includeDirectories: true });
  const files = entries.filter((entry) => !entry.isDirectory).map((entry) => entry.relativePath);
  const directories = entries.filter((entry) => entry.isDirectory).map((entry) => entry.relativePath);

  const topLevelDirectories = directories.filter((entry) => !entry.includes("/")).slice(0, 12);
  const topLevelFiles = files.filter((entry) => !entry.includes("/")).slice(0, 8);
  const notableDirectories = directories
    .filter((entry) => /(?:^|\/)(?:web|tests|docs|app|lib|src|runner_artifacts|analysis_service|orchestrator_lane)(?:\/|$)/i.test(entry))
    .slice(0, 10);
  const sampleFiles = files.slice(0, 10);

  const summaryParts = [
    topLevelDirectories.length ? `Top directories: ${topLevelDirectories.join(", ")}.` : "",
    notableDirectories.length ? `Notable zones: ${notableDirectories.join(", ")}.` : "",
    sampleFiles.length ? `Sample files: ${sampleFiles.slice(0, 5).join(", ")}.` : "",
  ].filter(Boolean);

  return {
    root: repoRoot,
    topLevelDirectories,
    topLevelFiles,
    notableDirectories,
    fileCount: files.length,
    sampleFiles,
    summary: summaryParts.join(" ") || "No repo structure summary is available yet.",
  };
}

export async function detectTestFiles(root: string): Promise<string[]> {
  const repoRoot = await resolveRepoRoot(root);
  const files = await listRepoFiles(repoRoot);
  return files.filter((filePath) => TEST_FILE_PATTERN.test(filePath));
}

export async function detectEntryPoints(root: string): Promise<string[]> {
  const repoRoot = await resolveRepoRoot(root);
  const files = await listRepoFiles(repoRoot);

  return files.filter((filePath) => {
    if (filePath === "package.json" || filePath === "README.md") {
      return true;
    }

    return ENTRY_POINT_PATTERN.test(filePath) || /(?:^|\/)(?:app\/api|web\/app\/api)/i.test(filePath);
  }).slice(0, 12);
}

export async function findRelevantFiles(
  goal: string,
  root: string,
  options?: { recentChangedPaths?: string[] },
): Promise<RepoContextRelevantFile[]> {
  const repoRoot = await resolveRepoRoot(root);
  const files = await listRepoFiles(repoRoot);
  const testFiles = await detectTestFiles(repoRoot);
  const goalTokens = tokenizeGoal(goal);
  const goalPathHints = extractGoalPathHints(goal);
  const recentPathText = (options?.recentChangedPaths ?? []).map((item) => normalizePathForMatch(item).toLowerCase());

  const scored = files.map((filePath) => {
    const normalized = filePath.toLowerCase();
    const reasons: string[] = [];
    let score = 0;

    for (const token of goalTokens) {
      if (normalized.includes(`/${token}`) || normalized.includes(`${token}.`) || normalized.includes(`-${token}`) || normalized.includes(`_${token}`)) {
        score += 5;
        reasons.push(`path matched '${token}'`);
      } else if (normalized.includes(token)) {
        score += 2;
        reasons.push(`path mentioned '${token}'`);
      }
    }

    if (recentPathText.some((recentPath) => recentPath && (normalized.includes(recentPath) || recentPath.includes(normalized)))) {
      score += 4;
      reasons.push("aligned with recent changed paths");
    }

    if (goalPathHints.some((hint) => normalized.startsWith(hint))) {
      score += 8;
      reasons.push("inside the explicit goal path");
    }

    if (TEST_FILE_PATTERN.test(filePath) && /test|trace|verify|validation/i.test(goal)) {
      score += 3;
      reasons.push("test-related goal");
    }

    if (/headless|local|autonomous/i.test(goal) && /headless_autonomy|local_node|autonomous/i.test(normalized)) {
      score += 4;
      reasons.push("autonomy entrypoint match");
    }

    return {
      path: filePath,
      score,
      reasons: [...new Set(reasons)],
      pairedTestFiles: findPairedTests(filePath, testFiles),
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, 8);
}

export { clusterPaths };