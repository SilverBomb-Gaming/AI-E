import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeAutonomousSession, type AutonomousSession } from "./autonomousSession";

function getAutonomousSessionStoreDirectory(): string {
  const configuredDirectory = process.env.AIE_AUTONOMOUS_SESSION_DIR?.trim();
  if (configuredDirectory) {
    return configuredDirectory;
  }

  return path.resolve(process.cwd(), "..", "runner_artifacts", "autonomous_sessions");
}

async function ensureAutonomousSessionStoreDirectory(): Promise<string> {
  const directory = getAutonomousSessionStoreDirectory();
  await mkdir(directory, { recursive: true });
  return directory;
}

function getAutonomousSessionFilePath(sessionId: string): string {
  return path.join(getAutonomousSessionStoreDirectory(), `${sessionId}.json`);
}

export async function saveAutonomousSession(session: AutonomousSession): Promise<void> {
  await ensureAutonomousSessionStoreDirectory();
  await writeFile(getAutonomousSessionFilePath(session.sessionId), `${JSON.stringify(session, null, 2)}\n`, "utf8");
}

export async function loadAutonomousSession(sessionId: string): Promise<AutonomousSession | null> {
  try {
    const raw = await readFile(getAutonomousSessionFilePath(sessionId), "utf8");
    return normalizeAutonomousSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function listAutonomousSessions(): Promise<AutonomousSession[]> {
  const directory = await ensureAutonomousSessionStoreDirectory();
  const entries = await readdir(directory, { withFileTypes: true });
  const sessions = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => {
        try {
          const raw = await readFile(path.join(directory, entry.name), "utf8");
          return normalizeAutonomousSession(JSON.parse(raw));
        } catch {
          return null;
        }
      }),
  );

  return sessions
    .filter((session): session is AutonomousSession => session !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function loadLatestAutonomousSession(): Promise<AutonomousSession | null> {
  const sessions = await listAutonomousSessions();
  return sessions[0] ?? null;
}

export async function getAutonomousSessionStoreSummary(): Promise<{
  count: number;
  latestSessionId: string | null;
  latestStatus: AutonomousSession["status"] | null;
  latestGoal: string | null;
}> {
  const latestSession = await loadLatestAutonomousSession();
  const sessions = latestSession ? await listAutonomousSessions() : [];

  return {
    count: sessions.length,
    latestSessionId: latestSession?.sessionId ?? null,
    latestStatus: latestSession?.status ?? null,
    latestGoal: latestSession?.goal ?? null,
  };
}

export async function deleteAutonomousSession(sessionId: string): Promise<void> {
  await rm(getAutonomousSessionFilePath(sessionId), { force: true });
}

export { getAutonomousSessionStoreDirectory };