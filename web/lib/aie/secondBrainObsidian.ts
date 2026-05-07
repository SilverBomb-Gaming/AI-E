import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  ensureSecondBrainInitialized,
  readSecondBrainMemory,
  retrieveCurrentProjectContext,
  resolveSecondBrainProjectKey,
  type CurrentProjectContext,
  type OutcomeSummary,
  type SecondBrainRecord,
} from "./secondBrainMemory";
import {
  getCinematicReadinessMilestoneProgress,
  readCinematicProductionMemory,
  type CinematicProductionMemoryRecord,
} from "./cinematicProductionMemory";

const OBSIDIAN_VAULT_DIRNAME = "Second Brain";

type ObsidianRelationship = {
  from: string;
  to: string;
  type: "project-outcomes" | "project-anti-patterns" | "project-next-task" | "session-outcomes" | "recovery-known-good-states";
};

type ObsidianExportNote = {
  title: string;
  directory: string;
  metadata: {
    project_key: string;
    updated_at: string;
    session_id: string;
    status: string;
    tags: string[];
  };
  body: string;
};

export type ExportSecondBrainToObsidianResult = {
  repoRoot: string;
  vaultRoot: string;
  currentProjectKey: string;
  authoritativeProjectKey: string;
  latestSessionId: string;
  generatedFiles: string[];
  relationships: ObsidianRelationship[];
};

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, "-").trim();
}

function toLink(title: string): string {
  return `[[${title}]]`;
}

function asBulletList(items: string[]): string {
  if (items.length === 0) {
    return "- None recorded.";
  }

  return items.map((item) => `- ${item}`).join("\n");
}

function humanizeReadinessMilestone(value: string): string {
  return value
    .split("-")
    .map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1))
    .join(" ");
}

function formatFrontMatter(note: ObsidianExportNote): string {
  const { metadata } = note;
  return [
    "---",
    `project_key: ${metadata.project_key}`,
    `updated_at: ${metadata.updated_at}`,
    `session_id: ${metadata.session_id}`,
    `status: ${metadata.status}`,
    "tags:",
    ...metadata.tags.map((tag) => `  - ${tag}`),
    "---",
  ].join("\n");
}

function createNoteContent(note: ObsidianExportNote): string {
  return `${formatFrontMatter(note)}\n\n# ${note.title}\n\n> Generated read-only from AI-E second-brain memory. Do not edit here expecting machine memory to change.\n\n${note.body.trim()}\n`;
}

function buildSessionId(outcomes: OutcomeSummary[]): string {
  for (const outcome of outcomes) {
    const matched = outcome.outcome_id.match(/^(.*)-step-\d+$/);
    if (matched?.[1]) {
      return matched[1];
    }
  }

  return "none";
}

function summarizeProjectStatus(projectContext: CurrentProjectContext): string[] {
  return [
    `Summary: ${projectContext.project.summary}`,
    `Status: ${projectContext.project.status}`,
    `Next safe task: ${projectContext.next_safe_task}`,
    `Continuation context: ${projectContext.continuation_context}`,
  ];
}

function buildRelationships(currentProjectKey: string): ObsidianRelationship[] {
  const projectTitle = currentProjectKey === "ai-e" ? "AI-E" : "BABYLON 2026";
  return [
    { from: projectTitle, to: "Outcome History", type: "project-outcomes" },
    { from: projectTitle, to: "Old BABYLON Anti-Patterns", type: "project-anti-patterns" },
    { from: projectTitle, to: "Next Safe Task", type: "project-next-task" },
    { from: "Session Continuity Summary", to: "Outcome History", type: "session-outcomes" },
    { from: "Recovery Procedures", to: "BABYLON 2026", type: "recovery-known-good-states" },
    { from: "Recovery Procedures", to: "AI-E", type: "recovery-known-good-states" },
  ];
}

function buildProjectNote(input: {
  projectContext: CurrentProjectContext;
  latestSessionId: string;
  updatedAt: string;
  extraLinks: string[];
}): ObsidianExportNote {
  const { projectContext } = input;
  return {
    title: projectContext.project.title,
    directory: "Projects",
    metadata: {
      project_key: projectContext.project.project_key,
      updated_at: input.updatedAt,
      session_id: input.latestSessionId,
      status: projectContext.project.status,
      tags: ["second-brain", "project", projectContext.project.project_key, "obsidian-export"],
    },
    body: [
      "## Summary",
      asBulletList(summarizeProjectStatus(projectContext)),
      "",
      "## Current State",
      asBulletList(projectContext.project.current_state),
      "",
      "## Validation Status",
      asBulletList(projectContext.project.validation_status),
      "",
      "## Positive Patterns",
      asBulletList(projectContext.project.positive_patterns),
      "",
      "## Related",
      asBulletList(input.extraLinks),
    ].join("\n"),
  };
}

function buildCurrentProjectStateNote(input: {
  record: SecondBrainRecord;
  repoProjectContext: CurrentProjectContext;
  authoritativeProjectContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  const authoritativeTitle = input.authoritativeProjectContext.project.title;
  const repoTitle = input.repoProjectContext.project.title;
  const activeRepoProjectTitle = normalizeText(input.record.sections.working_memory.active_repo_project) || repoTitle;
  return {
    title: "Current Project State",
    directory: "Projects",
    metadata: {
      project_key: input.repoProjectContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_current_state_view",
      tags: ["second-brain", "current-state", "obsidian-export"],
    },
    body: [
      "## Current Routing",
      asBulletList([
        `Authoritative memory project key: ${input.record.current_project_key} (${toLink(authoritativeTitle)})`,
        `Active repo project: ${input.record.sections.working_memory.active_repo_project} (${toLink(activeRepoProjectTitle)})`,
        `Resolved repo-scoped project key: ${input.repoProjectContext.project.project_key}`,
      ]),
      "",
      "## Working Memory",
      asBulletList([
        `Current task state: ${input.record.sections.working_memory.current_task_state}`,
        `Current objective: ${input.record.sections.working_memory.current_objective}`,
        `Resume checkpoint: ${input.record.sections.working_memory.resume_checkpoint}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink(authoritativeTitle),
        toLink(activeRepoProjectTitle),
        toLink("Next Safe Task"),
        toLink("Session Continuity Summary"),
      ]),
    ].join("\n"),
  };
}

function buildNextSafeTaskNote(input: {
  record: SecondBrainRecord;
  babylonContext: CurrentProjectContext;
  aiContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  return {
    title: "Next Safe Task",
    directory: "Projects",
    metadata: {
      project_key: input.aiContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_next_task_view",
      tags: ["second-brain", "next-safe-task", "obsidian-export"],
    },
    body: [
      "## AI-E",
      asBulletList([
        input.aiContext.next_safe_task,
        `Related context: ${toLink("Current Project State")}`,
      ]),
      "",
      "## BABYLON 2026",
      asBulletList([
        input.babylonContext.next_safe_task,
        `Related context: ${toLink("BABYLON 2026")}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("AI-E"),
        toLink("BABYLON 2026"),
        toLink("Current Focus"),
      ]),
    ].join("\n"),
  };
}

function buildArchitectureRulesNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const architecture = input.record.sections.architecture_memory;
  return {
    title: "Architecture Rules",
    directory: "Architecture",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_read_only_rules",
      tags: ["second-brain", "architecture", "rules", "obsidian-export"],
    },
    body: [
      "## Ownership Rules",
      asBulletList(architecture.ownership_rules),
      "",
      "## Project Constraints",
      asBulletList(architecture.project_specific_constraints),
      "",
      "## BABYLON 2026 Clean Architecture Rules",
      asBulletList(architecture.babylon2026_clean_architecture_rules),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON 2026"),
        toLink("AI-E"),
        toLink("Old BABYLON Anti-Patterns"),
      ]),
    ].join("\n"),
  };
}

function buildAntiPatternsNote(input: {
  record: SecondBrainRecord;
  babylonContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  const architecture = input.record.sections.architecture_memory;
  return {
    title: "Old BABYLON Anti-Patterns",
    directory: "Architecture",
    metadata: {
      project_key: input.babylonContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_anti_pattern_view",
      tags: ["second-brain", "anti-patterns", "babylon-2026", "obsidian-export"],
    },
    body: [
      "## Project Anti-Patterns",
      asBulletList(input.babylonContext.project.anti_patterns),
      "",
      "## Shared Architecture Anti-Patterns",
      asBulletList(architecture.anti_patterns),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON 2026"),
        toLink("Architecture Rules"),
        toLink("Operational Lessons"),
      ]),
    ].join("\n"),
  };
}

function buildOutcomeHistoryNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const outcomeMemory = input.record.sections.outcome_memory;
  const recentOutcomes = outcomeMemory.latest_outcomes.map((outcome) => {
    const linkedProject = outcome.project_key === "ai-e" ? toLink("AI-E") : toLink("BABYLON 2026");
    const derivedSessionId = outcome.outcome_id.match(/^(.*)-step-\d+$/)?.[1] ?? "none";
    return `${outcome.recorded_at}: ${linkedProject} | ${outcome.task_title} | ${outcome.status} | session=${derivedSessionId} | ${outcome.validation_result}`;
  });

  return {
    title: "Outcome History",
    directory: "Outcomes",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_append_only_view",
      tags: ["second-brain", "outcomes", "history", "obsidian-export"],
    },
    body: [
      "## Recent Outcomes",
      asBulletList(recentOutcomes),
      "",
      "## What Passed",
      asBulletList(outcomeMemory.what_passed),
      "",
      "## What Failed",
      asBulletList(outcomeMemory.what_failed),
      "",
      "## Never Repeat",
      asBulletList(outcomeMemory.should_never_be_repeated),
      "",
      "## Related",
      asBulletList([
        toLink("AI-E"),
        toLink("BABYLON 2026"),
        toLink("Session Continuity Summary"),
      ]),
    ].join("\n"),
  };
}

function buildRecoveryProceduresNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const recovery = input.record.sections.recovery_memory;
  const rollbackPoints = recovery.rollback_points.map((entry) => {
    const linkedProject = entry.project_key === "ai-e" ? toLink("AI-E") : toLink("BABYLON 2026");
    return `${linkedProject}: ${entry.commit} - ${entry.reason}`;
  });

  return {
    title: "Recovery Procedures",
    directory: "Recovery",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_recovery_view",
      tags: ["second-brain", "recovery", "obsidian-export"],
    },
    body: [
      "## Rollback Points",
      asBulletList(rollbackPoints),
      "",
      "## Known Good Commits",
      asBulletList(recovery.known_good_commits),
      "",
      "## Emergency Procedures",
      asBulletList(recovery.emergency_recovery_procedures),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON 2026"),
        toLink("AI-E"),
        toLink("Outcome History"),
      ]),
    ].join("\n"),
  };
}

function buildResourceFallbackStateNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const resources = input.record.sections.resource_memory;
  return {
    title: "Resource Fallback State",
    directory: "Resources",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: resources.preferred_fallback_mode,
      tags: ["second-brain", "resources", "fallback", "obsidian-export"],
    },
    body: [
      "## Available Hardware",
      asBulletList(resources.available_hardware),
      "",
      "## Unavailable Hardware",
      asBulletList(resources.unavailable_hardware),
      "",
      "## Model/API Limits",
      asBulletList(resources.model_api_limits),
      "",
      "## Fallback Options",
      asBulletList(resources.local_offline_fallback_options),
      "",
      "## Related",
      asBulletList([
        toLink("AI-E"),
        toLink("Current Focus"),
        toLink("Recovery Procedures"),
      ]),
    ].join("\n"),
  };
}

function buildStrategicRoadmapNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const strategy = input.record.sections.strategy_memory;
  return {
    title: "Strategic Roadmap",
    directory: "Strategy",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_strategy_view",
      tags: ["second-brain", "strategy", "roadmap", "obsidian-export"],
    },
    body: [
      "## Roadmap",
      asBulletList(strategy.roadmap),
      "",
      "## Next Milestone",
      asBulletList([strategy.next_milestone]),
      "",
      "## Long Term Goals",
      asBulletList(strategy.long_term_goals),
      "",
      "## Hands-Off Readiness",
      asBulletList([
        `Decision making target: ${strategy.hands_off_readiness.decision_making_target_percent}%`,
        `Learning target: ${strategy.hands_off_readiness.learning_target_percent}%`,
        `Current full hands-off production: ${strategy.hands_off_readiness.current_full_hands_off_percent}%`,
        `Next full hands-off target: ${strategy.hands_off_readiness.next_full_hands_off_target_percent}%`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Current Focus"),
        toLink("AI-E"),
        toLink("Recovery Procedures"),
      ]),
    ].join("\n"),
  };
}

function buildSessionContinuitySummaryNote(input: {
  record: SecondBrainRecord;
  repoProjectContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  const workingMemory = input.record.sections.working_memory;
  const recentOutcomes = input.record.sections.outcome_memory.latest_outcomes.slice(0, 6).map((outcome) => {
    const linkedProject = outcome.project_key === "ai-e" ? toLink("AI-E") : toLink("BABYLON 2026");
    return `${linkedProject}: ${outcome.task_title} -> ${outcome.status}`;
  });

  return {
    title: "Session Continuity Summary",
    directory: "Sessions",
    metadata: {
      project_key: input.repoProjectContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_session_summary",
      tags: ["second-brain", "session", "continuity", "obsidian-export"],
    },
    body: [
      "## Session Anchor",
      asBulletList([
        `Latest derived session id: ${input.latestSessionId}`,
        `Resolved repo project: ${input.repoProjectContext.project.title}`,
        `Resume checkpoint: ${workingMemory.resume_checkpoint}`,
      ]),
      "",
      "## Current Objective",
      asBulletList([
        workingMemory.current_task_state,
        workingMemory.current_objective,
      ]),
      "",
      "## Recent Errors And Fixes",
      asBulletList(workingMemory.recent_errors_fixes),
      "",
      "## Recent Outcomes",
      asBulletList(recentOutcomes),
      "",
      "## Related",
      asBulletList([
        toLink("Outcome History"),
        toLink("Current Project State"),
        toLink("Recovery Procedures"),
      ]),
    ].join("\n"),
  };
}

function buildCinematicProductionMemoryNote(input: {
  record: SecondBrainRecord;
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Cinematic Production Memory",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_cinematic_memory_view",
      tags: ["second-brain", "cinematic", "production-memory", "obsidian-export"],
    },
    body: [
      "## Mission Layer",
      asBulletList([
        production.mission_layer,
        `Primary case study: ${toLink("BABYLON Cutscene Layer")}`,
      ]),
      "",
      "## Core Systems",
      asBulletList(production.roadmap_systems.map((entry) => `${entry.title} (${entry.status}) - ${entry.summary}`)),
      "",
      "## Characters",
      asBulletList(production.characters.map((entry) => `${entry.name}: ${entry.role}`)),
      "",
      "## Environments",
      asBulletList(production.environments.map((entry) => `${entry.name}: ${entry.mood}`)),
      "",
      "## Story Beats",
      asBulletList(production.story_beats.map((entry) => `${entry.title}: ${entry.summary}`)),
      "",
      "## Style Foundations",
      asBulletList([
        `Emotional tone: ${production.emotional_tone.join(", ")}`,
        `Visual style: ${production.visual_style.join(", ")}`,
        `Camera language: ${production.camera_language.join(", ")}`,
        `Lighting: ${production.lighting.join(", ")}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON Cutscene Layer"),
        toLink("Shot Planning Rules"),
        toLink("Continuity Rules"),
        toLink("Scene Sequences"),
        toLink("Gameplay Cutscene Triggers"),
        toLink("Generation Job Queue"),
        toLink("Provider Routing Rules"),
        toLink("Cinematic Execution Lifecycle"),
        toLink("Cost-Aware Iteration Notes"),
        toLink("Cost-Aware Generation Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildBabylonCutsceneLayerNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "BABYLON Cutscene Layer",
    directory: "Projects",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_babylon_cutscene_layer",
      tags: ["second-brain", "babylon-2026", "cutscene", "obsidian-export"],
    },
    body: [
      "## Gameplay Context",
      asBulletList([
        `Current sequence: ${production.gameplay_context.current_sequence}`,
        ...production.gameplay_context.trigger_conditions.map((entry) => `Trigger: ${entry}`),
        ...production.gameplay_context.player_state_requirements.map((entry) => `Player state: ${entry}`),
      ]),
      "",
      "## Story Beats",
      asBulletList(production.story_beats.map((entry) => `${entry.title} -> ${entry.gameplay_trigger}`)),
      "",
      "## Pacing Notes",
      asBulletList(production.pacing_notes),
      "",
      "## Related",
      asBulletList([
        toLink("Cinematic Production Memory"),
        toLink("Shot Planning Rules"),
        toLink("Scene Sequences"),
        toLink("Gameplay Cutscene Triggers"),
        toLink("Generation Job Queue"),
        toLink("Successful Generations"),
      ]),
    ].join("\n"),
  };
}

function buildShotPlanningRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Shot Planning Rules",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_shot_planning_rules",
      tags: ["second-brain", "shot-planning", "cinematic", "obsidian-export"],
    },
    body: [
      "## Shot History",
      asBulletList(production.shot_history.map((entry) => `${entry.shot_id}: ${entry.intent} | ${entry.camera_framing} | ${entry.camera_motion}`)),
      "",
      "## Camera Language",
      asBulletList(production.camera_language),
      "",
      "## Edit Decisions",
      asBulletList(production.edit_decisions),
      "",
      "## Sequence Planning",
      asBulletList(production.scene_sequences.map((entry) => `${entry.sequence_id}: ${entry.title} | shots=${entry.shots.length}`)),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON Cutscene Layer"),
        toLink("Continuity Rules"),
        toLink("Shot Progression Examples"),
        toLink("Cost-Aware Iteration Notes"),
      ]),
    ].join("\n"),
  };
}

function buildCinematicContinuityRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Continuity Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_cinematic_continuity_rules",
      tags: ["second-brain", "continuity", "cinematic", "obsidian-export"],
    },
    body: [
      "## Core Rules",
      asBulletList(production.continuity_rules),
      "",
      "## Beat Dependencies",
      asBulletList(production.story_beats.flatMap((entry) => entry.continuity_dependencies.map((dependency) => `${entry.title}: ${dependency}`))),
      "",
      "## Character Safeguards",
      asBulletList(production.characters.flatMap((entry) => entry.continuity_rules.map((rule) => `${entry.name}: ${rule}`))),
      "",
      "## Sequence Dependencies",
      asBulletList(production.scene_sequences.flatMap((entry) => entry.shots.flatMap((shot) => shot.continuity_dependencies.map((dependency) => `${entry.title} / ${shot.shot_purpose}: ${dependency}`)))),
      "",
      "## Related",
      asBulletList([
        toLink("Cinematic Production Memory"),
        toLink("BABYLON Cutscene Layer"),
        toLink("Continuity Validation Rules"),
        toLink("Retry Planning Rules"),
        toLink("Failed Generations"),
      ]),
    ].join("\n"),
  };
}

function buildAssetReuseLogNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Asset Reuse Log",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_asset_reuse_log",
      tags: ["second-brain", "asset-reuse", "cinematic", "obsidian-export"],
    },
    body: [
      "## Generated Assets",
      asBulletList(production.generated_assets.map((entry) => `${entry.asset_id}: ${entry.label} (${entry.kind}) | reusable=${entry.reusable}`)),
      "",
      "## Reuse Notes",
      asBulletList(production.generated_assets.flatMap((entry) => entry.reuse_notes.map((note) => `${entry.asset_id}: ${note}`))),
      "",
      "## Asset Reuse Decisions",
      asBulletList(production.asset_reuse_decisions),
      "",
      "## Related",
      asBulletList([
        toLink("Successful Generations"),
        toLink("Cost-Aware Iteration Notes"),
        toLink("Asset Reuse Decisions"),
        toLink("Sandbox Simulation Results"),
        toLink("Shot Planning Rules"),
      ]),
    ].join("\n"),
  };
}

function buildSceneSequencesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Scene Sequences",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_scene_sequences",
      tags: ["second-brain", "cinematic", "scene-sequences", "obsidian-export"],
    },
    body: [
      "## Planned Sequences",
      asBulletList(production.scene_sequences.map((entry) => `${entry.sequence_id}: ${entry.title} | beat=${entry.beat_id} | shots=${entry.shots.length}`)),
      "",
      "## Shot Order",
      asBulletList(production.scene_sequences.flatMap((entry) => entry.shots.map((shot) => `${entry.title}: ${shot.shot_order}. ${shot.shot_purpose} | ${shot.camera_behavior} | ${shot.transition_notes}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Shot Planning Rules"),
        toLink("Shot Progression Examples"),
        toLink("Gameplay Cutscene Triggers"),
      ]),
    ].join("\n"),
  };
}

function buildGameplayCutsceneTriggersNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Gameplay Cutscene Triggers",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_gameplay_cutscene_triggers",
      tags: ["second-brain", "cinematic", "triggers", "obsidian-export"],
    },
    body: [
      "## Trigger Plans",
      asBulletList(production.gameplay_cutscene_triggers.map((entry) => `${entry.trigger_id}: ${entry.title} | ${entry.trigger_type} | ${entry.gameplay_state} -> ${entry.cinematic_state}`)),
      "",
      "## Activation Conditions",
      asBulletList(production.gameplay_cutscene_triggers.flatMap((entry) => entry.activation_conditions.map((condition) => `${entry.title}: ${condition}`))),
      "",
      "## Related",
      asBulletList([
        toLink("BABYLON Cutscene Layer"),
        toLink("Scene Sequences"),
        toLink("Continuity Validation Rules"),
      ]),
    ].join("\n"),
  };
}

function buildContinuityValidationRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Continuity Validation Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_continuity_validation_rules",
      tags: ["second-brain", "cinematic", "continuity-validation", "obsidian-export"],
    },
    body: [
      "## Validation Categories",
      asBulletList([
        "character continuity",
        "environment continuity",
        "lighting continuity",
        "prop continuity",
        "tone continuity",
        "camera continuity",
        "timeline consistency",
      ]),
      "",
      "## Sequence Checks",
      asBulletList(production.scene_sequences.flatMap((entry) => entry.shots.map((shot) => `${entry.title}: ${shot.shot_id} | env=${shot.environment_id} | tone=${shot.tone_reference} | timeline=${shot.timeline_position}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Continuity Rules"),
        toLink("Scene Sequences"),
        toLink("Failed Generations"),
      ]),
    ].join("\n"),
  };
}

function buildShotProgressionExamplesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Shot Progression Examples",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_shot_progression_examples",
      tags: ["second-brain", "cinematic", "shot-progression", "obsidian-export"],
    },
    body: [
      "## Progression Patterns",
      asBulletList(production.scene_sequences.map((entry) => `${entry.title}: ${entry.shots.map((shot) => shot.shot_purpose).join(" -> ")}`)),
      "",
      "## Transition Notes",
      asBulletList(production.scene_sequences.flatMap((entry) => entry.shots.map((shot) => `${shot.shot_id}: ${shot.transition_notes}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Scene Sequences"),
        toLink("Shot Planning Rules"),
        toLink("Gameplay Cutscene Triggers"),
      ]),
    ].join("\n"),
  };
}

function buildAssetReuseDecisionsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Asset Reuse Decisions",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_asset_reuse_decisions",
      tags: ["second-brain", "cinematic", "asset-reuse-decisions", "obsidian-export"],
    },
    body: [
      "## Decisions",
      asBulletList(production.asset_reuse_decisions),
      "",
      "## Reusable Assets",
      asBulletList(production.generated_assets.filter((entry) => entry.reusable).map((entry) => `${entry.asset_id}: ${entry.label}`)),
      "",
      "## Related",
      asBulletList([
        toLink("Asset Reuse Log"),
        toLink("Successful Generations"),
        toLink("Shot Progression Examples"),
      ]),
    ].join("\n"),
  };
}

function buildFailedGenerationsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Failed Generations",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_failed_generations",
      tags: ["second-brain", "failed-generations", "cinematic", "obsidian-export"],
    },
    body: [
      "## Failed Attempts",
      asBulletList(production.failed_generations.map((entry) => `${entry.generation_id}: ${entry.prompt_summary} | cost=${entry.cost_tier}`)),
      "",
      "## Failure Notes",
      asBulletList(production.failed_generations.flatMap((entry) => entry.notes.map((note) => `${entry.generation_id}: ${note}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Continuity Rules"),
        toLink("Cost-Aware Iteration Notes"),
        toLink("Successful Generations"),
      ]),
    ].join("\n"),
  };
}

function buildSuccessfulGenerationsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Successful Generations",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_successful_generations",
      tags: ["second-brain", "successful-generations", "cinematic", "obsidian-export"],
    },
    body: [
      "## Approved Results",
      asBulletList(production.successful_generations.map((entry) => `${entry.generation_id}: ${entry.prompt_summary} | cost=${entry.cost_tier}`)),
      "",
      "## Success Notes",
      asBulletList(production.successful_generations.flatMap((entry) => entry.notes.map((note) => `${entry.generation_id}: ${note}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Asset Reuse Log"),
        toLink("Shot Planning Rules"),
        toLink("Cost-Aware Iteration Notes"),
      ]),
    ].join("\n"),
  };
}

function buildCostAwareIterationNotes(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Cost-Aware Iteration Notes",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_cost_aware_iteration_notes",
      tags: ["second-brain", "cost-aware", "cinematic", "obsidian-export"],
    },
    body: [
      "## Iteration Notes",
      asBulletList(production.cost_aware_iteration_notes),
      "",
      "## Cost Summary",
      asBulletList([
        `Failed generations tracked: ${production.failed_generations.length}`,
        `Successful generations tracked: ${production.successful_generations.length}`,
        `Reusable assets tracked: ${production.generated_assets.filter((entry) => entry.reusable).length}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Failed Generations"),
        toLink("Successful Generations"),
        toLink("Asset Reuse Log"),
        toLink("Generation Job Queue"),
        toLink("Cost-Aware Generation Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildGenerationJobQueueNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const jobs = production.generation_jobs;
  const sequenceCoverage = [...new Set(jobs.map((entry) => entry.sequence_id))].map((sequenceId) => {
    const sequenceJobs = jobs.filter((entry) => entry.sequence_id === sequenceId);
    return `${sequenceId}: jobs=${sequenceJobs.length} | providers=${[...new Set(sequenceJobs.map((entry) => entry.provider))].join(", ") || "none"}`;
  });

  return {
    title: "Generation Job Queue",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_generation_job_queue",
      tags: ["second-brain", "generation-jobs", "cinematic", "obsidian-export"],
    },
    body: [
      "## Planned Jobs",
      asBulletList(jobs.length > 0
        ? jobs.map((entry) => `${entry.job_id}: ${entry.sequence_id} / ${entry.shot_id} | provider=${entry.provider} | status=${entry.generation_status} | validation=${entry.validation_state}`)
        : ["No generation jobs planned yet."]),
      "",
      "## Sequence Coverage",
      asBulletList(sequenceCoverage.length > 0 ? sequenceCoverage : ["No sequence coverage recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Routing Rules"),
        toLink("Cinematic Execution Lifecycle"),
        toLink("Sandbox Simulation Results"),
      ]),
    ].join("\n"),
  };
}

function buildProviderRoutingRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const observedProviders = [...new Set([...production.generation_jobs.map((entry) => entry.provider), "LocalFutureProvider"])];
  return {
    title: "Provider Routing Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_provider_routing_rules",
      tags: ["second-brain", "provider-routing", "cinematic", "obsidian-export"],
    },
    body: [
      "## Routing Rules",
      asBulletList(production.provider_routing_rules),
      "",
      "## Observed Providers",
      asBulletList(observedProviders.map((entry) => entry)),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Job Queue"),
        toLink("Provider Capability Registry"),
        toLink("Prompt Normalization Rules"),
        toLink("Cinematic Execution Lifecycle"),
        toLink("Cost-Aware Generation Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildProviderCapabilityRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Provider Capability Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_provider_capability_registry",
      tags: ["second-brain", "provider-capabilities", "cinematic", "obsidian-export"],
    },
    body: [
      "## Provider Capabilities",
      asBulletList(production.provider_capability_registry.map((entry) => `${entry.provider}: duration<=${entry.max_duration_seconds}s | prompt<=${entry.max_prompt_characters} chars | refs<=${entry.max_image_references} | continuity=${entry.continuity_support} | queue=${entry.queue_behavior}`)),
      "",
      "## Retry Guidance",
      asBulletList(production.provider_capability_registry.map((entry) => `${entry.provider}: ${entry.retry_recommendation}`)),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Routing Rules"),
        toLink("Prompt Normalization Rules"),
        toLink("Provider Payload Examples"),
      ]),
    ].join("\n"),
  };
}

function buildPromptNormalizationRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const providerHeaders = production.provider_capability_registry.map((entry) => `${entry.provider}: ${entry.provider === "Sora" ? "Sora cinematic brief" : entry.provider === "Seedance" ? "Seedance storyboard draft" : entry.provider === "Runway" ? "Runway director prompt" : entry.provider === "Veo" ? "Veo scene payload" : "Generator-agnostic local bridge payload"}`);
  return {
    title: "Prompt Normalization Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_prompt_normalization_rules",
      tags: ["second-brain", "prompt-normalization", "cinematic", "obsidian-export"],
    },
    body: [
      "## Normalization Rules",
      asBulletList(production.prompt_normalization_rules),
      "",
      "## Provider Variants",
      asBulletList(providerHeaders),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Capability Registry"),
        toLink("Provider Payload Examples"),
        toLink("Generation Budget Rules"),
      ]),
    ].join("\n"),
  };
}

function buildGenerationBudgetRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const policy = production.generation_budget_policy;
  return {
    title: "Generation Budget Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_generation_budget_rules",
      tags: ["second-brain", "generation-budget", "cinematic", "obsidian-export"],
    },
    body: [
      "## Budget Rules",
      asBulletList(production.generation_budget_rules),
      "",
      "## Active Policy",
      asBulletList([
        `Max shots per batch: ${policy.max_shots_per_batch}`,
        `Max retries per job: ${policy.max_retries_per_job}`,
        `Estimated budget cap: ${policy.max_estimated_sequence_cost}`,
        `Provider cooldown minutes: ${policy.provider_cooldown_minutes}`,
        `Sandbox-only mode: ${policy.sandbox_only_mode ? "enabled" : "disabled"}`,
        `Manual approval required: ${policy.manual_approval_required ? "yes" : "no"}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Manual Approval Workflow"),
        toLink("Cost Forecast Examples"),
        toLink("Provider Payload Examples"),
      ]),
    ].join("\n"),
  };
}

function buildManualApprovalWorkflowNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const approvalPendingCount = production.generation_jobs.filter((entry) => entry.manual_approval_status === "pending").length;
  return {
    title: "Manual Approval Workflow",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_manual_approval_workflow",
      tags: ["second-brain", "manual-approval", "cinematic", "obsidian-export"],
    },
    body: [
      "## Workflow",
      asBulletList(production.manual_approval_workflow),
      "",
      "## Approval Queue",
      asBulletList([
        `Jobs awaiting approval: ${approvalPendingCount}`,
        `Sandbox-only mode: ${production.generation_budget_policy.sandbox_only_mode ? "still blocking real execution" : "lifted"}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Budget Rules"),
        toLink("Generation Job Queue"),
        toLink("Cinematic Execution Lifecycle"),
      ]),
    ].join("\n"),
  };
}

function buildOperatorApprovalQueueNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const queuedJobs = production.generation_jobs.filter((entry) => entry.manual_approval_status !== "archived");
  return {
    title: "Operator Approval Queue",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_operator_approval_queue",
      tags: ["second-brain", "operator-approval", "cinematic", "obsidian-export"],
    },
    body: [
      "## Queued Jobs",
      asBulletList(queuedJobs.length > 0
        ? queuedJobs.map((entry) => `${entry.job_id}: approval=${entry.manual_approval_status} | provider=${entry.provider} | token=${entry.approval_token_id ?? "none"} | deferred_until=${entry.deferred_until ?? "n/a"}`)
        : ["No operator-facing jobs are queued yet."]),
      "",
      "## Governance Summary",
      asBulletList([
        `Pending approvals: ${production.generation_jobs.filter((entry) => entry.manual_approval_status === "pending").length}`,
        `Approved jobs: ${production.generation_jobs.filter((entry) => entry.manual_approval_status === "approved").length}`,
        `Deferred jobs: ${production.generation_jobs.filter((entry) => entry.manual_approval_status === "deferred").length}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Manual Approval Workflow"),
        toLink("Execution Readiness Checklist"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildExecutionReadinessChecklistNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const activeTokens = production.execution_approval_tokens.filter((entry) => entry.active);
  const approvedJobs = production.generation_jobs.filter((entry) => entry.manual_approval_status === "approved");
  return {
    title: "Execution Readiness Checklist",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_readiness_checklist",
      tags: ["second-brain", "execution-readiness", "cinematic", "obsidian-export"],
    },
    body: [
      "## Checklist",
      asBulletList([
        `Explicit approval tokens active: ${activeTokens.length}`,
        `Sandbox-only mode: ${production.generation_budget_policy.sandbox_only_mode ? "still blocking real execution" : "lifted"}`,
        `Approved jobs with token references: ${approvedJobs.filter((entry) => entry.approval_token_id).length}`,
        `Deferred plans requiring revisit: ${production.deferred_execution_plans.filter((entry) => entry.status === "deferred").length}`,
      ]),
      "",
      "## Hard Gates",
      asBulletList([
        "Continuity validation remains mandatory before any future execution handoff.",
        "Budget enforcement remains hard-gated even after operator approval.",
        "Approval tokens must stay explicit and time-scoped.",
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Operator Approval Queue"),
        toLink("Generation Budget Rules"),
        toLink("Deferred Execution Plans"),
      ]),
    ].join("\n"),
  };
}

function buildBudgetGovernanceDecisionsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Budget Governance Decisions",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_budget_governance_decisions",
      tags: ["second-brain", "budget-governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Decisions",
      asBulletList(production.budget_governance_decisions.length > 0
        ? production.budget_governance_decisions.map((entry) => `${entry.decision_id}: override=${entry.approved_override ? "approved" : "rejected"} | requested_cap=${entry.requested_budget_cap} | reason=${entry.reason}`)
        : ["No budget governance decisions recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Budget Rules"),
        toLink("Execution Readiness Checklist"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildApprovalAuditTrailNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Approval Audit Trail",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_approval_audit_trail",
      tags: ["second-brain", "approval-audit", "cinematic", "obsidian-export"],
    },
    body: [
      "## Audit Entries",
      asBulletList(production.approval_audit_trail.length > 0
        ? production.approval_audit_trail.map((entry) => `${entry.append_only_index}. ${entry.action} | operator=${entry.operator_id} | ${entry.detail}`)
        : ["No approval audit entries recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Operator Approval Queue"),
        toLink("Budget Governance Decisions"),
        toLink("Deferred Execution Plans"),
      ]),
    ].join("\n"),
  };
}

function buildContinuityReviewNotesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Continuity Review Notes",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_continuity_review_notes",
      tags: ["second-brain", "continuity-review", "cinematic", "obsidian-export"],
    },
    body: [
      "## Review Notes",
      asBulletList(production.continuity_review_notes.length > 0
        ? production.continuity_review_notes.map((entry) => `${entry.note_id}: shot=${entry.shot_id ?? "sequence"} | detail=${entry.detail}`)
        : ["No continuity review notes recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Continuity Validation Rules"),
        toLink("Operator Approval Queue"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildDeferredExecutionPlansNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Deferred Execution Plans",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_deferred_execution_plans",
      tags: ["second-brain", "deferred-execution", "cinematic", "obsidian-export"],
    },
    body: [
      "## Deferred Plans",
      asBulletList(production.deferred_execution_plans.length > 0
        ? production.deferred_execution_plans.map((entry) => `${entry.defer_id}: status=${entry.status} | until=${entry.deferred_until} | reason=${entry.reason}`)
        : ["No deferred execution plans recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Operator Approval Queue"),
        toLink("Execution Readiness Checklist"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildRealProviderDryRunNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const queuedJobs = production.generation_jobs.filter((entry) => entry.manual_approval_status !== "archived");
  return {
    title: "Real Provider Dry Run",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_real_provider_dry_run",
      tags: ["second-brain", "provider-dry-run", "cinematic", "obsidian-export"],
    },
    body: [
      "## Dry-Run Readiness",
      asBulletList(queuedJobs.length > 0
        ? queuedJobs.slice(0, 8).map((entry) => `${entry.job_id}: provider=${entry.provider} | approval=${entry.manual_approval_status} | retry=${entry.retry_count}`)
        : ["No real-provider dry-run previews generated yet."]),
      "",
      "## Guardrails",
      asBulletList([
        `Sandbox-only mode remains ${production.generation_budget_policy.sandbox_only_mode ? "enabled" : "disabled"}.`,
        "Dry-run previews simulate provider acceptance or rejection without calling any provider.",
        "Operator review remains mandatory before any manual submission package is used.",
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Operator Approval Queue"),
        toLink("Execution Readiness Checklist"),
        toLink("Submission Package Examples"),
      ]),
    ].join("\n"),
  };
}

function buildSubmissionPackageExamplesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const queuedJobs = production.generation_jobs.filter((entry) => entry.manual_approval_status !== "archived");
  return {
    title: "Submission Package Examples",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_submission_package_examples",
      tags: ["second-brain", "submission-package", "cinematic", "obsidian-export"],
    },
    body: [
      "## Package Structure",
      asBulletList([
        "Sequence package: sequence id, title, provider target, and bounded cost summary.",
        "Shot package: per-shot prompt summary, continuity references, retry metadata, and asset references.",
        "Provider package: provider-ready JSON plus execution notes for manual submission.",
      ]),
      "",
      "## Current Examples",
      asBulletList(queuedJobs.length > 0
        ? queuedJobs.slice(0, 6).map((entry) => `${entry.job_id}: sequence=${entry.sequence_id} | shot=${entry.shot_id} | provider=${entry.provider}`)
        : ["No submission packages prepared yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Execution Manifest Examples"),
        toLink("Real Provider Dry Run"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildApprovalEscalationRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const costThreshold = Math.floor(production.generation_budget_policy.max_estimated_sequence_cost * 0.5);
  const retryThreshold = Math.max(1, production.generation_budget_policy.max_retries_per_job - 1);
  const largeBatchThreshold = Math.max(4, Math.ceil(production.generation_budget_policy.max_shots_per_batch * 0.75));
  return {
    title: "Approval Escalation Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_approval_escalation_rules",
      tags: ["second-brain", "approval-escalation", "cinematic", "obsidian-export"],
    },
    body: [
      "## Escalation Thresholds",
      asBulletList([
        `Escalate when estimated cost exceeds ${costThreshold}.`,
        `Escalate when retry count reaches ${retryThreshold}.`,
        `Escalate when selected batch size reaches ${largeBatchThreshold} jobs.`,
      ]),
      "",
      "## Mandatory Escalations",
      asBulletList([
        "Premium-provider selection requires an extra approval pass.",
        "Continuity-risk increases require explicit operator acknowledgement.",
        "Large sequence batches require a second review before manual submission.",
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Budget Rules"),
        toLink("Real Provider Dry Run"),
        toLink("Execution Readiness Checklist"),
      ]),
    ].join("\n"),
  };
}

function buildProviderConstraintMatrixNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Provider Constraint Matrix",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_provider_constraint_matrix",
      tags: ["second-brain", "provider-constraints", "cinematic", "obsidian-export"],
    },
    body: [
      "## Constraint Matrix",
      asBulletList(production.provider_capability_registry.map((entry) => `${entry.provider}: duration<=${entry.max_duration_seconds}s | prompt<=${entry.max_prompt_characters} | resolutions=${entry.supported_resolutions.join(",")} | fps=${entry.supported_frame_rates.join(",")} | continuity=${entry.continuity_support} | refs<=${entry.max_image_references}`)),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Capability Registry"),
        toLink("Real Provider Dry Run"),
        toLink("Provider Comparison Notes"),
      ]),
    ].join("\n"),
  };
}

function buildExecutionManifestExamplesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const approvedJobs = production.generation_jobs.filter((entry) => entry.manual_approval_status === "approved");
  return {
    title: "Execution Manifest Examples",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_manifest_examples",
      tags: ["second-brain", "execution-manifest", "cinematic", "obsidian-export"],
    },
    body: [
      "## Manifest Fields",
      asBulletList([
        "Manual execution only flag remains true.",
        "Estimated queue time, cost impact, and continuity preservation are preview-only outputs.",
        "Blocked reasons stay attached to the manifest until the operator resolves them.",
      ]),
      "",
      "## Current Examples",
      asBulletList(approvedJobs.length > 0
        ? approvedJobs.slice(0, 6).map((entry) => `${entry.job_id}: token=${entry.approval_token_id ?? "none"} | provider=${entry.provider} | deferred_until=${entry.deferred_until ?? "n/a"}`)
        : ["No execution manifests prepared yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Submission Package Examples"),
        toLink("Execution Readiness Checklist"),
        toLink("Approval Audit Trail"),
      ]),
    ].join("\n"),
  };
}

function buildProviderComparisonNotesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Provider Comparison Notes",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_provider_comparison_notes",
      tags: ["second-brain", "provider-comparison", "cinematic", "obsidian-export"],
    },
    body: [
      "## Comparison Snapshot",
      asBulletList(production.provider_capability_registry.map((entry) => `${entry.provider}: draft=${entry.estimated_cost_profile.draft} | premium=${entry.estimated_cost_profile.premium} | continuity=${entry.continuity_support} | queue=${entry.queue_behavior}`)),
      "",
      "## Comparison Lens",
      asBulletList([
        "Compare providers by cost, duration support, continuity support, retry tolerance, queue behavior, and risk.",
        "Provider selection remains advisory until the operator manually prepares a submission package.",
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Constraint Matrix"),
        toLink("Cost Forecast Examples"),
        toLink("Real Provider Dry Run"),
      ]),
    ].join("\n"),
  };
}

function buildLocalModelRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Local Model Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_model_registry",
      tags: ["second-brain", "local-models", "cinematic", "obsidian-export"],
    },
    body: [
      "## Registered Local Candidates",
      asBulletList(production.local_model_registry.map((entry) => `${entry.display_name}: status=${entry.status} | mode=${entry.generation_mode} | resolutions=${entry.supported_resolutions.join(",")} | duration<=${entry.max_duration_seconds}s | continuity=${entry.continuity_support} | vram>=${entry.vram_requirement_gb}GB`)),
      "",
      "## Quantization And Storage",
      asBulletList(production.local_model_registry.map((entry) => `${entry.model_id}: quantization=${entry.quantization_profiles.join(",")} | storage>=${entry.storage_requirement_gb}GB`)),
      "",
      "## Related",
      asBulletList([
        toLink("Local Runtime Readiness"),
        toLink("Hardware Capability Planning"),
        toLink("Future Local Inference Notes"),
      ]),
    ].join("\n"),
  };
}

function buildLocalRuntimeReadinessNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Local Runtime Readiness",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_runtime_readiness",
      tags: ["second-brain", "local-runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Runtime Registry",
      asBulletList(production.local_runtime_capability_registry.map((entry) => `${entry.display_name}: status=${entry.status} | family=${entry.runtime_family} | backends=${entry.supported_backends.join(",")} | cache=${entry.supports_asset_cache ? "yes" : "no"}`)),
      "",
      "## Readiness Rules",
      asBulletList(production.local_runtime_readiness_rules),
      "",
      "## Related",
      asBulletList([
        toLink("Local Model Registry"),
        toLink("Hardware Capability Planning"),
        toLink("Local-vs-Cloud Routing"),
      ]),
    ].join("\n"),
  };
}

function buildHardwareCapabilityPlanningNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Hardware Capability Planning",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_hardware_capability_planning",
      tags: ["second-brain", "hardware-planning", "cinematic", "obsidian-export"],
    },
    body: [
      "## Hardware Profiles",
      asBulletList(production.local_hardware_profiles.map((entry) => `${entry.display_name}: status=${entry.status} | backend=${entry.accelerator_backend} | vram=${entry.gpu_vram_gb}GB | ram=${entry.system_ram_gb}GB | storage=${entry.storage_free_gb}GB | max=${entry.recommended_max_resolution}/${entry.recommended_max_duration_seconds}s`)),
      "",
      "## Encoder Support",
      asBulletList(production.local_hardware_profiles.map((entry) => `${entry.profile_id}: encoders=${entry.encoder_support.join(",")}`)),
      "",
      "## Related",
      asBulletList([
        toLink("Local Runtime Readiness"),
        toLink("Local Model Registry"),
        toLink("Local Asset Cache Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildLocalVsCloudRoutingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Local-vs-Cloud Routing",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_vs_cloud_routing",
      tags: ["second-brain", "routing", "local-cloud", "obsidian-export"],
    },
    body: [
      "## Local Routing Rules",
      asBulletList(production.local_provider_routing_rules),
      "",
      "## Existing Global Routing Rules",
      asBulletList(production.provider_routing_rules.filter((entry) => /local|offline|cloud|provider/i.test(entry))),
      "",
      "## Related",
      asBulletList([
        toLink("Local Runtime Readiness"),
        toLink("Provider Routing Rules"),
        toLink("Provider Comparison Notes"),
      ]),
    ].join("\n"),
  };
}

function buildFutureLocalInferenceNotes(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Future Local Inference Notes",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_local_inference_notes",
      tags: ["second-brain", "local-inference", "cinematic", "obsidian-export"],
    },
    body: [
      "## Planning Notes",
      asBulletList(production.local_inference_notes),
      "",
      "## Governance Guardrails",
      asBulletList(production.local_inference_governance_rules),
      "",
      "## Related",
      asBulletList([
        toLink("Local Model Registry"),
        toLink("Local Runtime Readiness"),
        toLink("Execution Readiness Checklist"),
      ]),
    ].join("\n"),
  };
}

function buildLocalAssetCacheStrategyNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Local Asset Cache Strategy",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_asset_cache_strategy",
      tags: ["second-brain", "local-cache", "cinematic", "obsidian-export"],
    },
    body: [
      "## Cache Strategy",
      asBulletList(production.local_asset_cache_strategy),
      "",
      "## Runtime Support",
      asBulletList(production.local_runtime_capability_registry.map((entry) => `${entry.display_name}: asset cache ${entry.supports_asset_cache ? "supported" : "not supported"}`)),
      "",
      "## Related",
      asBulletList([
        toLink("Hardware Capability Planning"),
        toLink("Future Local Inference Notes"),
        toLink("Asset Reuse Decisions"),
      ]),
    ].join("\n"),
  };
}

function buildReadinessPercentagesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
  milestoneProgress: Awaited<ReturnType<typeof getCinematicReadinessMilestoneProgress>>;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "AI-E Readiness Percentages",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_readiness_percentages",
      tags: ["second-brain", "readiness", "percentages", "cinematic", "obsidian-export"],
    },
    body: [
      "## Milestone Progress",
      asBulletList(input.milestoneProgress.map((entry) => `${humanizeReadinessMilestone(entry.milestone)}: ${entry.percentage}% | confidence=${entry.confidence} | next=${entry.next_required_milestone}`)),
      "",
      "## Current Blockers",
      asBulletList(input.milestoneProgress.flatMap((entry) => entry.blockers.map((blocker) => `${humanizeReadinessMilestone(entry.milestone)}: ${blocker}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Local Runtime Probe Results"),
        toLink("Frame Generation Pipeline Planning"),
        toLink("Hybrid Local Cloud Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildLocalRuntimeProbeResultsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSnapshot = [...production.local_runtime_probe_snapshots].sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  return {
    title: "Local Runtime Probe Results",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_runtime_probe_results",
      tags: ["second-brain", "runtime-probe", "cinematic", "obsidian-export"],
    },
    body: [
      "## Probe Hints",
      asBulletList([
        `CUDA hints: ${production.local_runtime_probe_path_hints.cuda_paths.join(", ")}`,
        `FFmpeg hints: ${production.local_runtime_probe_path_hints.ffmpeg_paths.join(", ")}`,
        `Python hints: ${production.local_runtime_probe_path_hints.python_paths.join(", ")}`,
      ]),
      "",
      "## Latest Snapshot",
      latestSnapshot
        ? asBulletList([
          `Snapshot: ${latestSnapshot.snapshot_id}`,
          `Recorded at: ${latestSnapshot.recorded_at}`,
          `GPU vendor: ${latestSnapshot.gpu_vendor ?? "unknown"}`,
          `Storage estimate: ${latestSnapshot.storage_free_gb_estimate ?? "unknown"}GB`,
        ])
        : "- No runtime probe snapshots recorded yet.",
      "",
      "## Probe Results",
      latestSnapshot
        ? asBulletList(latestSnapshot.results.map((entry) => `${entry.probe_id}: status=${entry.status} | observed=${entry.observed_value ?? "n/a"} | detected_paths=${entry.detected_paths.length}`))
        : "- No probe results available.",
      "",
      "## Related",
      asBulletList([
        toLink("AI-E Readiness Percentages"),
        toLink("Runtime Constraint Modeling"),
        toLink("Local Runtime Readiness"),
      ]),
    ].join("\n"),
  };
}

function buildFrameGenerationPipelinePlanningNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Frame Generation Pipeline Planning",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_frame_pipeline_planning",
      tags: ["second-brain", "frame-generation", "pipeline", "cinematic", "obsidian-export"],
    },
    body: [
      "## Stage Registry",
      asBulletList(production.frame_generation_stage_registry.map((entry) => `${entry.display_name}: status=${entry.status} | continuity-critical=${entry.continuity_critical ? "yes" : "no"} | dependencies=${entry.dependencies.join(", ")}`)),
      "",
      "## Stage Notes",
      asBulletList(production.frame_generation_stage_registry.flatMap((entry) => entry.notes.map((note) => `${entry.stage_id}: ${note}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Renderer Capability Roadmap"),
        toLink("Runtime Constraint Modeling"),
        toLink("AI-E Readiness Percentages"),
      ]),
    ].join("\n"),
  };
}

function buildRendererCapabilityRoadmapNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Renderer Capability Roadmap",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_renderer_capability_roadmap",
      tags: ["second-brain", "renderer", "roadmap", "cinematic", "obsidian-export"],
    },
    body: [
      "## Capability Roadmap",
      asBulletList(production.renderer_capability_roadmap.map((entry) => `${entry.display_name}: status=${entry.status} | dependencies=${entry.dependencies.join(", ")}`)),
      "",
      "## Capability Notes",
      asBulletList(production.renderer_capability_roadmap.flatMap((entry) => entry.notes.map((note) => `${entry.capability_id}: ${note}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Frame Generation Pipeline Planning"),
        toLink("Local Runtime Probe Results"),
        toLink("AI-E Readiness Percentages"),
      ]),
    ].join("\n"),
  };
}

function buildRuntimeConstraintModelingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Runtime Constraint Modeling",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_runtime_constraint_modeling",
      tags: ["second-brain", "runtime-constraints", "cinematic", "obsidian-export"],
    },
    body: [
      "## Constraint Models",
      asBulletList(production.runtime_constraint_models.map((entry) => `${entry.title}: vram tiers=${entry.minimum_vram_tiers_gb.join(",")}GB | low-vram fallback=${entry.low_vram_fallback_viable ? "yes" : "no"}`)),
      "",
      "## Offload Recommendations",
      asBulletList(production.runtime_constraint_models.flatMap((entry) => entry.hybrid_offload_recommendations.map((note) => `${entry.model_id}: ${note}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Local Runtime Probe Results"),
        toLink("Hybrid Local Cloud Strategy"),
        toLink("Frame Generation Pipeline Planning"),
      ]),
    ].join("\n"),
  };
}

function buildHybridLocalCloudStrategyNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Hybrid Local Cloud Strategy",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_hybrid_local_cloud_strategy",
      tags: ["second-brain", "hybrid-routing", "cinematic", "obsidian-export"],
    },
    body: [
      "## Strategy Registry",
      asBulletList(production.hybrid_local_cloud_strategies.map((entry) => `${entry.display_name}: status=${entry.status} | mode=${entry.preferred_provider_mode}`)),
      "",
      "## Escalation Conditions",
      asBulletList(production.hybrid_local_cloud_strategies.flatMap((entry) => entry.escalation_conditions.map((condition) => `${entry.strategy_id}: ${condition}`))),
      "",
      "## Related",
      asBulletList([
        toLink("Local-vs-Cloud Routing"),
        toLink("AI-E Readiness Percentages"),
        toLink("Runtime Constraint Modeling"),
      ]),
    ].join("\n"),
  };
}

function buildLocalExecutionSandboxNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSandbox = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-inference-execution-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  return {
    title: "Local Execution Sandbox",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_execution_sandbox",
      tags: ["second-brain", "local-sandbox", "cinematic", "obsidian-export"],
    },
    body: [
      "## Sandbox Status",
      latestSandbox
        ? asBulletList([
          `Sequence: ${latestSandbox.sequence_id}`,
          `Routing mode: ${latestSandbox.routing_mode}`,
          `Provider abstraction: ${latestSandbox.provider}`,
          `Execution enabled: ${latestSandbox.execution_enabled ? "yes" : "no"}`,
          `Readiness tracking id: ${latestSandbox.readiness_tracking_id ?? "none"}`,
        ])
        : "- No local execution sandbox simulations recorded yet.",
      "",
      "## Governance Guardrails",
      asBulletList(production.local_inference_governance_rules),
      "",
      "## Related",
      asBulletList([
        toLink("Renderer Lifecycle Simulation"),
        toLink("Queue Orchestration Planning"),
        toLink("Readiness Delta Tracking"),
      ]),
    ].join("\n"),
  };
}

function buildRendererLifecycleSimulationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSandbox = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-inference-execution-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  return {
    title: "Renderer Lifecycle Simulation",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_renderer_lifecycle_simulation",
      tags: ["second-brain", "renderer", "lifecycle", "cinematic", "obsidian-export"],
    },
    body: [
      "## Lifecycle States",
      latestSandbox?.renderer_lifecycle_states?.length
        ? asBulletList(latestSandbox.renderer_lifecycle_states.map((entry) => `${entry.order}. ${entry.state}: ${entry.detail} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No renderer lifecycle simulations recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Local Execution Sandbox"),
        toLink("GPU Allocation Modeling"),
        toLink("Renderer Recovery Planning"),
      ]),
    ].join("\n"),
  };
}

function buildGpuAllocationModelingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSandbox = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-inference-execution-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const allocation = latestSandbox?.gpu_allocation ?? null;
  return {
    title: "GPU Allocation Modeling",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_gpu_allocation_modeling",
      tags: ["second-brain", "gpu", "allocation", "cinematic", "obsidian-export"],
    },
    body: [
      "## Allocation Summary",
      allocation
        ? asBulletList([
          `Estimated VRAM required: ${allocation.estimated_vram_required_gb}GB`,
          `Available VRAM: ${allocation.available_vram_gb}GB`,
          `VRAM pressure: ${allocation.vram_pressure}`,
          `Max safe concurrency: ${allocation.max_safe_concurrency}`,
          `Queue starvation risk: ${allocation.queue_starvation_risk}`,
          `Low-VRAM fallback viable: ${allocation.low_vram_fallback_viable ? "yes" : "no"}`,
        ])
        : "- No GPU allocation models recorded yet.",
      "",
      "## Allocation Notes",
      allocation ? asBulletList(allocation.notes) : "- No GPU allocation notes recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Runtime Constraint Modeling"),
        toLink("Queue Orchestration Planning"),
        toLink("Renderer Lifecycle Simulation"),
      ]),
    ].join("\n"),
  };
}

function buildQueueOrchestrationPlanningNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSandbox = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-inference-execution-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const queuePlan = latestSandbox?.queue_plan ?? null;
  return {
    title: "Queue Orchestration Planning",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_queue_orchestration_planning",
      tags: ["second-brain", "queue", "orchestration", "cinematic", "obsidian-export"],
    },
    body: [
      "## Queue Summary",
      queuePlan
        ? asBulletList([
          `Dependency order: ${queuePlan.dependency_order_job_ids.join(", ") || "none"}`,
          `Blocked jobs: ${queuePlan.blocked_job_ids.join(", ") || "none"}`,
          `Recovery sequence: ${queuePlan.recovery_sequence_job_ids.join(", ") || "none"}`,
        ])
        : "- No queue orchestration plans recorded yet.",
      "",
      "## Simulated Queue Jobs",
      queuePlan?.queued_jobs?.length
        ? asBulletList(queuePlan.queued_jobs.map((entry) => `${entry.job_id}: state=${entry.state} | dependencies=${entry.dependency_job_ids.join(", ") || "none"} | blocked=${entry.blocked_reason ?? "no"}`))
        : "- No simulated queue jobs recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Local Execution Sandbox"),
        toLink("GPU Allocation Modeling"),
        toLink("Renderer Recovery Planning"),
      ]),
    ].join("\n"),
  };
}

function buildRendererRecoveryPlanningNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestSandbox = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-inference-execution-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const recoveryPlan = latestSandbox?.recovery_plan ?? null;
  return {
    title: "Renderer Recovery Planning",
    directory: "Recovery",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_renderer_recovery_planning",
      tags: ["second-brain", "renderer", "recovery", "cinematic", "obsidian-export"],
    },
    body: [
      "## Recovery Causes",
      recoveryPlan?.causes?.length
        ? asBulletList(recoveryPlan.causes.map((entry) => `${entry}`))
        : "- No renderer recovery causes recorded yet.",
      "",
      "## Recovery Steps",
      recoveryPlan?.steps?.length
        ? asBulletList(recoveryPlan.steps.map((entry) => `${entry.sequence_order}. ${entry.cause}: ${entry.detail}`))
        : "- No renderer recovery steps recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Renderer Lifecycle Simulation"),
        toLink("Queue Orchestration Planning"),
        toLink("Local Execution Sandbox"),
      ]),
    ].join("\n"),
  };
}

function buildReadinessDeltaTrackingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestTracking = production.readiness_delta_tracking_history[0] ?? null;
  return {
    title: "Readiness Delta Tracking",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_readiness_delta_tracking",
      tags: ["second-brain", "readiness", "delta-tracking", "cinematic", "obsidian-export"],
    },
    body: [
      "## Latest Delta Run",
      latestTracking
        ? asBulletList([
          `Tracking id: ${latestTracking.tracking_id}`,
          `Recorded at: ${latestTracking.recorded_at}`,
          `Source: ${latestTracking.source}`,
        ])
        : "- No readiness delta tracking entries recorded yet.",
      "",
      "## Milestone Deltas",
      latestTracking?.milestones?.length
        ? asBulletList(latestTracking.milestones.map((entry) => `${humanizeReadinessMilestone(entry.milestone)}: prev=${entry.previous_percentage ?? "n/a"}% current=${entry.current_percentage}% delta=${entry.delta}% trend=${entry.confidence_trend} | cleared=${entry.blockers_cleared.join(", ") || "none"} | introduced=${entry.blockers_introduced.join(", ") || "none"}`))
        : "- No milestone deltas recorded yet.",
      "",
      "## Architectural Notes",
      latestTracking?.milestones?.length
        ? asBulletList(latestTracking.milestones.flatMap((entry) => entry.architectural_readiness_notes.map((note) => `${humanizeReadinessMilestone(entry.milestone)}: ${note}`)))
        : "- No readiness architecture notes recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("AI-E Readiness Percentages"),
        toLink("Local Execution Sandbox"),
        toLink("Hybrid Local Cloud Strategy"),
      ]),
    ].join("\n"),
  };
}

function buildLocalModelLoaderRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Local Model Loader Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_local_model_loader_registry",
      tags: ["second-brain", "model-loader", "local-runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Registered Loaders",
      production.local_model_loader_registry.length > 0
        ? asBulletList(production.local_model_loader_registry.map((entry) => `${entry.loader_id}: ${entry.model_name} | runtime=${entry.runtime_target} | status=${entry.status} | offline=${entry.offline_viability ? "yes" : "no"}`))
        : "- No local model loader registry entries recorded yet.",
      "",
      "## Dependency Requirements",
      production.local_model_loader_registry.length > 0
        ? asBulletList(production.local_model_loader_registry.flatMap((entry) => entry.dependency_requirements.map((dependency) => `${entry.loader_id}: ${dependency}`)))
        : "- No loader dependency requirements recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Model Runtime Compatibility"),
        toLink("Runtime Activation Simulation"),
        toLink("Updated Readiness Progress"),
      ]),
    ].join("\n"),
  };
}

function buildRuntimeActivationSimulationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestActivationSimulation = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  return {
    title: "Runtime Activation Simulation",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_runtime_activation_simulation",
      tags: ["second-brain", "runtime-activation", "simulation", "cinematic", "obsidian-export"],
    },
    body: [
      "## Activation States",
      latestActivationSimulation?.activation_lifecycle_states?.length
        ? asBulletList(latestActivationSimulation.activation_lifecycle_states.map((entry) => `${entry.order}. ${entry.state}: ${entry.detail} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No runtime activation simulations recorded yet.",
      "",
      "## Guardrails",
      asBulletList([
        "Model loading remains simulated only.",
        "Runtime activation remains simulated only.",
        "Local execution remains disabled.",
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Local Model Loader Registry"),
        toLink("Model Runtime Compatibility"),
        toLink("Activation Failure Recovery"),
      ]),
    ].join("\n"),
  };
}

function buildModelRuntimeCompatibilityNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestActivationSimulation = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const compatibility = latestActivationSimulation?.compatibility_validation ?? null;
  return {
    title: "Model Runtime Compatibility",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_model_runtime_compatibility",
      tags: ["second-brain", "compatibility", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Compatibility Summary",
      compatibility
        ? asBulletList([
          `Valid: ${compatibility.valid ? "yes" : "no"}`,
          `Preferred loader: ${compatibility.preferred_loader_id ?? "none"}`,
          `Fallback runtime: ${compatibility.fallback_runtime_id ?? "none"}`,
        ])
        : "- No model/runtime compatibility validation recorded yet.",
      "",
      "## Compatibility Issues",
      compatibility?.issues?.length
        ? asBulletList(compatibility.issues.map((entry) => `${entry.loader_id}: ${entry.code} | ${entry.detail}`))
        : "- No compatibility issues recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Local Model Loader Registry"),
        toLink("Runtime Activation Simulation"),
        toLink("Activation Failure Recovery"),
      ]),
    ].join("\n"),
  };
}

function buildActivationFailureRecoveryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestActivationSimulation = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const recoveryPlan = latestActivationSimulation?.activation_recovery_plan ?? null;
  return {
    title: "Activation Failure Recovery",
    directory: "Recovery",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_activation_failure_recovery",
      tags: ["second-brain", "activation-recovery", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Recovery Causes",
      recoveryPlan?.causes?.length
        ? asBulletList(recoveryPlan.causes)
        : "- No activation failure causes recorded yet.",
      "",
      "## Recovery Steps",
      recoveryPlan?.next_safe_steps?.length
        ? asBulletList(recoveryPlan.next_safe_steps.map((entry) => `${entry.sequence_order}. ${entry.cause}: ${entry.detail}`))
        : "- No activation recovery steps recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Runtime Activation Simulation"),
        toLink("Model Runtime Compatibility"),
        toLink("Future Activation Plan"),
      ]),
    ].join("\n"),
  };
}

function buildFutureActivationPlanNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestActivationSimulation = [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "local-model-loader-runtime-activation-simulation")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
  const futurePlan = latestActivationSimulation?.future_activation_plan ?? null;
  return {
    title: "Future Activation Plan",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_activation_plan",
      tags: ["second-brain", "future-activation", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Scaffolded Activation Lanes",
      futurePlan
        ? asBulletList([
          `Future frame synthesis activation: ${futurePlan.future_frame_synthesis_activation ? "yes" : "no"}`,
          `Future temporal pipeline activation: ${futurePlan.future_temporal_pipeline_activation ? "yes" : "no"}`,
          `Future upscale activation: ${futurePlan.future_upscale_activation ? "yes" : "no"}`,
          `Future render packaging activation: ${futurePlan.future_render_packaging_activation ? "yes" : "no"}`,
          `Future local-only execution mode: ${futurePlan.future_local_only_execution_mode ? "yes" : "no"}`,
        ])
        : "- No future activation plan recorded yet.",
      "",
      "## Planning Notes",
      futurePlan?.notes?.length
        ? asBulletList(futurePlan.notes)
        : "- No future activation planning notes recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Runtime Activation Simulation"),
        toLink("Activation Failure Recovery"),
        toLink("Updated Readiness Progress"),
      ]),
    ].join("\n"),
  };
}

function buildUpdatedReadinessProgressNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
  milestoneProgress: Awaited<ReturnType<typeof getCinematicReadinessMilestoneProgress>>;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestTracking = production.readiness_delta_tracking_history[0] ?? null;
  return {
    title: "Updated Readiness Progress",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_updated_readiness_progress",
      tags: ["second-brain", "readiness-progress", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Current Progress",
      asBulletList(input.milestoneProgress.map((entry) => `${humanizeReadinessMilestone(entry.milestone)}: ${entry.percentage}% | confidence=${entry.confidence}`)),
      "",
      "## Latest Delta Source",
      latestTracking
        ? asBulletList([
          `Tracking id: ${latestTracking.tracking_id}`,
          `Source: ${latestTracking.source}`,
          `Recorded at: ${latestTracking.recorded_at}`,
        ])
        : "- No readiness delta tracking entries recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("AI-E Readiness Percentages"),
        toLink("Readiness Delta Tracking"),
        toLink("Runtime Activation Simulation"),
      ]),
    ].join("\n"),
  };
}

function latestControlledBootstrapSimulation(production: CinematicProductionMemoryRecord): CinematicProductionMemoryRecord["sandbox_simulations"][number] | null {
  return [...production.sandbox_simulations]
    .filter((entry) => entry.sandbox_kind === "controlled-local-inference-bootstrap" || entry.sandbox_kind === "gated-inference-activation-precursor" || entry.sandbox_kind === "dry-inference-warmup-single-frame-precursor" || entry.sandbox_kind === "gated-single-frame-dry-execution-path" || entry.sandbox_kind === "governed-single-frame-synthesis-preparation" || entry.sandbox_kind === "governed-low-resolution-frame-synthesis-sandbox")
    .sort((left, right) => right.recorded_at.localeCompare(left.recorded_at))[0] ?? null;
}

function buildDryRuntimeBootstrapNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const bootstrap = latestBootstrap?.dry_runtime_bootstrap ?? null;
  return {
    title: "Dry Runtime Bootstrap",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_dry_runtime_bootstrap",
      tags: ["second-brain", "dry-bootstrap", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Bootstrap Summary",
      bootstrap
        ? asBulletList([
          `Valid: ${bootstrap.valid ? "yes" : "no"}`,
          `Blockers: ${bootstrap.activation_blockers.join(", ") || "none"}`,
          `Missing dependencies: ${bootstrap.missing_dependencies.join(", ") || "none"}`,
        ])
        : "- No dry runtime bootstrap validations recorded yet.",
      "",
      "## Bootstrap Checks",
      bootstrap?.checks?.length
        ? asBulletList(bootstrap.checks.map((entry) => `${entry.check}: passed=${entry.passed ? "yes" : "no"} | detected=${entry.detected_paths.join(", ") || "none"}`))
        : "- No dry bootstrap checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Execution Boundary Status"),
        toLink("Runtime Integrity Validation"),
        toLink("Future Inference Activation"),
      ]),
    ].join("\n"),
  };
}

function buildExecutionBoundaryStatusNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const boundary = latestBootstrap?.execution_boundary_status ?? production.execution_boundary_status_history[0] ?? null;
  return {
    title: "Execution Boundary Status",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_boundary_status",
      tags: ["second-brain", "execution-boundary", "runtime", "cinematic", "obsidian-export"],
    },
    body: [
      "## Boundary Summary",
      boundary
        ? asBulletList([
          `Current status: ${boundary.current_status}`,
          `Tracked statuses: ${boundary.tracked_statuses.join(", ")}`,
          `Next activation milestone: ${boundary.next_activation_milestone}`,
        ])
        : "- No execution boundary status recorded yet.",
      "",
      "## Disabled Execution Reasons",
      boundary?.disabled_execution_reasons?.length
        ? asBulletList(boundary.disabled_execution_reasons)
        : "- No disabled execution reasons recorded yet.",
      "",
      "## Governance Restrictions",
      boundary?.governance_restrictions?.length
        ? asBulletList(boundary.governance_restrictions)
        : "- No governance restrictions recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Runtime Bootstrap"),
        toLink("Runtime Integrity Validation"),
        toLink("Activation Readiness Scoring"),
      ]),
    ].join("\n"),
  };
}

function buildRuntimeIntegrityValidationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const integrity = latestBootstrap?.runtime_integrity_validation ?? null;
  return {
    title: "Runtime Integrity Validation",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_runtime_integrity_validation",
      tags: ["second-brain", "runtime-integrity", "bootstrap", "cinematic", "obsidian-export"],
    },
    body: [
      "## Integrity Summary",
      integrity
        ? asBulletList([
          `Valid: ${integrity.valid ? "yes" : "no"}`,
          `Blockers: ${integrity.blockers.join(", ") || "none"}`,
          `Missing dependencies: ${integrity.missing_dependencies.join(", ") || "none"}`,
        ])
        : "- No runtime integrity validations recorded yet.",
      "",
      "## Integrity Issues",
      integrity?.issues?.length
        ? asBulletList(integrity.issues.map((entry) => `${entry.code}: ${entry.detail}`))
        : "- No runtime integrity issues recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Runtime Bootstrap"),
        toLink("Execution Boundary Status"),
        toLink("Controlled Runtime Profiles"),
      ]),
    ].join("\n"),
  };
}

function buildActivationReadinessScoringNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const readinessScoring = latestBootstrap?.activation_readiness_scoring ?? null;
  return {
    title: "Activation Readiness Scoring",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_activation_readiness_scoring",
      tags: ["second-brain", "readiness-scoring", "bootstrap", "cinematic", "obsidian-export"],
    },
    body: [
      "## Readiness Scores",
      readinessScoring?.scores?.length
        ? asBulletList(readinessScoring.scores.map((entry) => `${entry.dimension}: ${entry.score}% | confidence=${entry.confidence} | risk=${entry.risk_level} | trend=${entry.trend}`))
        : "- No activation readiness scores recorded yet.",
      "",
      "## Readiness Blockers",
      readinessScoring?.scores?.length
        ? asBulletList(readinessScoring.scores.flatMap((entry) => entry.blockers.map((blocker) => `${entry.dimension}: ${blocker}`)))
        : "- No readiness blockers recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Execution Boundary Status"),
        toLink("Updated Readiness Progress"),
        toLink("Controlled Runtime Profiles"),
      ]),
    ].join("\n"),
  };
}

function buildControlledRuntimeProfilesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const profiles = latestBootstrap?.controlled_runtime_profiles ?? production.controlled_runtime_profiles;
  return {
    title: "Controlled Runtime Profiles",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_controlled_runtime_profiles",
      tags: ["second-brain", "runtime-profiles", "bootstrap", "cinematic", "obsidian-export"],
    },
    body: [
      "## Profiles",
      profiles.length > 0
        ? asBulletList(profiles.map((entry) => {
          if ("viable" in entry) {
            return `${entry.display_name}: viable=${entry.viable ? "yes" : "no"} | mode=${entry.routing_mode}`;
          }
          return `${entry.display_name}: mode=${entry.routing_mode}`;
        }))
        : "- No controlled runtime profiles recorded yet.",
      "",
      "## Profile Notes",
      profiles.length > 0
        ? asBulletList(profiles.flatMap((entry) => ("reasons" in entry ? entry.reasons : entry.governance_notes).map((note) => `${entry.profile_id}: ${note}`)))
        : "- No controlled runtime profile notes recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Activation Readiness Scoring"),
        toLink("Runtime Integrity Validation"),
        toLink("Execution Boundary Status"),
      ]),
    ].join("\n"),
  };
}

function buildFutureInferenceActivationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const future = latestBootstrap?.future_inference_activation ?? null;
  return {
    title: "Future Inference Activation",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_inference_activation",
      tags: ["second-brain", "future-inference", "bootstrap", "cinematic", "obsidian-export"],
    },
    body: [
      "## Scaffolded Future Steps",
      future
        ? asBulletList([
          `Dry model initialization: ${future.dry_model_initialization ? "yes" : "no"}`,
          `Dry VRAM reservation: ${future.dry_vram_reservation ? "yes" : "no"}`,
          `Dry scheduler initialization: ${future.dry_scheduler_initialization ? "yes" : "no"}`,
          `Dry pipeline binding: ${future.dry_pipeline_binding ? "yes" : "no"}`,
          `Dry render packaging: ${future.dry_render_packaging ? "yes" : "no"}`,
        ])
        : "- No future inference activation scaffolds recorded yet.",
      "",
      "## Planning Notes",
      future?.notes?.length
        ? asBulletList(future.notes)
        : "- No future inference activation notes recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Runtime Bootstrap"),
        toLink("Execution Boundary Status"),
        toLink("Controlled Runtime Profiles"),
      ]),
    ].join("\n"),
  };
}

function buildActivationAuthorityRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const registry = latestBootstrap?.activation_authority_registry ?? production.activation_authority_registry;
  return {
    title: "Activation Authority Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_activation_authority_registry",
      tags: ["second-brain", "activation-authority", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Authority Entries",
      registry.length > 0
        ? asBulletList(registry.map((entry) => `${entry.authority_id}: ${entry.activation_scope} | allow=${entry.allowed_transition} | forbid=${entry.forbidden_transition}`))
        : "- No activation authority registry recorded yet.",
      "",
      "## Required Approvals",
      registry.length > 0
        ? asBulletList(registry.flatMap((entry) => entry.required_approval.map((approval) => `${entry.authority_id}: ${approval}`)))
        : "- No activation approvals recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Pre-Inference Gate Validation"),
        toLink("Inference Entry Sequencing"),
        toLink("Future Unlock Conditions"),
      ]),
    ].join("\n"),
  };
}

function buildPreInferenceGateValidationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const validation = latestBootstrap?.pre_inference_gate_validation ?? production.pre_inference_gate_validation_history[0] ?? null;
  return {
    title: "Pre-Inference Gate Validation",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_pre_inference_gate_validation",
      tags: ["second-brain", "pre-inference-gates", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Gate Summary",
      validation
        ? asBulletList([
          `Valid: ${validation.valid ? "yes" : "no"}`,
          `Next unlock condition: ${validation.next_unlock_condition}`,
          `Blocked transitions: ${validation.blocked_transitions.join(", ") || "none"}`,
        ])
        : "- No pre-inference gate validation recorded yet.",
      "",
      "## Gate Checks",
      validation?.checks?.length
        ? asBulletList(validation.checks.map((entry) => `${entry.gate}: passed=${entry.passed ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No pre-inference gate checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Activation Authority Registry"),
        toLink("Forbidden Execution States"),
        toLink("Future Unlock Conditions"),
      ]),
    ].join("\n"),
  };
}

function buildInferenceEntrySequencingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const sequencing = latestBootstrap?.inference_entry_sequencing ?? production.inference_entry_sequencing_history[0] ?? null;
  return {
    title: "Inference Entry Sequencing",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_inference_entry_sequencing",
      tags: ["second-brain", "inference-sequencing", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Sequencing Summary",
      sequencing
        ? asBulletList([
          `Next stage: ${sequencing.next_stage ?? "none"}`,
          `Recorded at: ${sequencing.recorded_at}`,
        ])
        : "- No inference entry sequencing recorded yet.",
      "",
      "## Sequenced Stages",
      sequencing?.stages?.length
        ? asBulletList(sequencing.stages.map((entry) => `${entry.order}. ${entry.stage}: status=${entry.status} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No inference-entry stages recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Activation Authority Registry"),
        toLink("Pre-Inference Gate Validation"),
        toLink("Governance Escalation Modeling"),
      ]),
    ].join("\n"),
  };
}

function buildForbiddenExecutionStatesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const enforcement = latestBootstrap?.forbidden_execution_states ?? production.forbidden_execution_state_history[0] ?? null;
  return {
    title: "Forbidden Execution States",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_forbidden_execution_states",
      tags: ["second-brain", "forbidden-states", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Forbidden States",
      enforcement?.states?.length
        ? asBulletList(enforcement.states.map((entry) => `${entry.state}: blocked=yes | reason=${entry.reason}`))
        : "- No forbidden execution states recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Pre-Inference Gate Validation"),
        toLink("Governance Escalation Modeling"),
        toLink("Future Unlock Conditions"),
      ]),
    ].join("\n"),
  };
}

function buildGovernanceEscalationModelingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const escalation = latestBootstrap?.governance_escalation_modeling ?? production.governance_escalation_modeling_history[0] ?? null;
  return {
    title: "Governance Escalation Modeling",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_governance_escalation_modeling",
      tags: ["second-brain", "governance-escalation", "runtime-risk", "cinematic", "obsidian-export"],
    },
    body: [
      "## Escalation Scenarios",
      escalation?.scenarios?.length
        ? asBulletList(escalation.scenarios.map((entry) => `${entry.escalation}: triggered=${entry.triggered ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No governance escalation modeling recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Inference Entry Sequencing"),
        toLink("Forbidden Execution States"),
        toLink("Future Unlock Conditions"),
      ]),
    ].join("\n"),
  };
}

function buildFutureUnlockConditionsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const unlockConditions = latestBootstrap?.future_unlock_conditions ?? production.future_unlock_conditions_history[0] ?? null;
  return {
    title: "Future Unlock Conditions",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_unlock_conditions",
      tags: ["second-brain", "future-unlocks", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Unlock Summary",
      unlockConditions
        ? asBulletList([
          `Milestone unlocking real inference: ${unlockConditions.milestone_unlocks_real_inference}`,
          `Condition count: ${unlockConditions.conditions.length}`,
        ])
        : "- No future unlock conditions recorded yet.",
      "",
      "## Unlock Conditions",
      unlockConditions?.conditions?.length
        ? asBulletList(unlockConditions.conditions.map((entry) => `${entry.unlock_id}: unlocked=no | prerequisites=${entry.prerequisites.join(", ")}`))
        : "- No unlock conditions recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Activation Authority Registry"),
        toLink("Pre-Inference Gate Validation"),
        toLink("Inference Entry Sequencing"),
      ]),
    ].join("\n"),
  };
}

function buildExecutionTemperatureStatesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const temperature = latestBootstrap?.execution_temperature_state ?? production.execution_temperature_state_history[0] ?? null;
  return {
    title: "Execution Temperature States",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_temperature_states",
      tags: ["second-brain", "execution-temperature", "warmup", "cinematic", "obsidian-export"],
    },
    body: [
      "## Temperature Summary",
      temperature
        ? asBulletList([
          `Current state: ${temperature.current_state}`,
          `Transition count: ${temperature.transitions.length}`,
        ])
        : "- No execution temperature states recorded yet.",
      "",
      "## Transitions",
      temperature?.transitions?.length
        ? asBulletList(temperature.transitions.map((entry) => `${entry.state}: authority=${entry.authority_trigger} | reason=${entry.transition_reason} | next=${entry.next_unlock_condition}`))
        : "- No execution temperature transitions recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Inference Warmup"),
        toLink("Frame-Stage Readiness"),
        toLink("Future Bounded Execution Rules"),
      ]),
    ].join("\n"),
  };
}

function buildDryInferenceWarmupNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const warmup = latestBootstrap?.dry_inference_warmup ?? production.dry_inference_warmup_history[0] ?? null;
  return {
    title: "Dry Inference Warmup",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_dry_inference_warmup",
      tags: ["second-brain", "dry-warmup", "inference", "cinematic", "obsidian-export"],
    },
    body: [
      "## Warmup Summary",
      warmup
        ? asBulletList([
          `Next unlock condition: ${warmup.next_unlock_condition}`,
          `VRAM assumptions: ${warmup.vram_assumptions.length}`,
        ])
        : "- No dry inference warmup recorded yet.",
      "",
      "## Warmup Stages",
      warmup?.stages?.length
        ? asBulletList(warmup.stages.map((entry) => `${entry.stage}: ready=${entry.ready ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No dry warmup stages recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Execution Temperature States"),
        toLink("Single-Frame Execution Precursor"),
        toLink("Frame-Stage Readiness"),
      ]),
    ].join("\n"),
  };
}

function buildSingleFrameExecutionPrecursorNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const precursor = latestBootstrap?.single_frame_execution_precursor ?? production.single_frame_execution_precursor_history[0] ?? null;
  return {
    title: "Single-Frame Execution Precursor",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_single_frame_execution_precursor",
      tags: ["second-brain", "single-frame", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Precursor Summary",
      precursor
        ? asBulletList([
          `Entry count: ${precursor.entries.length}`,
          `Recorded at: ${precursor.recorded_at}`,
        ])
        : "- No single-frame execution precursor recorded yet.",
      "",
      "## Scaffolded Entries",
      precursor?.entries?.length
        ? asBulletList(precursor.entries.map((entry) => `${entry.precursor_id}: scaffolded=yes | unlocked=no | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No single-frame precursor entries recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Inference Warmup"),
        toLink("Frame-Stage Readiness"),
        toLink("Future Bounded Execution Rules"),
      ]),
    ].join("\n"),
  };
}

function buildFrameStageReadinessNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const readiness = latestBootstrap?.frame_stage_readiness ?? production.frame_stage_readiness_history[0] ?? null;
  return {
    title: "Frame-Stage Readiness",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_frame_stage_readiness",
      tags: ["second-brain", "frame-stage", "readiness", "cinematic", "obsidian-export"],
    },
    body: [
      "## Readiness Summary",
      readiness
        ? asBulletList([
          `Valid: ${readiness.valid ? "yes" : "no"}`,
          `Next unlock condition: ${readiness.next_unlock_condition}`,
        ])
        : "- No frame-stage readiness recorded yet.",
      "",
      "## Readiness Checks",
      readiness?.checks?.length
        ? asBulletList(readiness.checks.map((entry) => `${entry.check}: passed=${entry.passed ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No frame-stage readiness checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Execution Temperature States"),
        toLink("Dry Inference Warmup"),
        toLink("Warmup Escalation Modeling"),
      ]),
    ].join("\n"),
  };
}

function buildWarmupEscalationModelingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const escalation = latestBootstrap?.warmup_escalation_modeling ?? production.warmup_escalation_modeling_history[0] ?? null;
  return {
    title: "Warmup Escalation Modeling",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_warmup_escalation_modeling",
      tags: ["second-brain", "warmup-escalation", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Escalation Scenarios",
      escalation?.scenarios?.length
        ? asBulletList(escalation.scenarios.map((entry) => `${entry.escalation}: triggered=${entry.triggered ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No warmup escalation modeling recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Inference Warmup"),
        toLink("Frame-Stage Readiness"),
        toLink("Future Bounded Execution Rules"),
      ]),
    ].join("\n"),
  };
}

function buildFutureBoundedExecutionRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const rules = latestBootstrap?.future_bounded_execution_rules ?? production.future_bounded_execution_rules_history[0] ?? null;
  return {
    title: "Future Bounded Execution Rules",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_bounded_execution_rules",
      tags: ["second-brain", "bounded-execution", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Rule Summary",
      rules
        ? asBulletList([
          `Rule count: ${rules.rules.length}`,
          `Recorded at: ${rules.recorded_at}`,
        ])
        : "- No future bounded execution rules recorded yet.",
      "",
      "## Rules",
      rules?.rules?.length
        ? asBulletList(rules.rules.map((entry) => `${entry.rule_id}: unlocked=no | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No bounded execution rules recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Execution Temperature States"),
        toLink("Single-Frame Execution Precursor"),
        toLink("Frame-Stage Readiness"),
      ]),
    ].join("\n"),
  };
}

function buildDryExecutionTokenRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const registry = latestBootstrap?.dry_execution_token_registry ?? production.dry_execution_token_registry_history[0] ?? [];
  return {
    title: "Dry Execution Token Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_dry_execution_token_registry",
      tags: ["second-brain", "dry-execution-token", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Token Summary",
      registry.length > 0
        ? asBulletList([
          `Token count: ${registry.length}`,
          `Authorities: ${[...new Set(registry.map((entry) => entry.activation_authority))].join(", ")}`,
        ])
        : "- No dry execution token registry recorded yet.",
      "",
      "## Tokens",
      registry.length > 0
        ? asBulletList(registry.map((entry) => `${entry.token_id}: scope=${entry.execution_scope} | allowed=${entry.allowed_stage} | forbidden=${entry.forbidden_stage} | expires=${entry.expiration_policy}`))
        : "- No dry execution tokens recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Single-Frame Dry Execution Path"),
        toLink("Frame Traversal Validation"),
        toLink("Execution Attempt Ledger"),
      ]),
    ].join("\n"),
  };
}

function buildSingleFrameDryExecutionPathNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const pathState = latestBootstrap?.single_frame_dry_execution_path ?? production.single_frame_dry_execution_path_history[0] ?? null;
  return {
    title: "Single-Frame Dry Execution Path",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_single_frame_dry_execution_path",
      tags: ["second-brain", "dry-execution-path", "single-frame", "cinematic", "obsidian-export"],
    },
    body: [
      "## Traversal Summary",
      pathState
        ? asBulletList([
          `Next stage: ${pathState.next_stage ?? "none"}`,
          `Stage count: ${pathState.stages.length}`,
        ])
        : "- No single-frame dry execution path recorded yet.",
      "",
      "## Traversal Stages",
      pathState?.stages?.length
        ? asBulletList(pathState.stages.map((entry) => `${entry.order}. ${entry.stage}: status=${entry.status} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No dry execution stages recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Execution Token Registry"),
        toLink("Frame Traversal Validation"),
        toLink("Dry Execution Recovery"),
      ]),
    ].join("\n"),
  };
}

function buildFrameTraversalValidationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const validation = latestBootstrap?.frame_traversal_validation ?? production.frame_traversal_validation_history[0] ?? null;
  return {
    title: "Frame Traversal Validation",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_frame_traversal_validation",
      tags: ["second-brain", "frame-traversal", "validation", "cinematic", "obsidian-export"],
    },
    body: [
      "## Validation Summary",
      validation
        ? asBulletList([
          `Valid: ${validation.valid ? "yes" : "no"}`,
          `Next unlock condition: ${validation.next_unlock_condition}`,
          `Blocked transitions: ${validation.blocked_transitions.join(", ") || "none"}`,
        ])
        : "- No frame traversal validation recorded yet.",
      "",
      "## Validation Checks",
      validation?.checks?.length
        ? asBulletList(validation.checks.map((entry) => `${entry.check}: passed=${entry.passed ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No frame traversal validation checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Execution Token Registry"),
        toLink("Single-Frame Dry Execution Path"),
        toLink("Dry Execution Recovery"),
      ]),
    ].join("\n"),
  };
}

function buildDryExecutionRecoveryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const recovery = latestBootstrap?.dry_execution_recovery ?? production.dry_execution_recovery_history[0] ?? null;
  return {
    title: "Dry Execution Recovery",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_dry_execution_recovery",
      tags: ["second-brain", "dry-execution-recovery", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Recovery Scenarios",
      recovery?.scenarios?.length
        ? asBulletList(recovery.scenarios.map((entry) => `${entry.recovery}: triggered=${entry.triggered ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No dry execution recovery recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Frame Traversal Validation"),
        toLink("Execution Attempt Ledger"),
        toLink("Future Frame Synthesis Unlocks"),
      ]),
    ].join("\n"),
  };
}

function buildFutureFrameSynthesisUnlocksNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const unlocks = latestBootstrap?.future_frame_synthesis_unlocks ?? production.future_frame_synthesis_unlocks_history[0] ?? null;
  return {
    title: "Future Frame Synthesis Unlocks",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_frame_synthesis_unlocks",
      tags: ["second-brain", "future-frame-synthesis", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Unlock Summary",
      unlocks
        ? asBulletList([
          `Milestone unlocking real synthesis: ${unlocks.milestone_unlocks_real_synthesis}`,
          `Unlock count: ${unlocks.unlocks.length}`,
        ])
        : "- No future frame synthesis unlocks recorded yet.",
      "",
      "## Unlocks",
      unlocks?.unlocks?.length
        ? asBulletList(unlocks.unlocks.map((entry) => `${entry.unlock_id}: unlocked=no | prerequisites=${entry.prerequisites.join(", ")}`))
        : "- No future frame synthesis unlocks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Execution Recovery"),
        toLink("Future Bounded Execution Rules"),
        toLink("Execution Attempt Ledger"),
      ]),
    ].join("\n"),
  };
}

function buildExecutionAttemptLedgerNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const ledger = latestBootstrap?.execution_attempt_ledger ?? production.execution_attempt_ledger_history[0] ?? null;
  return {
    title: "Execution Attempt Ledger",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_attempt_ledger",
      tags: ["second-brain", "execution-attempts", "ledger", "cinematic", "obsidian-export"],
    },
    body: [
      "## Attempt Summary",
      ledger
        ? asBulletList([
          `Attempt count: ${ledger.attempts.length}`,
          `Recorded at: ${ledger.recorded_at}`,
        ])
        : "- No execution attempt ledger recorded yet.",
      "",
      "## Attempts",
      ledger?.attempts?.length
        ? asBulletList(ledger.attempts.map((entry) => `${entry.token_id}: blocked=${entry.blocked_transitions.join(", ") || "none"} | escalations=${entry.escalation_triggers.join(", ") || "none"}`))
        : "- No execution attempts recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Dry Execution Token Registry"),
        toLink("Single-Frame Dry Execution Path"),
        toLink("Future Frame Synthesis Unlocks"),
      ]),
    ].join("\n"),
  };
}

function buildSynthesisContainmentRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const registry = latestBootstrap?.synthesis_containment_registry ?? production.synthesis_containment_registry_history[0] ?? [];
  return {
    title: "Synthesis Containment Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_synthesis_containment_registry",
      tags: ["second-brain", "synthesis-containment", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Containment Summary",
      registry.length > 0
        ? asBulletList([
          `Containment count: ${registry.length}`,
          `Rollback authorities: ${[...new Set(registry.map((entry) => entry.rollback_authority))].join(", ")}`,
          `Escalation authorities: ${[...new Set(registry.map((entry) => entry.escalation_authority))].join(", ")}`,
        ])
        : "- No synthesis containment registry recorded yet.",
      "",
      "## Containment Entries",
      registry.length > 0
        ? asBulletList(registry.map((entry) => `${entry.containment_id}: scope=${entry.synthesis_scope} | resolution=${entry.maximum_resolution} | frames=${entry.maximum_frame_count} | expires=${entry.containment_expiration}`))
        : "- No synthesis containment entries recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Governed Synthesis Preparation"),
        toLink("Synthesis Validation Layer"),
        toLink("Governed Rollback Ledger"),
      ]),
    ].join("\n"),
  };
}

function buildGovernedSynthesisPreparationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const preparation = latestBootstrap?.governed_synthesis_preparation ?? production.governed_synthesis_preparation_history[0] ?? null;
  return {
    title: "Governed Synthesis Preparation",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_governed_synthesis_preparation",
      tags: ["second-brain", "synthesis-preparation", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Preparation Summary",
      preparation
        ? asBulletList([
          `Containment id: ${preparation.containment_id ?? "none"}`,
          `Next stage: ${preparation.next_stage ?? "none"}`,
          `Stage count: ${preparation.stages.length}`,
        ])
        : "- No governed synthesis preparation recorded yet.",
      "",
      "## Preparation Stages",
      preparation?.stages?.length
        ? asBulletList(preparation.stages.map((entry) => `${entry.order}. ${entry.stage}: status=${entry.status} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No governed synthesis preparation stages recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Synthesis Containment Registry"),
        toLink("Synthesis Validation Layer"),
        toLink("Future Low Resolution Output"),
      ]),
    ].join("\n"),
  };
}

function buildSynthesisValidationLayerNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const validation = latestBootstrap?.synthesis_validation_layer ?? production.synthesis_validation_layer_history[0] ?? null;
  return {
    title: "Synthesis Validation Layer",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_synthesis_validation_layer",
      tags: ["second-brain", "synthesis-validation", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Validation Summary",
      validation
        ? asBulletList([
          `Valid: ${validation.valid ? "yes" : "no"}`,
          `Next unlock condition: ${validation.next_unlock_condition}`,
          `Blocked transitions: ${validation.blocked_transitions.join(", ") || "none"}`,
        ])
        : "- No synthesis validation layer recorded yet.",
      "",
      "## Validation Checks",
      validation?.checks?.length
        ? asBulletList(validation.checks.map((entry) => `${entry.check}: passed=${entry.passed ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No synthesis validation checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Synthesis Containment Registry"),
        toLink("Governed Synthesis Preparation"),
        toLink("Contained Escalation Modeling"),
      ]),
    ].join("\n"),
  };
}

function buildContainedEscalationModelingNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const escalation = latestBootstrap?.contained_escalation_modeling ?? production.contained_escalation_modeling_history[0] ?? null;
  return {
    title: "Contained Escalation Modeling",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_contained_escalation_modeling",
      tags: ["second-brain", "contained-escalation", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Escalation Scenarios",
      escalation?.scenarios?.length
        ? asBulletList(escalation.scenarios.map((entry) => `${entry.escalation}: triggered=${entry.triggered ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No contained escalation modeling recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Synthesis Validation Layer"),
        toLink("Future Low Resolution Output"),
        toLink("Governed Rollback Ledger"),
      ]),
    ].join("\n"),
  };
}

function buildFutureLowResolutionOutputNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const output = latestBootstrap?.future_low_resolution_output ?? production.future_low_resolution_output_history[0] ?? null;
  return {
    title: "Future Low Resolution Output",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_low_resolution_output",
      tags: ["second-brain", "low-resolution-output", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Output Summary",
      output
        ? asBulletList([
          `Milestone unlocking governed output: ${output.milestone_unlocks_governed_output}`,
          `Output count: ${output.outputs.length}`,
        ])
        : "- No future low resolution output recorded yet.",
      "",
      "## Output Scaffolds",
      output?.outputs?.length
        ? asBulletList(output.outputs.map((entry) => `${entry.output_id}: unlocked=no | target=${entry.target_resolution} | prerequisites=${entry.prerequisites.join(", ")}`))
        : "- No future low resolution output scaffolds recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Governed Synthesis Preparation"),
        toLink("Contained Escalation Modeling"),
        toLink("Governed Rollback Ledger"),
      ]),
    ].join("\n"),
  };
}

function buildGovernedRollbackLedgerNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const ledger = latestBootstrap?.governed_rollback_ledger ?? production.governed_rollback_ledger_history[0] ?? null;
  return {
    title: "Governed Rollback Ledger",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_governed_rollback_ledger",
      tags: ["second-brain", "governed-rollback", "ledger", "cinematic", "obsidian-export"],
    },
    body: [
      "## Rollback Summary",
      ledger
        ? asBulletList([
          `Entry count: ${ledger.entries.length}`,
          `Recorded at: ${ledger.recorded_at}`,
        ])
        : "- No governed rollback ledger recorded yet.",
      "",
      "## Rollback Entries",
      ledger?.entries?.length
        ? asBulletList(ledger.entries.map((entry) => `${entry.containment_id}: violations=${entry.containment_violations.join(", ") || "none"} | blocked_output=${entry.blocked_output_attempts.join(", ") || "none"}`))
        : "- No governed rollback entries recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Synthesis Containment Registry"),
        toLink("Contained Escalation Modeling"),
        toLink("Future Low Resolution Output"),
      ]),
    ].join("\n"),
  };
}

function buildRealOutputAuthorizationRegistryNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const registry = latestBootstrap?.real_output_authorization_registry ?? production.real_output_authorization_registry_history[0] ?? [];
  return {
    title: "Real Output Authorization Registry",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_real_output_authorization_registry",
      tags: ["second-brain", "real-output-authorization", "governance", "cinematic", "obsidian-export"],
    },
    body: [
      "## Authorization Summary",
      registry.length > 0
        ? asBulletList([
          `Authorization count: ${registry.length}`,
          `Output targets: ${[...new Set(registry.flatMap((entry) => entry.allowed_output_targets))].join(", ")}`,
          `Rollback authorities: ${[...new Set(registry.map((entry) => entry.rollback_authority))].join(", ")}`,
        ])
        : "- No real output authorization registry recorded yet.",
      "",
      "## Authorizations",
      registry.length > 0
        ? asBulletList(registry.map((entry) => `${entry.authorization_id}: scope=${entry.authorized_output_scope} | resolution=${entry.maximum_resolution} | frames=${entry.maximum_frame_count} | retention=${entry.output_retention_policy}`))
        : "- No real output authorizations recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Governed Low Resolution Sandbox"),
        toLink("Output Containment Validation"),
        toLink("Real Output Rollback"),
      ]),
    ].join("\n"),
  };
}

function buildGovernedLowResolutionSandboxNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const sandbox = latestBootstrap?.governed_low_resolution_sandbox ?? production.governed_low_resolution_sandbox_history[0] ?? null;
  return {
    title: "Governed Low Resolution Sandbox",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_governed_low_resolution_sandbox",
      tags: ["second-brain", "low-resolution-sandbox", "real-output", "cinematic", "obsidian-export"],
    },
    body: [
      "## Sandbox Summary",
      sandbox
        ? asBulletList([
          `Authorization id: ${sandbox.authorization_id ?? "none"}`,
          `Output written: ${sandbox.real_output_written ? "yes" : "no"}`,
          `Output path: ${sandbox.output_file_path ?? "none"}`,
        ])
        : "- No governed low resolution sandbox recorded yet.",
      "",
      "## Sandbox Controls",
      sandbox
        ? asBulletList([
          `Retry limit: ${sandbox.bounded_retry_limit}`,
          `Rollback enabled: ${sandbox.rollback_enabled ? "yes" : "no"}`,
          `Retention: ${sandbox.output_retention_policy}`,
        ])
        : "- No governed low resolution sandbox controls recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Real Output Authorization Registry"),
        toLink("First Real Synthesis Path"),
        toLink("Real Output Rollback"),
      ]),
    ].join("\n"),
  };
}

function buildFirstRealSynthesisPathNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const pathState = latestBootstrap?.first_real_synthesis_path ?? production.first_real_synthesis_path_history[0] ?? null;
  return {
    title: "First Real Synthesis Path",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_first_real_synthesis_path",
      tags: ["second-brain", "first-real-synthesis", "real-output", "cinematic", "obsidian-export"],
    },
    body: [
      "## Path Summary",
      pathState
        ? asBulletList([
          `Authorization id: ${pathState.authorization_id ?? "none"}`,
          `Next stage: ${pathState.next_stage ?? "none"}`,
          `Output path: ${pathState.output_file_path ?? "none"}`,
        ])
        : "- No first real synthesis path recorded yet.",
      "",
      "## Synthesis Stages",
      pathState?.stages?.length
        ? asBulletList(pathState.stages.map((entry) => `${entry.order}. ${entry.stage}: status=${entry.status} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No first real synthesis stages recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Governed Low Resolution Sandbox"),
        toLink("Output Containment Validation"),
        toLink("Future Renderer Escalation"),
      ]),
    ].join("\n"),
  };
}

function buildOutputContainmentValidationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const validation = latestBootstrap?.output_containment_validation ?? production.output_containment_validation_history[0] ?? null;
  return {
    title: "Output Containment Validation",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_output_containment_validation",
      tags: ["second-brain", "output-containment", "real-output", "cinematic", "obsidian-export"],
    },
    body: [
      "## Validation Summary",
      validation
        ? asBulletList([
          `Valid: ${validation.valid ? "yes" : "no"}`,
          `Next unlock condition: ${validation.next_unlock_condition}`,
          `Blocked transitions: ${validation.blocked_transitions.join(", ") || "none"}`,
        ])
        : "- No output containment validation recorded yet.",
      "",
      "## Validation Checks",
      validation?.checks?.length
        ? asBulletList(validation.checks.map((entry) => `${entry.check}: passed=${entry.passed ? "yes" : "no"} | blockers=${entry.blockers.join(", ") || "none"}`))
        : "- No output containment checks recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Real Output Authorization Registry"),
        toLink("Governed Low Resolution Sandbox"),
        toLink("Real Output Rollback"),
      ]),
    ].join("\n"),
  };
}

function buildRealOutputRollbackNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const rollback = latestBootstrap?.real_output_rollback ?? production.real_output_rollback_history[0] ?? null;
  return {
    title: "Real Output Rollback",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_real_output_rollback",
      tags: ["second-brain", "real-output-rollback", "real-output", "cinematic", "obsidian-export"],
    },
    body: [
      "## Rollback Actions",
      rollback?.actions?.length
        ? asBulletList(rollback.actions.map((entry) => `${entry.action}: triggered=${entry.triggered ? "yes" : "no"} | targets=${entry.affected_output_targets.join(", ") || "none"}`))
        : "- No real output rollback recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("Governed Low Resolution Sandbox"),
        toLink("Output Containment Validation"),
        toLink("Future Renderer Escalation"),
      ]),
    ].join("\n"),
  };
}

function buildFutureRendererEscalationNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const latestBootstrap = latestControlledBootstrapSimulation(production);
  const future = latestBootstrap?.future_renderer_escalation ?? production.future_renderer_escalation_history[0] ?? null;
  return {
    title: "Future Renderer Escalation",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_future_renderer_escalation",
      tags: ["second-brain", "renderer-escalation", "real-output", "cinematic", "obsidian-export"],
    },
    body: [
      "## Escalation Summary",
      future
        ? asBulletList([
          `Milestone unlocking renderer escalation: ${future.milestone_unlocks_renderer_escalation}`,
          `Entry count: ${future.entries.length}`,
        ])
        : "- No future renderer escalation recorded yet.",
      "",
      "## Escalation Scaffolds",
      future?.entries?.length
        ? asBulletList(future.entries.map((entry) => `${entry.escalation_id}: unlocked=no | prerequisites=${entry.prerequisites.join(", ")}`))
        : "- No future renderer escalation scaffolds recorded yet.",
      "",
      "## Related",
      asBulletList([
        toLink("First Real Synthesis Path"),
        toLink("Real Output Rollback"),
        toLink("Governed Low Resolution Sandbox"),
      ]),
    ].join("\n"),
  };
}

function buildCinematicExecutionLifecycleNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const recentHistory = production.generation_job_history.slice(-12);
  return {
    title: "Cinematic Execution Lifecycle",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_execution_lifecycle",
      tags: ["second-brain", "execution-lifecycle", "cinematic", "obsidian-export"],
    },
    body: [
      "## Lifecycle Rules",
      asBulletList(production.execution_lifecycle_rules),
      "",
      "## Lifecycle Summary",
      asBulletList([
        `Tracked jobs: ${production.generation_jobs.length}`,
        `Lifecycle events: ${production.generation_job_history.length}`,
        `Sandbox simulations: ${production.sandbox_simulations.length}`,
      ]),
      "",
      "## Recent Transitions",
      asBulletList(recentHistory.length > 0
        ? recentHistory.map((entry) => `${entry.job_id}: ${entry.generation_status} | ${entry.detail}`)
        : ["No lifecycle transitions recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Job Queue"),
        toLink("Retry Planning Rules"),
        toLink("Sandbox Simulation Results"),
      ]),
    ].join("\n"),
  };
}

function buildRetryPlanningRulesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const retryJobs = production.generation_jobs.filter((entry) => entry.retry_count > 0);
  return {
    title: "Retry Planning Rules",
    directory: "Architecture",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_retry_planning_rules",
      tags: ["second-brain", "retry-planning", "cinematic", "obsidian-export"],
    },
    body: [
      "## Retry Rules",
      asBulletList(production.retry_planning_rules),
      "",
      "## Retry Jobs",
      asBulletList(retryJobs.length > 0
        ? retryJobs.map((entry) => `${entry.job_id}: retry=${entry.retry_count} | preserved outputs=${entry.continuity_context.preserved_output_refs.length}`)
        : ["No retry jobs recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Cinematic Execution Lifecycle"),
        toLink("Failed Generations"),
        toLink("Sandbox Simulation Results"),
      ]),
    ].join("\n"),
  };
}

function buildCostAwareGenerationStrategyNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const providerCosts = [...new Set(production.generation_jobs.map((entry) => entry.provider))].map((provider) => {
    const providerJobs = production.generation_jobs.filter((entry) => entry.provider === provider);
    const totalCost = providerJobs.reduce((sum, entry) => sum + entry.estimated_cost, 0);
    return `${provider}: planned cost=${totalCost}`;
  });
  return {
    title: "Cost-Aware Generation Strategy",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_cost_aware_generation_strategy",
      tags: ["second-brain", "cost-strategy", "cinematic", "obsidian-export"],
    },
    body: [
      "## Strategy Rules",
      asBulletList(production.cost_aware_generation_strategy),
      "",
      "## Provider Cost Signals",
      asBulletList(providerCosts.length > 0 ? providerCosts : ["No provider costs recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Routing Rules"),
        toLink("Cost Forecast Examples"),
        toLink("Generation Job Queue"),
        toLink("Cost-Aware Iteration Notes"),
      ]),
    ].join("\n"),
  };
}

function buildCostForecastExamplesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const providerExamples = production.provider_capability_registry.map((entry) => `${entry.provider}: draft=${entry.estimated_cost_profile.draft} | standard=${entry.estimated_cost_profile.standard} | premium=${entry.estimated_cost_profile.premium}`);
  return {
    title: "Cost Forecast Examples",
    directory: "Resources",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_cost_forecast_examples",
      tags: ["second-brain", "cost-forecast", "cinematic", "obsidian-export"],
    },
    body: [
      "## Forecast Examples",
      asBulletList(production.cost_forecast_examples),
      "",
      "## Provider Cost Profiles",
      asBulletList(providerExamples),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Budget Rules"),
        toLink("Cost-Aware Generation Strategy"),
        toLink("Provider Capability Registry"),
      ]),
    ].join("\n"),
  };
}

function buildProviderPayloadExamplesNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  const preparedPayloads = production.generation_jobs
    .filter((entry) => entry.prompt_payload.normalized_prompt.length > 0)
    .slice(0, 6)
    .map((entry) => `${entry.provider}: ${entry.shot_id} | duration=${entry.prompt_payload.duration_target_seconds}s | resolution=${entry.prompt_payload.resolution} | prompt=${entry.prompt_payload.normalized_prompt.slice(0, 96)}...`);
  return {
    title: "Provider Payload Examples",
    directory: "Strategy",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_provider_payload_examples",
      tags: ["second-brain", "provider-payloads", "cinematic", "obsidian-export"],
    },
    body: [
      "## Payload Examples",
      asBulletList(preparedPayloads.length > 0 ? preparedPayloads : production.provider_payload_examples),
      "",
      "## Related",
      asBulletList([
        toLink("Provider Capability Registry"),
        toLink("Prompt Normalization Rules"),
        toLink("Generation Budget Rules"),
      ]),
    ].join("\n"),
  };
}

function buildSandboxSimulationResultsNote(input: {
  productionMemory: CinematicProductionMemoryRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const production = input.productionMemory;
  return {
    title: "Sandbox Simulation Results",
    directory: "Outcomes",
    metadata: {
      project_key: production.project_key,
      updated_at: production.updated_at,
      session_id: input.latestSessionId,
      status: "generated_sandbox_simulation_results",
      tags: ["second-brain", "sandbox-simulation", "cinematic", "obsidian-export"],
    },
    body: [
      "## Simulations",
      asBulletList(production.sandbox_simulations.length > 0
        ? production.sandbox_simulations.map((entry) => `${entry.simulation_id}: provider=${entry.provider} | approved=${entry.approved_job_ids.length} | failed=${entry.failed_job_ids.length} | retries=${entry.retry_job_ids.length}`)
        : ["No sandbox simulations recorded yet."]),
      "",
      "## Asset Reuse During Simulation",
      asBulletList(production.sandbox_simulations.flatMap((entry) => entry.asset_reuse_decisions).length > 0
        ? production.sandbox_simulations.flatMap((entry) => entry.asset_reuse_decisions)
        : ["No sandbox asset reuse decisions recorded yet."]),
      "",
      "## Related",
      asBulletList([
        toLink("Generation Job Queue"),
        toLink("Cinematic Execution Lifecycle"),
        toLink("Retry Planning Rules"),
      ]),
    ].join("\n"),
  };
}

function buildHomeNote(input: {
  record: SecondBrainRecord;
  authoritativeProjectContext: CurrentProjectContext;
  repoProjectContext: CurrentProjectContext;
  relationships: ObsidianRelationship[];
  latestSessionId: string;
}): ObsidianExportNote {
  return {
    title: "Home",
    directory: "",
    metadata: {
      project_key: input.repoProjectContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_home_index",
      tags: ["second-brain", "index", "obsidian-export"],
    },
    body: [
      "## Key Notes",
      asBulletList([
        toLink("Current Focus"),
        toLink("Active Projects"),
        toLink("Current Project State"),
        toLink("Outcome History"),
        toLink("Recovery Procedures"),
        toLink("Architecture Rules"),
      ]),
      "",
      "## Current Routing",
      asBulletList([
        `Authoritative current project: ${toLink(input.authoritativeProjectContext.project.title)}`,
        `Repo-scoped current project: ${toLink(input.repoProjectContext.project.title)}`,
      ]),
      "",
      "## Graph Relationships",
      asBulletList(input.relationships.map((relationship) => `${toLink(relationship.from)} -> ${toLink(relationship.to)} (${relationship.type})`)),
    ].join("\n"),
  };
}

function buildCurrentFocusNote(input: {
  record: SecondBrainRecord;
  repoProjectContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  return {
    title: "Current Focus",
    directory: "",
    metadata: {
      project_key: input.repoProjectContext.project.project_key,
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_focus_index",
      tags: ["second-brain", "focus", "obsidian-export"],
    },
    body: [
      "## Current Objective",
      asBulletList([
        input.record.sections.working_memory.current_objective,
        `Resolved repo project: ${toLink(input.repoProjectContext.project.title)}`,
        `Next safe task: ${toLink("Next Safe Task")}`,
      ]),
      "",
      "## Active Files",
      asBulletList(input.record.sections.working_memory.active_files),
      "",
      "## Related",
      asBulletList([
        toLink("Current Project State"),
        toLink("AI-E"),
        toLink("Session Continuity Summary"),
      ]),
    ].join("\n"),
  };
}

function buildActiveProjectsNote(input: {
  record: SecondBrainRecord;
  babylonContext: CurrentProjectContext;
  aiContext: CurrentProjectContext;
  latestSessionId: string;
}): ObsidianExportNote {
  return {
    title: "Active Projects",
    directory: "",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_project_index",
      tags: ["second-brain", "projects", "obsidian-export"],
    },
    body: [
      "## Projects",
      asBulletList([
        `${toLink("BABYLON 2026")} - ${input.babylonContext.project.status}`,
        `${toLink("AI-E")} - ${input.aiContext.project.status}`,
      ]),
      "",
      "## Related",
      asBulletList([
        toLink("Current Project State"),
        toLink("Next Safe Task"),
        toLink("Outcome History"),
      ]),
    ].join("\n"),
  };
}

function buildOperationalLessonsNote(input: {
  record: SecondBrainRecord;
  latestSessionId: string;
}): ObsidianExportNote {
  const outcomeMemory = input.record.sections.outcome_memory;
  return {
    title: "Operational Lessons",
    directory: "",
    metadata: {
      project_key: "multi-project",
      updated_at: input.record.updated_at,
      session_id: input.latestSessionId,
      status: "generated_lessons_index",
      tags: ["second-brain", "lessons", "obsidian-export"],
    },
    body: [
      "## What Passed",
      asBulletList(outcomeMemory.what_passed),
      "",
      "## What Failed",
      asBulletList(outcomeMemory.what_failed),
      "",
      "## Never Repeat",
      asBulletList(outcomeMemory.should_never_be_repeated),
      "",
      "## Related",
      asBulletList([
        toLink("Outcome History"),
        toLink("Old BABYLON Anti-Patterns"),
        toLink("Recovery Procedures"),
      ]),
    ].join("\n"),
  };
}

async function writeObsidianNote(vaultRoot: string, note: ObsidianExportNote): Promise<string> {
  const directory = note.directory ? path.join(vaultRoot, note.directory) : vaultRoot;
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${sanitizeFileName(note.title)}.md`);
  await writeFile(filePath, createNoteContent(note), "utf8");
  return filePath;
}

export async function exportSecondBrainToObsidian(input?: {
  root?: string;
  vaultRoot?: string;
}): Promise<ExportSecondBrainToObsidianResult> {
  const initialization = await ensureSecondBrainInitialized(input?.root);
  const record = await readSecondBrainMemory({ root: initialization.repoRoot }) as SecondBrainRecord;
  const productionMemory = await readCinematicProductionMemory({ root: initialization.repoRoot });
  const authoritativeProjectContext = await retrieveCurrentProjectContext({
    root: initialization.repoRoot,
    projectKey: record.current_project_key,
  });
  const repoProjectKey = await resolveSecondBrainProjectKey({ root: initialization.repoRoot });
  const repoProjectContext = await retrieveCurrentProjectContext({
    root: initialization.repoRoot,
    projectKey: repoProjectKey,
  });
  const babylonContext = await retrieveCurrentProjectContext({ root: initialization.repoRoot, projectKey: "babylon-2026" });
  const aiContext = await retrieveCurrentProjectContext({ root: initialization.repoRoot, projectKey: "ai-e" });
  const latestSessionId = buildSessionId(record.sections.outcome_memory.latest_outcomes);
  const vaultRoot = input?.vaultRoot ? path.resolve(input.vaultRoot) : path.join(initialization.repoRoot, OBSIDIAN_VAULT_DIRNAME);
  const relationships = buildRelationships(repoProjectContext.project.project_key);
  const readinessMilestoneProgress = await getCinematicReadinessMilestoneProgress({ root: initialization.repoRoot });

  const notes: ObsidianExportNote[] = [
    buildProjectNote({
      projectContext: babylonContext,
      latestSessionId,
      updatedAt: record.updated_at,
      extraLinks: [
        toLink("Architecture Rules"),
        toLink("Old BABYLON Anti-Patterns"),
        toLink("Outcome History"),
        toLink("Recovery Procedures"),
        toLink("Next Safe Task"),
      ],
    }),
    buildProjectNote({
      projectContext: aiContext,
      latestSessionId,
      updatedAt: record.updated_at,
      extraLinks: [
        toLink("Current Project State"),
        toLink("Outcome History"),
        toLink("Recovery Procedures"),
        toLink("Next Safe Task"),
        toLink("Resource Fallback State"),
      ],
    }),
    buildCurrentProjectStateNote({
      record,
      repoProjectContext,
      authoritativeProjectContext,
      latestSessionId,
    }),
    buildNextSafeTaskNote({
      record,
      babylonContext,
      aiContext,
      latestSessionId,
    }),
    buildArchitectureRulesNote({ record, latestSessionId }),
    buildAntiPatternsNote({ record, babylonContext, latestSessionId }),
    buildOutcomeHistoryNote({ record, latestSessionId }),
    buildRecoveryProceduresNote({ record, latestSessionId }),
    buildResourceFallbackStateNote({ record, latestSessionId }),
    buildStrategicRoadmapNote({ record, latestSessionId }),
    buildCinematicProductionMemoryNote({ record, productionMemory, latestSessionId }),
    buildBabylonCutsceneLayerNote({ productionMemory, latestSessionId }),
    buildShotPlanningRulesNote({ productionMemory, latestSessionId }),
    buildCinematicContinuityRulesNote({ productionMemory, latestSessionId }),
    buildSceneSequencesNote({ productionMemory, latestSessionId }),
    buildGameplayCutsceneTriggersNote({ productionMemory, latestSessionId }),
    buildContinuityValidationRulesNote({ productionMemory, latestSessionId }),
    buildShotProgressionExamplesNote({ productionMemory, latestSessionId }),
    buildAssetReuseLogNote({ productionMemory, latestSessionId }),
    buildAssetReuseDecisionsNote({ productionMemory, latestSessionId }),
    buildFailedGenerationsNote({ productionMemory, latestSessionId }),
    buildSuccessfulGenerationsNote({ productionMemory, latestSessionId }),
    buildCostAwareIterationNotes({ productionMemory, latestSessionId }),
    buildGenerationJobQueueNote({ productionMemory, latestSessionId }),
    buildOperatorApprovalQueueNote({ productionMemory, latestSessionId }),
    buildRealProviderDryRunNote({ productionMemory, latestSessionId }),
    buildSubmissionPackageExamplesNote({ productionMemory, latestSessionId }),
    buildProviderRoutingRulesNote({ productionMemory, latestSessionId }),
    buildProviderCapabilityRegistryNote({ productionMemory, latestSessionId }),
    buildProviderConstraintMatrixNote({ productionMemory, latestSessionId }),
    buildPromptNormalizationRulesNote({ productionMemory, latestSessionId }),
    buildGenerationBudgetRulesNote({ productionMemory, latestSessionId }),
    buildBudgetGovernanceDecisionsNote({ productionMemory, latestSessionId }),
    buildApprovalEscalationRulesNote({ productionMemory, latestSessionId }),
    buildManualApprovalWorkflowNote({ productionMemory, latestSessionId }),
    buildExecutionReadinessChecklistNote({ productionMemory, latestSessionId }),
    buildExecutionManifestExamplesNote({ productionMemory, latestSessionId }),
    buildLocalModelRegistryNote({ productionMemory, latestSessionId }),
    buildLocalRuntimeReadinessNote({ productionMemory, latestSessionId }),
    buildHardwareCapabilityPlanningNote({ productionMemory, latestSessionId }),
    buildLocalVsCloudRoutingNote({ productionMemory, latestSessionId }),
    buildFutureLocalInferenceNotes({ productionMemory, latestSessionId }),
    buildLocalAssetCacheStrategyNote({ productionMemory, latestSessionId }),
    buildReadinessPercentagesNote({ productionMemory, latestSessionId, milestoneProgress: readinessMilestoneProgress }),
    buildLocalRuntimeProbeResultsNote({ productionMemory, latestSessionId }),
    buildFrameGenerationPipelinePlanningNote({ productionMemory, latestSessionId }),
    buildRendererCapabilityRoadmapNote({ productionMemory, latestSessionId }),
    buildRuntimeConstraintModelingNote({ productionMemory, latestSessionId }),
    buildHybridLocalCloudStrategyNote({ productionMemory, latestSessionId }),
    buildLocalExecutionSandboxNote({ productionMemory, latestSessionId }),
    buildRendererLifecycleSimulationNote({ productionMemory, latestSessionId }),
    buildGpuAllocationModelingNote({ productionMemory, latestSessionId }),
    buildQueueOrchestrationPlanningNote({ productionMemory, latestSessionId }),
    buildRendererRecoveryPlanningNote({ productionMemory, latestSessionId }),
    buildReadinessDeltaTrackingNote({ productionMemory, latestSessionId }),
    buildLocalModelLoaderRegistryNote({ productionMemory, latestSessionId }),
    buildRuntimeActivationSimulationNote({ productionMemory, latestSessionId }),
    buildModelRuntimeCompatibilityNote({ productionMemory, latestSessionId }),
    buildActivationFailureRecoveryNote({ productionMemory, latestSessionId }),
    buildFutureActivationPlanNote({ productionMemory, latestSessionId }),
    buildUpdatedReadinessProgressNote({ productionMemory, latestSessionId, milestoneProgress: readinessMilestoneProgress }),
    buildDryRuntimeBootstrapNote({ productionMemory, latestSessionId }),
    buildExecutionBoundaryStatusNote({ productionMemory, latestSessionId }),
    buildRuntimeIntegrityValidationNote({ productionMemory, latestSessionId }),
    buildActivationReadinessScoringNote({ productionMemory, latestSessionId }),
    buildControlledRuntimeProfilesNote({ productionMemory, latestSessionId }),
    buildFutureInferenceActivationNote({ productionMemory, latestSessionId }),
    buildActivationAuthorityRegistryNote({ productionMemory, latestSessionId }),
    buildPreInferenceGateValidationNote({ productionMemory, latestSessionId }),
    buildInferenceEntrySequencingNote({ productionMemory, latestSessionId }),
    buildForbiddenExecutionStatesNote({ productionMemory, latestSessionId }),
    buildGovernanceEscalationModelingNote({ productionMemory, latestSessionId }),
    buildFutureUnlockConditionsNote({ productionMemory, latestSessionId }),
    buildExecutionTemperatureStatesNote({ productionMemory, latestSessionId }),
    buildDryInferenceWarmupNote({ productionMemory, latestSessionId }),
    buildSingleFrameExecutionPrecursorNote({ productionMemory, latestSessionId }),
    buildFrameStageReadinessNote({ productionMemory, latestSessionId }),
    buildWarmupEscalationModelingNote({ productionMemory, latestSessionId }),
    buildFutureBoundedExecutionRulesNote({ productionMemory, latestSessionId }),
    buildDryExecutionTokenRegistryNote({ productionMemory, latestSessionId }),
    buildSingleFrameDryExecutionPathNote({ productionMemory, latestSessionId }),
    buildFrameTraversalValidationNote({ productionMemory, latestSessionId }),
    buildDryExecutionRecoveryNote({ productionMemory, latestSessionId }),
    buildFutureFrameSynthesisUnlocksNote({ productionMemory, latestSessionId }),
    buildExecutionAttemptLedgerNote({ productionMemory, latestSessionId }),
    buildSynthesisContainmentRegistryNote({ productionMemory, latestSessionId }),
    buildGovernedSynthesisPreparationNote({ productionMemory, latestSessionId }),
    buildSynthesisValidationLayerNote({ productionMemory, latestSessionId }),
    buildContainedEscalationModelingNote({ productionMemory, latestSessionId }),
    buildFutureLowResolutionOutputNote({ productionMemory, latestSessionId }),
    buildGovernedRollbackLedgerNote({ productionMemory, latestSessionId }),
    buildRealOutputAuthorizationRegistryNote({ productionMemory, latestSessionId }),
    buildGovernedLowResolutionSandboxNote({ productionMemory, latestSessionId }),
    buildFirstRealSynthesisPathNote({ productionMemory, latestSessionId }),
    buildOutputContainmentValidationNote({ productionMemory, latestSessionId }),
    buildRealOutputRollbackNote({ productionMemory, latestSessionId }),
    buildFutureRendererEscalationNote({ productionMemory, latestSessionId }),
    buildCinematicExecutionLifecycleNote({ productionMemory, latestSessionId }),
    buildContinuityReviewNotesNote({ productionMemory, latestSessionId }),
    buildRetryPlanningRulesNote({ productionMemory, latestSessionId }),
    buildCostAwareGenerationStrategyNote({ productionMemory, latestSessionId }),
    buildCostForecastExamplesNote({ productionMemory, latestSessionId }),
    buildProviderComparisonNotesNote({ productionMemory, latestSessionId }),
    buildProviderPayloadExamplesNote({ productionMemory, latestSessionId }),
    buildDeferredExecutionPlansNote({ productionMemory, latestSessionId }),
    buildApprovalAuditTrailNote({ productionMemory, latestSessionId }),
    buildSandboxSimulationResultsNote({ productionMemory, latestSessionId }),
    buildSessionContinuitySummaryNote({ record, repoProjectContext, latestSessionId }),
    buildHomeNote({
      record,
      authoritativeProjectContext,
      repoProjectContext,
      relationships,
      latestSessionId,
    }),
    buildCurrentFocusNote({ record, repoProjectContext, latestSessionId }),
    buildActiveProjectsNote({ record, babylonContext, aiContext, latestSessionId }),
    buildOperationalLessonsNote({ record, latestSessionId }),
  ].sort((left, right) => {
    const leftPath = `${left.directory}/${left.title}`;
    const rightPath = `${right.directory}/${right.title}`;
    return leftPath.localeCompare(rightPath);
  });

  await Promise.all([
    mkdir(vaultRoot, { recursive: true }),
    mkdir(path.join(vaultRoot, "Projects"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Outcomes"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Architecture"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Recovery"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Strategy"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Resources"), { recursive: true }),
    mkdir(path.join(vaultRoot, "Sessions"), { recursive: true }),
  ]);

  const generatedFiles: string[] = [];
  for (const note of notes) {
    generatedFiles.push(await writeObsidianNote(vaultRoot, note));
  }

  return {
    repoRoot: initialization.repoRoot,
    vaultRoot,
    currentProjectKey: repoProjectContext.project.project_key,
    authoritativeProjectKey: authoritativeProjectContext.project.project_key,
    latestSessionId,
    generatedFiles,
    relationships,
  };
}
