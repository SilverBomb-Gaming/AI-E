import type { ExecutionRollback } from "./types";

const rollbackSnapshots = new Map<string, ExecutionRollback>();

function createSnapshotId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `aie-rollback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createRestoreFileRollback(targetPath: string, previousContent: string): ExecutionRollback {
  return {
    type: "restore-file",
    targetPath,
    previousContent,
    snapshotId: createSnapshotId(),
    createdAt: new Date().toISOString(),
  };
}

export function rememberRollbackSnapshot(snapshot: ExecutionRollback): void {
  rollbackSnapshots.set(snapshot.targetPath, snapshot);
}

export function getRollbackSnapshot(targetPath: string): ExecutionRollback | undefined {
  return rollbackSnapshots.get(targetPath);
}

export function clearRollbackSnapshot(targetPath: string): void {
  rollbackSnapshots.delete(targetPath);
}