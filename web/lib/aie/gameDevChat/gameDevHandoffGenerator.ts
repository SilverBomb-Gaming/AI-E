import type { GameDevChatRoute, GameDevCodexHandoff } from "./gameDevChatTypes";

function inferGoal(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("collectible")) {
    return "Add a basic Unity collectible system with trigger pickup, score/state update, and safe validation.";
  }
  if (lower.includes("patrol") || lower.includes("enemy")) {
    return "Add a basic Unity enemy patrol behavior with bounded waypoint movement and clear validation steps.";
  }
  if (lower.includes("jump") || lower.includes("floaty")) {
    return "Tune the Unity player jump feel by adjusting gravity, jump force, fall behavior, coyote time, and buffering carefully.";
  }
  if (lower.includes("bug") || lower.includes("fix") || lower.includes("crash")) {
    return "Diagnose the reported Unity bug with reproduction steps before making a focused code change.";
  }
  return "Implement the requested Unity gameplay change with a small, reviewable patch and explicit validation.";
}

function inferFiles(message: string): string[] {
  const lower = message.toLowerCase();
  if (lower.includes("collectible")) {
    return ["Assets/Scripts/Collectible.cs", "Assets/Scripts/PlayerInventory.cs or score manager", "Relevant Unity scene/prefab references"];
  }
  if (lower.includes("patrol") || lower.includes("enemy")) {
    return ["Assets/Scripts/EnemyPatrol.cs", "Existing enemy controller script", "Relevant enemy prefab and waypoint scene objects"];
  }
  if (lower.includes("jump") || lower.includes("player")) {
    return ["Existing player movement/controller script", "Player Rigidbody or CharacterController setup", "Input handling script if separate"];
  }
  return ["Existing gameplay script closest to the requested feature", "Relevant prefab or scene setup", "Tests or smoke scripts if present"];
}

export function generateGameDevCodexHandoff(message: string, route: GameDevChatRoute): GameDevCodexHandoff {
  const goal = inferGoal(message);
  const filesToInspect = inferFiles(message);
  const implementationSteps = [
    "Inspect the existing Unity scripts and scene/prefab conventions before editing.",
    "Make the smallest focused code change that satisfies the requested gameplay behavior.",
    "Keep public fields serialized and designer-tunable when the behavior needs tuning in Unity.",
    "Do not claim Unity Editor changes unless the scene or prefab file is actually modified and validated.",
  ];
  const safetyChecks = [
    "Do not run destructive git commands or overwrite unrelated user changes.",
    "Do not invent files that were changed; report only actual edits.",
    "Keep the change Unity-first and bounded to the named gameplay feature.",
    "Ask for clarification if the target script or scene cannot be identified safely.",
  ];
  const validationPlan = [
    "Run available TypeScript/C# tests or compile checks if the repo provides them.",
    "Perform a Unity play-mode or smoke validation when available.",
    "Manually verify the gameplay behavior: trigger, movement, timing, and no console errors.",
  ];
  const title = route.mode === "BUG_FIX_REQUEST" ? "Codex Handoff: Unity Bug Fix" : "Codex Handoff: Unity Gameplay Task";
  const summary = `${route.detectedIntent}. This is a planning handoff only; no files have been changed by chat mode.`;
  const markdown = [
    `# ${title}`,
    "",
    `## Goal`,
    goal,
    "",
    "## Target Engine",
    route.unityFirst ? "Unity" : "Unspecified game-dev target, prefer Unity if the project context matches.",
    "",
    "## Files To Inspect First",
    ...filesToInspect.map((file) => `- ${file}`),
    "",
    "## Implementation Steps",
    ...implementationSteps.map((step) => `- ${step}`),
    "",
    "## Safety Rules",
    ...safetyChecks.map((check) => `- ${check}`),
    "",
    "## Validation Plan",
    ...validationPlan.map((step) => `- ${step}`),
    "",
    "## Truthfulness Constraint",
    "Chat mode prepared this handoff only. It did not edit files, run Unity, or validate the scene.",
  ].join("\n");

  return {
    title,
    summary,
    targetEngine: route.unityFirst ? "Unity" : "Unspecified",
    goal,
    filesToInspect,
    implementationSteps,
    safetyChecks,
    validationPlan,
    markdown,
  };
}
