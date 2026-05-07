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
