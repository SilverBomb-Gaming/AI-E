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
import { readCinematicProductionMemory, type CinematicProductionMemoryRecord } from "./cinematicProductionMemory";

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
    buildProviderRoutingRulesNote({ productionMemory, latestSessionId }),
    buildProviderCapabilityRegistryNote({ productionMemory, latestSessionId }),
    buildPromptNormalizationRulesNote({ productionMemory, latestSessionId }),
    buildGenerationBudgetRulesNote({ productionMemory, latestSessionId }),
    buildBudgetGovernanceDecisionsNote({ productionMemory, latestSessionId }),
    buildManualApprovalWorkflowNote({ productionMemory, latestSessionId }),
    buildExecutionReadinessChecklistNote({ productionMemory, latestSessionId }),
    buildCinematicExecutionLifecycleNote({ productionMemory, latestSessionId }),
    buildContinuityReviewNotesNote({ productionMemory, latestSessionId }),
    buildRetryPlanningRulesNote({ productionMemory, latestSessionId }),
    buildCostAwareGenerationStrategyNote({ productionMemory, latestSessionId }),
    buildCostForecastExamplesNote({ productionMemory, latestSessionId }),
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
