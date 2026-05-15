import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export type GameProjectSnapshot = {
  engine: "unity" | "unknown";
  rootPath: string;
  structure: {
    scenes: string[];
    scripts: string[];
    prefabs: string[];
  };
  summary: {
    sceneCount: number;
    scriptCount: number;
    prefabCount: number;
  };
  analysis: {
    scriptSignals: {
      movementScripts: string[];
      aiScripts: string[];
      combatScripts: string[];
      cameraScripts: string[];
    };
  };
  readiness: string;
  nextStep: string;
  safety: {
    readOnly: true;
  };
};

const MAX_PATHS_PER_TYPE = 20;

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveSearchStart(targetPath: string): Promise<string> {
  const resolved = path.resolve(targetPath);
  const details = await stat(resolved);
  return details.isDirectory() ? resolved : path.dirname(resolved);
}

async function isUnityRoot(candidatePath: string): Promise<boolean> {
  const requiredPaths = ["Assets", "ProjectSettings", "Packages"];
  const checks = await Promise.all(requiredPaths.map((segment) => pathExists(path.join(candidatePath, segment))));
  return checks.every(Boolean);
}

export async function detectGameProjectRoot(targetPath: string): Promise<string> {
  let currentPath = await resolveSearchStart(targetPath);

  while (true) {
    if (await isUnityRoot(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return path.resolve(targetPath);
    }

    currentPath = parentPath;
  }
}

async function collectAssetPaths(rootPath: string): Promise<{
  scenes: string[];
  scripts: string[];
  prefabs: string[];
  sceneCount: number;
  scriptCount: number;
  prefabCount: number;
}> {
  const assetsRoot = path.join(rootPath, "Assets");
  const scenes: string[] = [];
  const scripts: string[] = [];
  const prefabs: string[] = [];
  let sceneCount = 0;
  let scriptCount = 0;
  let prefabCount = 0;

  async function walk(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sortedEntries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      const relativePath = path.relative(rootPath, entryPath).split(path.sep).join("/");

      if (entry.name.endsWith(".unity")) {
        sceneCount += 1;
        if (scenes.length < MAX_PATHS_PER_TYPE) {
          scenes.push(relativePath);
        }
        continue;
      }

      if (entry.name.endsWith(".cs")) {
        scriptCount += 1;
        if (scripts.length < MAX_PATHS_PER_TYPE) {
          scripts.push(relativePath);
        }
        continue;
      }

      if (entry.name.endsWith(".prefab")) {
        prefabCount += 1;
        if (prefabs.length < MAX_PATHS_PER_TYPE) {
          prefabs.push(relativePath);
        }
      }
    }
  }

  if (await pathExists(assetsRoot)) {
    await walk(assetsRoot);
  }

  return {
    scenes,
    scripts,
    prefabs,
    sceneCount,
    scriptCount,
    prefabCount,
  };
}

function classifyReadiness(sceneCount: number, scriptCount: number): GameProjectSnapshot["readiness"] {
  if (sceneCount === 0) {
    return "not-started";
  }

  if (sceneCount > 0 && scriptCount === 0) {
    return "scene-only";
  }

  if (sceneCount > 0 && scriptCount > 0) {
    return "logic-present";
  }

  return "unknown";
}

function movementScriptScore(scriptPath: string): number {
  const fileName = path.basename(scriptPath).toLowerCase();
  let score = 0;

  if (fileName.includes("mover")) {
    score += 8;
  }

  if (fileName.includes("movement")) {
    score += 7;
  }

  if (fileName.includes("keyboard")) {
    score += 6;
  }

  if (fileName.includes("input")) {
    score += 5;
  }

  if (fileName.includes("player")) {
    score += 3;
  }

  if (fileName.includes("controller")) {
    score += 2;
  }

  return score;
}

function classifyScriptSignals(scripts: readonly string[]): GameProjectSnapshot["analysis"]["scriptSignals"] {
  const movementScripts = scripts
    .filter((scriptPath) => {
      const fileName = path.basename(scriptPath);
      if (!/player|controller|mover|movement|keyboard|input/i.test(fileName)) {
        return false;
      }

      if (/enemy|ai|npc|combat|weapon|camera/i.test(fileName) && !/mover|movement|keyboard|input/i.test(fileName)) {
        return false;
      }

      return true;
    })
    .sort((left, right) => movementScriptScore(right) - movementScriptScore(left) || left.localeCompare(right));
  const aiScripts = scripts.filter((scriptPath) => /ai|enemy|npc|behavior/i.test(path.basename(scriptPath)));
  const combatScripts = scripts.filter((scriptPath) => /combat|weapon|attack|damage|health/i.test(path.basename(scriptPath)));
  const cameraScripts = scripts.filter((scriptPath) => /camera|followcam|cinemachine|look/i.test(path.basename(scriptPath)));

  return {
    movementScripts,
    aiScripts,
    combatScripts,
    cameraScripts,
  };
}

function nextStepForReadiness(readiness: GameProjectSnapshot["readiness"], engine: GameProjectSnapshot["engine"]): string {
  if (engine !== "unity") {
    return "Open a Unity project root";
  }

  if (readiness === "not-started") {
    return "Create first scene in Unity";
  }

  if (readiness === "scene-only") {
    return "Add gameplay scripts";
  }

  if (readiness === "logic-present") {
    return "Run playtest in Unity";
  }

  return "Inspect project structure";
}

export async function inspectGameProject(targetPath: string): Promise<GameProjectSnapshot> {
  const detectedRoot = await detectGameProjectRoot(targetPath);
  const engine: GameProjectSnapshot["engine"] = await isUnityRoot(detectedRoot) ? "unity" : "unknown";

  if (engine !== "unity") {
    return {
      engine,
      rootPath: detectedRoot,
      structure: {
        scenes: [],
        scripts: [],
        prefabs: [],
      },
      summary: {
        sceneCount: 0,
        scriptCount: 0,
        prefabCount: 0,
      },
      analysis: {
        scriptSignals: {
          movementScripts: [],
          aiScripts: [],
          combatScripts: [],
          cameraScripts: [],
        },
      },
      readiness: "unknown",
      nextStep: nextStepForReadiness("unknown", engine),
      safety: {
        readOnly: true,
      },
    };
  }

  const structure = await collectAssetPaths(detectedRoot);
  const scriptSignals = classifyScriptSignals(structure.scripts);
  const readiness = classifyReadiness(structure.sceneCount, structure.scriptCount);

  return {
    engine,
    rootPath: detectedRoot,
    structure: {
      scenes: structure.scenes,
      scripts: structure.scripts,
      prefabs: structure.prefabs,
    },
    summary: {
      sceneCount: structure.sceneCount,
      scriptCount: structure.scriptCount,
      prefabCount: structure.prefabCount,
    },
    analysis: {
      scriptSignals,
    },
    readiness,
    nextStep: nextStepForReadiness(readiness, engine),
    safety: {
      readOnly: true,
    },
  };
}

export function renderGameProjectSummary(snapshot: GameProjectSnapshot): string {
  const engineLabel = snapshot.engine === "unity" ? "Unity" : "Unknown";

  return [
    "GAME PROJECT",
    "",
    `Engine: ${engineLabel}`,
    `Root: ${snapshot.rootPath}`,
    `Scenes: ${snapshot.summary.sceneCount}`,
    `Scripts: ${snapshot.summary.scriptCount}`,
    `Prefabs: ${snapshot.summary.prefabCount}`,
    `Movement scripts: ${snapshot.analysis.scriptSignals.movementScripts.length ? snapshot.analysis.scriptSignals.movementScripts.join(", ") : "none"}`,
    "",
    `Readiness: ${snapshot.readiness}`,
    `Next Step: ${snapshot.nextStep}`,
    "",
    "Safety:",
    "- read-only inspection only",
    "- no Unity execution",
    "- no file writes",
  ].join("\n");
}