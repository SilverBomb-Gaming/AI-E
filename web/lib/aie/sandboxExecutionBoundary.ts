import { mkdir } from "node:fs/promises";
import path from "node:path";

export type GovernedSandboxDirectoryKind =
  | "governed-root"
  | "sandbox-root"
  | "workspace"
  | "snapshots-root"
  | "snapshot-before"
  | "snapshot-after"
  | "receipts";

export type GovernedSandboxPathBase =
  | "sandbox-root"
  | "workspace"
  | "snapshots-root"
  | "snapshot-before"
  | "snapshot-after"
  | "receipts";

export type GovernedSandboxDirectory = {
  kind: GovernedSandboxDirectoryKind;
  absolutePath: string;
  relativePath: string;
};

export type GovernedSandboxScaffold = {
  sandboxId: string;
  repositoryRoot: string;
  governedRoot: GovernedSandboxDirectory;
  sandboxRoot: GovernedSandboxDirectory;
  workspace: GovernedSandboxDirectory;
  snapshotsRoot: GovernedSandboxDirectory;
  snapshotBefore: GovernedSandboxDirectory;
  snapshotAfter: GovernedSandboxDirectory;
  receipts: GovernedSandboxDirectory;
  directories: GovernedSandboxDirectory[];
};

export type GovernedSandboxSafePath = {
  base: GovernedSandboxPathBase;
  absolutePath: string;
  relativePath: string;
  sandboxRelativePath: string;
};

export type GovernedSandboxPreparationReceipt = {
  receiptVersion: "EXEC-0043-A";
  sandboxId: string;
  preparedAt: string;
  status: "dry_run_prepared" | "prepared";
  directories: Array<GovernedSandboxDirectory & { created: boolean }>;
  safetyBoundary: {
    boundedToSandboxRoot: true;
    shellExecutionEnabled: false;
    networkExecutionEnabled: false;
    deletionEnabled: false;
    automaticRuntimeExecution: false;
    runtimeApprovalRequired: true;
  };
};

export type BuildGovernedSandboxScaffoldInput = {
  sandboxId?: string;
  repositoryRoot?: string;
  now?: () => string;
};

export type PrepareGovernedSandboxWorkspaceInput = BuildGovernedSandboxScaffoldInput & {
  dryRun?: boolean;
  createDirectory?: (absolutePath: string) => Promise<void>;
};

const SANDBOX_ID_PATTERN = /^sandbox-[a-z0-9][a-z0-9_-]{0,63}$/;

function inferRepositoryRoot(): string {
  const cwd = path.resolve(process.cwd());
  return path.basename(cwd).toLowerCase() === "web" ? path.resolve(cwd, "..") : cwd;
}

function toPosixRelative(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join("/") || ".";
}

function isWithinDirectory(root: string, target: string): boolean {
  const relativePath = path.relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function hasTraversalSegment(candidatePath: string): boolean {
  return candidatePath.replace(/\\/g, "/").split("/").some((segment) => segment === "..");
}

function directory(kind: GovernedSandboxDirectoryKind, repositoryRoot: string, absolutePath: string): GovernedSandboxDirectory {
  return {
    kind,
    absolutePath,
    relativePath: toPosixRelative(repositoryRoot, absolutePath),
  };
}

function timestampId(now: () => string): string {
  return now().replace(/[^0-9]/g, "").slice(0, 14) || "00000000000000";
}

export function normalizeGovernedSandboxId(sandboxId: string): string {
  const normalizedId = sandboxId.trim();
  if (!SANDBOX_ID_PATTERN.test(normalizedId)) {
    throw new Error("Sandbox ids must use the sandbox-<id> format with only lowercase letters, numbers, dashes, or underscores.");
  }

  return normalizedId;
}

export function createGovernedSandboxId(input: { label?: string; now?: () => string } = {}): string {
  const label = String(input.label ?? "execution")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "execution";

  return normalizeGovernedSandboxId(`sandbox-${timestampId(input.now ?? (() => new Date().toISOString()))}-${label}`);
}

export function buildGovernedSandboxScaffold(input: BuildGovernedSandboxScaffoldInput = {}): GovernedSandboxScaffold {
  const repositoryRoot = path.resolve(input.repositoryRoot ?? inferRepositoryRoot());
  const sandboxId = normalizeGovernedSandboxId(input.sandboxId ?? createGovernedSandboxId({ now: input.now }));
  const governedRootPath = path.join(repositoryRoot, ".ai-e", "sandboxes");
  const sandboxRootPath = path.join(governedRootPath, sandboxId);

  const governedRoot = directory("governed-root", repositoryRoot, governedRootPath);
  const sandboxRoot = directory("sandbox-root", repositoryRoot, sandboxRootPath);
  const workspace = directory("workspace", repositoryRoot, path.join(sandboxRootPath, "workspace"));
  const snapshotsRoot = directory("snapshots-root", repositoryRoot, path.join(sandboxRootPath, "snapshots"));
  const snapshotBefore = directory("snapshot-before", repositoryRoot, path.join(snapshotsRoot.absolutePath, "before"));
  const snapshotAfter = directory("snapshot-after", repositoryRoot, path.join(snapshotsRoot.absolutePath, "after"));
  const receipts = directory("receipts", repositoryRoot, path.join(sandboxRootPath, "receipts"));

  if (!isWithinDirectory(repositoryRoot, governedRoot.absolutePath)) {
    throw new Error("The governed sandbox root must stay inside the repository boundary.");
  }

  return {
    sandboxId,
    repositoryRoot,
    governedRoot,
    sandboxRoot,
    workspace,
    snapshotsRoot,
    snapshotBefore,
    snapshotAfter,
    receipts,
    directories: [governedRoot, sandboxRoot, workspace, snapshotsRoot, snapshotBefore, snapshotAfter, receipts],
  };
}

function directoryForBase(scaffold: GovernedSandboxScaffold, base: GovernedSandboxPathBase): GovernedSandboxDirectory {
  if (base === "sandbox-root") {
    return scaffold.sandboxRoot;
  }
  if (base === "workspace") {
    return scaffold.workspace;
  }
  if (base === "snapshots-root") {
    return scaffold.snapshotsRoot;
  }
  if (base === "snapshot-before") {
    return scaffold.snapshotBefore;
  }
  if (base === "snapshot-after") {
    return scaffold.snapshotAfter;
  }
  return scaffold.receipts;
}

export function resolveGovernedSandboxPath(
  scaffold: GovernedSandboxScaffold,
  targetPath: string,
  base: GovernedSandboxPathBase = "workspace",
): GovernedSandboxSafePath {
  const normalizedTargetPath = targetPath.trim();
  if (!normalizedTargetPath) {
    throw new Error("A sandbox path is required.");
  }
  if (normalizedTargetPath.includes("\0") || /[*?<>|]/.test(normalizedTargetPath)) {
    throw new Error("Sandbox paths may not contain control characters or shell wildcard characters.");
  }
  if (hasTraversalSegment(normalizedTargetPath)) {
    throw new Error("Sandbox paths may not contain path traversal segments.");
  }

  const baseDirectory = directoryForBase(scaffold, base);
  const absolutePath = path.isAbsolute(normalizedTargetPath)
    ? path.normalize(normalizedTargetPath)
    : path.resolve(baseDirectory.absolutePath, normalizedTargetPath);

  if (!isWithinDirectory(scaffold.sandboxRoot.absolutePath, absolutePath)) {
    throw new Error("Resolved sandbox paths must stay inside the governed sandbox root.");
  }
  if (!isWithinDirectory(baseDirectory.absolutePath, absolutePath)) {
    throw new Error("Resolved sandbox paths must stay inside the requested sandbox base directory.");
  }

  return {
    base,
    absolutePath,
    relativePath: toPosixRelative(scaffold.repositoryRoot, absolutePath),
    sandboxRelativePath: toPosixRelative(scaffold.sandboxRoot.absolutePath, absolutePath),
  };
}

export async function prepareGovernedSandboxWorkspace(
  input: PrepareGovernedSandboxWorkspaceInput = {},
): Promise<GovernedSandboxPreparationReceipt> {
  const dryRun = input.dryRun !== false;
  const scaffold = buildGovernedSandboxScaffold(input);
  const createDirectory = input.createDirectory ?? ((absolutePath: string) => mkdir(absolutePath, { recursive: true }).then(() => undefined));

  if (!dryRun) {
    for (const entry of scaffold.directories) {
      if (entry.kind !== "governed-root" && !isWithinDirectory(scaffold.sandboxRoot.absolutePath, entry.absolutePath)) {
        throw new Error(`Refusing to prepare an out-of-bound sandbox directory: ${entry.relativePath}`);
      }
      await createDirectory(entry.absolutePath);
    }
  }

  return {
    receiptVersion: "EXEC-0043-A",
    sandboxId: scaffold.sandboxId,
    preparedAt: input.now?.() ?? new Date().toISOString(),
    status: dryRun ? "dry_run_prepared" : "prepared",
    directories: scaffold.directories.map((entry) => ({
      ...entry,
      created: !dryRun,
    })),
    safetyBoundary: {
      boundedToSandboxRoot: true,
      shellExecutionEnabled: false,
      networkExecutionEnabled: false,
      deletionEnabled: false,
      automaticRuntimeExecution: false,
      runtimeApprovalRequired: true,
    },
  };
}
