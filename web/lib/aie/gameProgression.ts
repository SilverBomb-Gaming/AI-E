import { readFile } from "node:fs/promises";
import path from "node:path";

import type { GameProjectSnapshot } from "./gameProjectInspector";

export type GameProgressionStage = {
  id: "movement" | "camera-control" | "basic-enemy" | "player-attack" | "game-loop";
  label: string;
  description: string;
  complete: boolean;
};

export type NextGameTask = {
  stage: GameProgressionStage["id"];
  title: string;
  scriptName: string;
  behaviorDescription: string;
  executionPlan: "create-new-script" | "modify-existing-script";
  implementationMode: "create-new-script" | "modify-existing-script";
  targetFile: string;
  requiredPatchType: "camera-follow-script" | "basic-enemy-script" | "player-attack-script" | "game-loop-script";
  safeImplementationPlan: string[];
  safety: {
    noDuplicateSystems: true;
    preferExistingStructure: true;
    guardedPatchWorkflow: true;
    noUnityExecution: true;
  };
};

export type GameProgressionResult = {
  currentStage: GameProgressionStage["id"];
  stages: GameProgressionStage[];
  signals: {
    movementExists: boolean;
    jumpExists: boolean;
    playerScriptPresent: boolean;
    cameraExists: boolean;
  };
  nextTask: NextGameTask;
};

async function detectJumpExists(snapshot: GameProjectSnapshot): Promise<boolean> {
  const movementScript = snapshot.analysis.scriptSignals.movementScripts[0];
  if (!movementScript) {
    return false;
  }

  const absolutePath = path.join(snapshot.rootPath, movementScript);
  const source = await readFile(absolutePath, "utf-8");
  return source.includes("Input.GetKeyDown(KeyCode.Space)")
    && source.includes("jumpHeight")
    && source.includes("jumpRequested")
    && source.includes("Mathf.Sqrt(jumpHeight * -2f * gravity)");
}

function buildStages(signals: GameProgressionResult["signals"]): GameProgressionStage[] {
  return [
    {
      id: "movement",
      label: "Stage 1: Movement",
      description: "Player movement and jump are available.",
      complete: signals.movementExists && signals.jumpExists && signals.playerScriptPresent,
    },
    {
      id: "camera-control",
      label: "Stage 2: Camera control",
      description: "Add a third-person camera follow system.",
      complete: signals.cameraExists,
    },
    {
      id: "basic-enemy",
      label: "Stage 3: Basic enemy",
      description: "Introduce a simple enemy presence and movement.",
      complete: false,
    },
    {
      id: "player-attack",
      label: "Stage 4: Player attack",
      description: "Allow the player to damage enemies.",
      complete: false,
    },
    {
      id: "game-loop",
      label: "Stage 5: Game loop",
      description: "Define win and lose conditions.",
      complete: false,
    },
  ];
}

function determineCurrentStage(stages: GameProgressionStage[]): GameProgressionStage["id"] {
  const lastComplete = [...stages].reverse().find((stage) => stage.complete);
  return lastComplete?.id ?? "movement";
}

function buildCameraFollowTask(): NextGameTask {
  return {
    stage: "camera-control",
    title: "Add third-person camera follow system",
    scriptName: "CameraFollow.cs",
    behaviorDescription: "Create a lightweight follow camera that tracks the player from behind, keeps a readable offset, and smoothly follows movement without replacing the existing player controller.",
    executionPlan: "create-new-script",
    implementationMode: "create-new-script",
    targetFile: "Assets/Scripts/CameraFollow.cs",
    requiredPatchType: "camera-follow-script",
    safeImplementationPlan: [
      "Create CameraFollow.cs in Assets/Scripts unless an existing camera follow script is already present.",
      "Expose a player target, position offset, and smooth follow speed as serialized fields.",
      "Update the camera transform in LateUpdate so it follows player movement cleanly.",
      "Attach the script to the main camera and assign the player transform in Unity.",
      "Use the guarded patch workflow if an existing camera script needs modification instead of creating a duplicate camera system.",
    ],
    safety: {
      noDuplicateSystems: true,
      preferExistingStructure: true,
      guardedPatchWorkflow: true,
      noUnityExecution: true,
    },
  };
}

function buildFallbackTask(stage: NextGameTask["stage"], title: string, scriptName: string, targetFile: string, behaviorDescription: string): NextGameTask {
  return {
    stage,
    title,
    scriptName,
    behaviorDescription,
    executionPlan: "create-new-script",
    implementationMode: "create-new-script",
    targetFile,
    requiredPatchType: stage === "basic-enemy"
      ? "basic-enemy-script"
      : stage === "player-attack"
        ? "player-attack-script"
        : "game-loop-script",
    safeImplementationPlan: [
      "Inspect existing scripts before creating a new gameplay system.",
      "Prefer modifying existing structure when a related script already exists.",
      "Use the guarded patch workflow for modifications instead of manual copy/paste.",
    ],
    safety: {
      noDuplicateSystems: true,
      preferExistingStructure: true,
      guardedPatchWorkflow: true,
      noUnityExecution: true,
    },
  };
}

function determineNextTask(stages: GameProgressionStage[]): NextGameTask {
  const nextStage = stages.find((stage) => !stage.complete)?.id ?? "game-loop";

  switch (nextStage) {
    case "camera-control":
      return buildCameraFollowTask();
    case "basic-enemy":
      return buildFallbackTask("basic-enemy", "Add basic enemy", "BasicEnemy.cs", "Assets/Scripts/BasicEnemy.cs", "Introduce a simple enemy that can be placed in the scene and react to the player.");
    case "player-attack":
      return buildFallbackTask("player-attack", "Add player attack", "PlayerAttack.cs", "Assets/Scripts/PlayerAttack.cs", "Allow the player to trigger a simple attack against nearby enemies.");
    case "game-loop":
      return buildFallbackTask("game-loop", "Add win/lose loop", "GameLoopController.cs", "Assets/Scripts/GameLoopController.cs", "Define a minimal win/lose loop and restart flow for the current prototype.");
    default:
      return buildCameraFollowTask();
  }
}

export async function determineGameProgression(snapshot: GameProjectSnapshot): Promise<GameProgressionResult> {
  const signals = {
    movementExists: snapshot.analysis.scriptSignals.movementScripts.length > 0,
    jumpExists: await detectJumpExists(snapshot),
    playerScriptPresent: snapshot.analysis.scriptSignals.movementScripts.some((scriptPath) => /player|mover|controller/i.test(path.basename(scriptPath))),
    cameraExists: snapshot.analysis.scriptSignals.cameraScripts.length > 0,
  };

  const stages = buildStages(signals);

  return {
    currentStage: determineCurrentStage(stages),
    stages,
    signals,
    nextTask: determineNextTask(stages),
  };
}

export function renderNextGameTask(result: GameProgressionResult): string {
  return [
    "NEXT GAME TASK",
    "",
    `Current Stage: ${result.currentStage}`,
    `Movement Exists: ${result.signals.movementExists ? "YES" : "NO"}`,
    `Jump Exists: ${result.signals.jumpExists ? "YES" : "NO"}`,
    `Player Script Present: ${result.signals.playerScriptPresent ? "YES" : "NO"}`,
    `Camera Exists: ${result.signals.cameraExists ? "YES" : "NO"}`,
    "",
    "Progression:",
    ...result.stages.map((stage) => `- ${stage.label}: ${stage.complete ? "DONE" : "NEXT"} - ${stage.description}`),
    "",
    `Title: ${result.nextTask.title}`,
    `Script Name: ${result.nextTask.scriptName}`,
    `Target File: ${result.nextTask.targetFile}`,
    `Execution Plan: ${result.nextTask.executionPlan}`,
    `Implementation Mode: ${result.nextTask.implementationMode}`,
    `Required Patch Type: ${result.nextTask.requiredPatchType}`,
    `Behavior: ${result.nextTask.behaviorDescription}`,
    "",
    "Safe Implementation Plan:",
    ...result.nextTask.safeImplementationPlan.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Safety:",
    `- no duplicate systems: ${result.nextTask.safety.noDuplicateSystems ? "true" : "false"}`,
    `- prefer existing structure: ${result.nextTask.safety.preferExistingStructure ? "true" : "false"}`,
    `- guarded patch workflow: ${result.nextTask.safety.guardedPatchWorkflow ? "true" : "false"}`,
    `- no Unity execution: ${result.nextTask.safety.noUnityExecution ? "true" : "false"}`,
  ].join("\n");
}