import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot } from "./repoContext";

export type SecondBrainSectionName =
  | "working_memory"
  | "outcome_memory"
  | "architecture_memory"
  | "strategy_memory"
  | "resource_memory"
  | "recovery_memory"
  | "agent_coordination_memory";

export type WorkingMemorySection = {
  current_task_state: string;
  active_files: string[];
  active_repo_project: string;
  current_objective: string;
  recent_errors_fixes: string[];
  resume_checkpoint: string;
};

export type OutcomeSummary = {
  outcome_id: string;
  recorded_at: string;
  project_key: string;
  task_source: "copilot" | "codex" | "ai-e" | "operator";
  task_title: string;
  attempted: string;
  status: "passed" | "failed" | "partial" | "blocked";
  validation_result: string;
  should_never_repeat: boolean;
  never_repeat_reason?: string;
};

export type OutcomeMemorySection = {
  latest_outcomes: OutcomeSummary[];
  what_passed: string[];
  what_failed: string[];
  exact_validation_results: string[];
  should_never_be_repeated: string[];
};

export type ArchitectureMemorySection = {
  ownership_rules: string[];
  anti_patterns: string[];
  project_specific_constraints: string[];
  babylon2026_clean_architecture_rules: string[];
};

export type StrategyMemorySection = {
  roadmap: string[];
  current_layer_percentages: Record<string, number>;
  next_milestone: string;
  long_term_goals: string[];
  hands_off_readiness: {
    decision_making_target_percent: number;
    learning_target_percent: number;
    current_full_hands_off_percent: number;
    next_full_hands_off_target_percent: number;
  };
};

export type ResourceMemorySection = {
  available_hardware: string[];
  unavailable_hardware: string[];
  model_api_limits: string[];
  local_offline_fallback_options: string[];
  preferred_fallback_mode: string;
};

export type RecoveryMemorySection = {
  rollback_points: Array<{
    project_key: string;
    commit: string;
    reason: string;
  }>;
  known_good_commits: string[];
  failed_commits: string[];
  emergency_recovery_procedures: string[];
};

export type AgentCoordinationMemorySection = {
  copilot_capabilities: string[];
  ai_e_capabilities: string[];
  human_validation_required: string[];
  safe_task_boundaries: string[];
};

export type ProjectCaseStudy = {
  project_key: string;
  title: string;
  summary: string;
  status: string;
  current_state: string[];
  next_safe_task: string;
  anti_patterns: string[];
  positive_patterns: string[];
  validation_status: string[];
  continuation_context: string;
  known_good_commits: string[];
};

export type SecondBrainRecord = {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  current_project_key: string;
  sections: {
    working_memory: WorkingMemorySection;
    outcome_memory: OutcomeMemorySection;
    architecture_memory: ArchitectureMemorySection;
    strategy_memory: StrategyMemorySection;
    resource_memory: ResourceMemorySection;
    recovery_memory: RecoveryMemorySection;
    agent_coordination_memory: AgentCoordinationMemorySection;
  };
  projects: Record<string, ProjectCaseStudy>;
};

export type SecondBrainOutcomeLogEntry = OutcomeSummary;

export type SecondBrainInitialization = {
  repoRoot: string;
  brainDirectory: string;
  brainPath: string;
  outcomesPath: string;
  caseStudyPath: string;
  record: SecondBrainRecord;
};

export type SecondBrainSummary = {
  current_project_key: string;
  summary: string;
  next_safe_task: string;
  anti_patterns_to_avoid: string[];
  fallback_mode_hint: string;
};

export type CurrentProjectContext = {
  project: ProjectCaseStudy;
  working_memory: WorkingMemorySection;
  architecture_memory: ArchitectureMemorySection;
  next_safe_task: string;
  continuation_context: string;
};

export type FallbackModeDecision = {
  mode: string;
  reason: string;
  deferred_capabilities: string[];
  continuity_actions: string[];
};

export type SecondBrainStartupContext = {
  summary: SecondBrainSummary;
  projectContext: CurrentProjectContext;
  fallbackDecision: FallbackModeDecision;
};

const SECOND_BRAIN_DIR = path.join("data", "second_brain");
const SECOND_BRAIN_FILE = "brain.json";
const SECOND_BRAIN_OUTCOMES_FILE = "outcomes.jsonl";
const SECOND_BRAIN_CASE_STUDY_FILE = path.join("case-studies", "babylon-2026.md");

const DEFAULT_BRAIN_CREATED_AT = "2026-05-06T00:00:00.000Z";

const DEFAULT_SECOND_BRAIN_RECORD: SecondBrainRecord = {
  schema_version: 1,
  created_at: DEFAULT_BRAIN_CREATED_AT,
  updated_at: DEFAULT_BRAIN_CREATED_AT,
  current_project_key: "babylon-2026",
  sections: {
    working_memory: {
      current_task_state: "BABYLON 2026 is stable after Phase 10 and AI-E focus has shifted to second-brain continuity work.",
      active_files: [
        "web/lib/aie/secondBrainMemory.ts",
        "data/second_brain/brain.json",
        "data/second_brain/case-studies/babylon-2026.md",
      ],
      active_repo_project: "AI-E",
      current_objective: "Build a persistent second-brain foundation that preserves project context, outcomes, architecture rules, and fallback continuity.",
      recent_errors_fixes: [
        "BABYLON 2026 wave startup regression fixed by restoring guaranteed SimpleWaveController bootstrap in WeaponPrototype.",
        "BABYLON 2026 combat pacing polished with bounded countdowns, recovery windows, and clearer restart messaging.",
      ],
      resume_checkpoint: "Resume from AI-E second-brain foundation work; BABYLON 2026 is paused in a known-good playable state.",
    },
    outcome_memory: {
      latest_outcomes: [
        {
          outcome_id: "outcome-2026-05-06-babylon-phase-10",
          recorded_at: "2026-05-06T00:00:00.000Z",
          project_key: "babylon-2026",
          task_source: "copilot",
          task_title: "BABYLON 2026 Phase 10 combat pacing + recovery polish",
          attempted: "Added bounded between-wave countdown, recovery, stronger HUD feedback, and clearer death restart messaging.",
          status: "passed",
          validation_result: "Static validation clean across touched Unity scripts and full 1 -> 2 -> 3 wave loop manually verified by user as stable foundation.",
          should_never_repeat: false,
        },
      ],
      what_passed: [
        "Clean ownership boundaries in BABYLON 2026 survived wave, enemy, health, and pacing phases.",
        "Bounded commits plus focused compile checks prevented architecture drift during repeated Unity slices.",
      ],
      what_failed: [
        "Old BABYLON iterations collapsed when single owners mixed spawn, combat, UI, and runtime repair responsibilities.",
      ],
      exact_validation_results: [
        "BABYLON 2026 current verified status: KBM, gamepad, pause/menu, weapon firing, pursuit, steering, separation, enemy attacks, player health/death, multi-enemy spawning, wave progression, wave cleanup, full 1 -> 2 -> 3 wave loop, and final completion loop all pass.",
      ],
      should_never_be_repeated: [
        "Do not reintroduce hidden global repair loops or singleton-style fixers to compensate for ownership mistakes.",
        "Do not collapse weapon, enemy spawning, and wave state into one owner again.",
      ],
    },
    architecture_memory: {
      ownership_rules: [
        "SimpleWaveController owns timing, wave progression, and countdown/recovery pacing only.",
        "SimpleEnemySpawner owns enemy creation and alive-count tracking only.",
        "SimpleEnemy owns enemy health, death, and visuals only.",
        "SimpleEnemyPursuit owns movement, obstacle steering, and crowd separation only.",
        "SimpleEnemyAttack owns enemy attack timing and damage only.",
        "PlayerHealth owns player health, death, HUD, and restart only.",
        "WeaponPrototype owns firing, hit detection, and weapon HUD only.",
        "ControlBaselineController owns controls, camera, pause, and runtime player setup only.",
      ],
      anti_patterns: [
        "Do not copy old BABYLON patterns that relied on emergency fallback overlays, hidden repair loops, global repair chains, or hidden bootstrap behavior.",
        "Do not let one script directly own spawning, combat resolution, progression, and UI feedback together.",
        "Do not use random or procedural recovery tricks to hide unstable control flow.",
      ],
      project_specific_constraints: [
        "Keep BABYLON 2026 deterministic, local, and bounded; no endless loops, navmesh, giant managers, or fake intelligence layers.",
        "For AI-E autonomy work, preserve approval gates and avoid unvalidated autonomous mutation loops.",
      ],
      babylon2026_clean_architecture_rules: [
        "Make the smallest possible owner-local change and validate immediately.",
        "Prefer deterministic spawn/layout and bounded wave logic over generalized systems.",
        "Keep runtime fixes reversible and tied to a known owner.",
      ],
    },
    strategy_memory: {
      roadmap: [
        "Pause BABYLON 2026 feature expansion while the current playable foundation remains stable.",
        "Build AI-E second-brain persistence for restart continuity, outcome recall, and resource-aware fallback decisions.",
        "Feed second-brain context into safe supervised autonomy surfaces after the storage and summary layer is validated.",
      ],
      current_layer_percentages: {
        decision_making: 94,
        learning: 81,
        full_hands_off_production: 77,
      },
      next_milestone: "Second-brain persistence validated as a bounded continuity layer with BABYLON 2026 as the first case study.",
      long_term_goals: [
        "Sustain AI-E across restarts, hardware shortages, and model/API outages with minimal human context reload.",
        "Push supervised production autonomy upward without bypassing validation and approval boundaries.",
      ],
      hands_off_readiness: {
        decision_making_target_percent: 97,
        learning_target_percent: 88,
        current_full_hands_off_percent: 77,
        next_full_hands_off_target_percent: 82,
      },
    },
    resource_memory: {
      available_hardware: [
        "Windows development workstation",
        "Local filesystem persistence",
        "Node/TypeScript runtime inside AI-E web workspace",
      ],
      unavailable_hardware: [
        "Assume premium GPU or uninterrupted high-throughput model access is not guaranteed.",
      ],
      model_api_limits: [
        "External APIs and premium models can become rate-limited or unavailable.",
        "Human validation is still required for real runtime mutations and production-side effects.",
      ],
      local_offline_fallback_options: [
        "local_memory_only_mode",
        "checkpoint_and_summary_mode",
        "offline_planning_and_review_mode",
      ],
      preferred_fallback_mode: "local_memory_only_mode",
    },
    recovery_memory: {
      rollback_points: [
        {
          project_key: "babylon-2026",
          commit: "b431138",
          reason: "Phase 10 combat pacing + recovery polish is the current known-good gameplay checkpoint.",
        },
        {
          project_key: "babylon-2026",
          commit: "790b204",
          reason: "Wave startup regression hotfix restored guaranteed wave bootstrap.",
        },
      ],
      known_good_commits: ["e05df96", "7a7ec16", "ab54efa", "077f459", "faecac2", "73051c3", "790b204", "b431138"],
      failed_commits: [],
      emergency_recovery_procedures: [
        "Return to the latest known-good BABYLON 2026 commit before expanding feature scope.",
        "Use second-brain summaries to rebuild context before resuming AI-E work after restart.",
        "Prefer bounded replay from recorded outcomes over speculative retries.",
      ],
    },
    agent_coordination_memory: {
      copilot_capabilities: [
        "Bounded repo edits, focused validation, and narrow architectural slices.",
        "Fast continuity restoration from persisted summaries and case studies.",
      ],
      ai_e_capabilities: [
        "Persistent context recall, structured outcome logging, resource-aware fallback decisions, and long-horizon planning support.",
        "Cross-session continuity with restart-safe summaries and project checkpoints.",
      ],
      human_validation_required: [
        "Unity Play Mode validation and subjective gameplay feel checks.",
        "Approval for autonomous mutations with external side effects or production impact.",
      ],
      safe_task_boundaries: [
        "Persist summaries, outcomes, constraints, and fallback plans locally.",
        "Do not treat second-brain memory as approval to execute uncontrolled loops.",
      ],
    },
  },
  projects: {
    "babylon-2026": {
      project_key: "babylon-2026",
      title: "BABYLON 2026",
      summary: "Clean Unity combat sandbox with deterministic waves and stable owner boundaries; safe to pause as a case study while AI-E core memory work resumes.",
      status: "stable_paused_case_study",
      current_state: [
        "KBM, gamepad, pause/menu, and weapon firing are stable.",
        "Enemy pursuit, obstacle steering, crowd separation, attacks, and player health/death all work.",
        "Deterministic 1 -> 2 -> 3 wave loop, cleanup, countdown, and final completion feedback pass.",
      ],
      next_safe_task: "Integrate second-brain context retrieval into higher-level AI-E continuity and planning surfaces without changing approval boundaries.",
      anti_patterns: [
        "Do not copy legacy BABYLON repair-loop habits, hidden fallbacks, or owner-collapse patches.",
        "Do not mix wave state, spawning, and weapon logic into one controller.",
      ],
      positive_patterns: [
        "Use local ownership boundaries and validate each bounded slice immediately.",
        "Use deterministic layouts, bounded wave logic, and commit-per-phase recovery points.",
      ],
      validation_status: [
        "User-verified stable sandbox after Phase 10.",
        "No red console errors accepted as closure criteria.",
      ],
      continuation_context: "BABYLON 2026 can be resumed later from known-good commits; no urgent gameplay repair remains before AI-E core evolution continues.",
      known_good_commits: ["e05df96", "7a7ec16", "ab54efa", "077f459", "faecac2", "73051c3", "790b204", "b431138"],
    },
  },
};

const DEFAULT_BABYLON_CASE_STUDY = `# BABYLON 2026 Case Study

## Stable State
- Deterministic 1 -> 2 -> 3 wave combat loop passes.
- KBM, gamepad, pause/menu, firing, health/death, pursuit, steering, and crowd separation all hold.
- Phase 10 pacing and recovery polish improved readability without breaking ownership.

## Positive Patterns
- Keep each owner local and narrow.
- Use focused validation after each bounded edit.
- Preserve known-good commits at the end of each stable slice.

## Anti-Patterns From Older BABYLON Work
- Avoid hidden repair loops and emergency bootstrap chains.
- Avoid mixing weapon, wave, spawn, and health state into one script.
- Avoid random recovery behavior that masks structural ownership errors.

## Current Safe Next Step
- Resume AI-E core evolution by persisting memory, outcomes, and fallback strategy before adding new autonomous production behavior.
`;

function cloneDefaultRecord(): SecondBrainRecord {
  return JSON.parse(JSON.stringify(DEFAULT_SECOND_BRAIN_RECORD)) as SecondBrainRecord;
}

function resolveRepoRootSync(root = process.cwd()): string {
  const normalizedRoot = path.resolve(root);
  if (path.basename(normalizedRoot).toLowerCase() === "web") {
    return path.resolve(normalizedRoot, "..");
  }

  if (existsSync(path.join(normalizedRoot, "web"))) {
    return normalizedRoot;
  }

  return normalizedRoot;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const fileText = await readFile(filePath, "utf8");
    return JSON.parse(fileText) as T;
  } catch {
    return null;
  }
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function writeBrainRecord(brainPath: string, record: SecondBrainRecord): Promise<SecondBrainRecord> {
  const nextRecord: SecondBrainRecord = {
    ...record,
    updated_at: new Date().toISOString(),
  };
  await writeFile(brainPath, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");
  return nextRecord;
}

async function loadBrainRecord(root?: string): Promise<SecondBrainInitialization> {
  const repoRoot = await resolveRepoRoot(root ?? process.cwd());
  const brainDirectory = path.join(repoRoot, SECOND_BRAIN_DIR);
  const brainPath = path.join(brainDirectory, SECOND_BRAIN_FILE);
  const outcomesPath = path.join(brainDirectory, SECOND_BRAIN_OUTCOMES_FILE);
  const caseStudyPath = path.join(brainDirectory, SECOND_BRAIN_CASE_STUDY_FILE);

  await mkdir(path.dirname(caseStudyPath), { recursive: true });
  await ensureFile(brainPath, `${JSON.stringify(cloneDefaultRecord(), null, 2)}\n`);
  await ensureFile(outcomesPath, "");
  await ensureFile(caseStudyPath, DEFAULT_BABYLON_CASE_STUDY);

  const record = await readJsonFile<SecondBrainRecord>(brainPath) ?? cloneDefaultRecord();
  return {
    repoRoot,
    brainDirectory,
    brainPath,
    outcomesPath,
    caseStudyPath,
    record,
  };
}

function loadBrainRecordSync(root?: string): SecondBrainInitialization {
  const repoRoot = resolveRepoRootSync(root ?? process.cwd());
  const brainDirectory = path.join(repoRoot, SECOND_BRAIN_DIR);
  const brainPath = path.join(brainDirectory, SECOND_BRAIN_FILE);
  const outcomesPath = path.join(brainDirectory, SECOND_BRAIN_OUTCOMES_FILE);
  const caseStudyPath = path.join(brainDirectory, SECOND_BRAIN_CASE_STUDY_FILE);

  const record = existsSync(brainPath)
    ? (() => {
        try {
          return JSON.parse(readFileSync(brainPath, "utf8")) as SecondBrainRecord;
        } catch {
          return cloneDefaultRecord();
        }
      })()
    : cloneDefaultRecord();

  return {
    repoRoot,
    brainDirectory,
    brainPath,
    outcomesPath,
    caseStudyPath,
    record,
  };
}

export async function ensureSecondBrainInitialized(root?: string): Promise<SecondBrainInitialization> {
  return loadBrainRecord(root);
}

export async function readSecondBrainMemory(input?: {
  root?: string;
  section?: SecondBrainSectionName;
}): Promise<SecondBrainRecord | SecondBrainRecord["sections"][SecondBrainSectionName]> {
  const initialization = await loadBrainRecord(input?.root);
  if (!input?.section) {
    return initialization.record;
  }

  return initialization.record.sections[input.section];
}

export async function writeSecondBrainMemory(input: {
  root?: string;
  section: SecondBrainSectionName;
  value: SecondBrainRecord["sections"][SecondBrainSectionName];
  merge?: boolean;
}): Promise<SecondBrainRecord["sections"][SecondBrainSectionName]> {
  const initialization = await loadBrainRecord(input.root);
  const currentValue = initialization.record.sections[input.section];
  const nextValue = input.merge && typeof currentValue === "object" && typeof input.value === "object"
    ? { ...currentValue, ...input.value }
    : input.value;

  const nextRecord: SecondBrainRecord = {
    ...initialization.record,
    sections: {
      ...initialization.record.sections,
      [input.section]: nextValue,
    },
  };

  const written = await writeBrainRecord(initialization.brainPath, nextRecord);
  return written.sections[input.section];
}

export async function updateSecondBrainOutcomeLog(input: {
  root?: string;
  entry: SecondBrainOutcomeLogEntry;
}): Promise<{ output_path: string; record: SecondBrainRecord; entry: SecondBrainOutcomeLogEntry }> {
  const initialization = await loadBrainRecord(input.root);
  const entry: SecondBrainOutcomeLogEntry = {
    ...input.entry,
    task_title: normalizeText(input.entry.task_title),
    attempted: normalizeText(input.entry.attempted),
    validation_result: normalizeText(input.entry.validation_result),
    never_repeat_reason: normalizeText(input.entry.never_repeat_reason) || undefined,
  };

  await appendFile(initialization.outcomesPath, `${JSON.stringify(entry)}\n`, "utf8");

  const currentOutcomeMemory = initialization.record.sections.outcome_memory;
  const nextOutcomeMemory: OutcomeMemorySection = {
    latest_outcomes: [entry, ...currentOutcomeMemory.latest_outcomes].slice(0, 12),
    what_passed: entry.status === "passed"
      ? [entry.task_title, ...currentOutcomeMemory.what_passed.filter((value) => value !== entry.task_title)].slice(0, 12)
      : currentOutcomeMemory.what_passed,
    what_failed: entry.status === "failed"
      ? [entry.task_title, ...currentOutcomeMemory.what_failed.filter((value) => value !== entry.task_title)].slice(0, 12)
      : currentOutcomeMemory.what_failed,
    exact_validation_results: [entry.validation_result, ...currentOutcomeMemory.exact_validation_results.filter((value) => value !== entry.validation_result)].slice(0, 20),
    should_never_be_repeated: entry.should_never_repeat && entry.never_repeat_reason
      ? [entry.never_repeat_reason, ...currentOutcomeMemory.should_never_be_repeated.filter((value) => value !== entry.never_repeat_reason)].slice(0, 20)
      : currentOutcomeMemory.should_never_be_repeated,
  };

  const nextWorkingMemory: WorkingMemorySection = {
    ...initialization.record.sections.working_memory,
    recent_errors_fixes: [
      `${entry.task_source}: ${entry.task_title} -> ${entry.status} (${entry.validation_result})`,
      ...initialization.record.sections.working_memory.recent_errors_fixes,
    ].slice(0, 10),
  };

  const nextRecord: SecondBrainRecord = {
    ...initialization.record,
    sections: {
      ...initialization.record.sections,
      outcome_memory: nextOutcomeMemory,
      working_memory: nextWorkingMemory,
    },
  };

  const written = await writeBrainRecord(initialization.brainPath, nextRecord);
  return {
    output_path: initialization.outcomesPath,
    record: written,
    entry,
  };
}

export async function retrieveCurrentProjectContext(input?: {
  root?: string;
  projectKey?: string;
}): Promise<CurrentProjectContext> {
  const initialization = await loadBrainRecord(input?.root);
  const projectKey = input?.projectKey ?? initialization.record.current_project_key;
  const project = initialization.record.projects[projectKey];
  if (!project) {
    throw new Error(`No second-brain project context found for ${projectKey}.`);
  }

  return {
    project,
    working_memory: initialization.record.sections.working_memory,
    architecture_memory: initialization.record.sections.architecture_memory,
    next_safe_task: project.next_safe_task,
    continuation_context: project.continuation_context,
  };
}

export function retrieveCurrentProjectContextSync(input?: {
  root?: string;
  projectKey?: string;
}): CurrentProjectContext {
  const initialization = loadBrainRecordSync(input?.root);
  const projectKey = input?.projectKey ?? initialization.record.current_project_key;
  const project = initialization.record.projects[projectKey];
  if (!project) {
    throw new Error(`No second-brain project context found for ${projectKey}.`);
  }

  return {
    project,
    working_memory: initialization.record.sections.working_memory,
    architecture_memory: initialization.record.sections.architecture_memory,
    next_safe_task: project.next_safe_task,
    continuation_context: project.continuation_context,
  };
}

export async function summarizeSecondBrainMemory(input?: {
  root?: string;
  projectKey?: string;
}): Promise<SecondBrainSummary> {
  const context = await retrieveCurrentProjectContext(input);
  const resourceMemory = (await loadBrainRecord(input?.root)).record.sections.resource_memory;

  return {
    current_project_key: context.project.project_key,
    summary: [
      `Current project: ${context.project.title}`,
      `Status: ${context.project.status}`,
      `Summary: ${context.project.summary}`,
      `Current state: ${context.project.current_state.join(" | ")}`,
      `Resume checkpoint: ${context.working_memory.resume_checkpoint}`,
    ].join("\n"),
    next_safe_task: context.project.next_safe_task,
    anti_patterns_to_avoid: context.project.anti_patterns,
    fallback_mode_hint: resourceMemory.preferred_fallback_mode,
  };
}

export function summarizeSecondBrainMemorySync(input?: {
  root?: string;
  projectKey?: string;
}): SecondBrainSummary {
  const context = retrieveCurrentProjectContextSync(input);
  const resourceMemory = loadBrainRecordSync(input?.root).record.sections.resource_memory;

  return {
    current_project_key: context.project.project_key,
    summary: [
      `Current project: ${context.project.title}`,
      `Status: ${context.project.status}`,
      `Summary: ${context.project.summary}`,
      `Current state: ${context.project.current_state.join(" | ")}`,
      `Resume checkpoint: ${context.working_memory.resume_checkpoint}`,
    ].join("\n"),
    next_safe_task: context.project.next_safe_task,
    anti_patterns_to_avoid: context.project.anti_patterns,
    fallback_mode_hint: resourceMemory.preferred_fallback_mode,
  };
}

export async function chooseSecondBrainFallbackMode(input?: {
  root?: string;
  unavailableHardware?: string[];
  unavailableApis?: string[];
  unavailableModels?: string[];
}): Promise<FallbackModeDecision> {
  const initialization = await loadBrainRecord(input?.root);
  const resourceMemory = initialization.record.sections.resource_memory;
  const unavailableHardware = input?.unavailableHardware ?? [];
  const unavailableApis = input?.unavailableApis ?? [];
  const unavailableModels = input?.unavailableModels ?? [];
  const resourcePressure = unavailableHardware.length + unavailableApis.length + unavailableModels.length;

  if (resourcePressure === 0) {
    return {
      mode: "standard_hybrid_mode",
      reason: "Core hardware and model/API access are available, so AI-E can keep using normal supervised continuity.",
      deferred_capabilities: [],
      continuity_actions: [
        "Keep recording outcomes and memory updates.",
        "Preserve approval gates for real-world mutations.",
      ],
    };
  }

  return {
    mode: resourceMemory.preferred_fallback_mode,
    reason: `Resource pressure detected: hardware=${unavailableHardware.length}, apis=${unavailableApis.length}, models=${unavailableModels.length}. Switch to local memory and checkpoint continuity until external capacity recovers.`,
    deferred_capabilities: [
      "High-frequency external model usage",
      "Non-essential API-dependent planning passes",
    ],
    continuity_actions: [
      "Persist current project summary to the second brain.",
      "Record the latest outcome and known-good checkpoint.",
      `Operate through ${resourceMemory.local_offline_fallback_options.join(", ")}.`,
    ],
  };
}

export function chooseSecondBrainFallbackModeSync(input?: {
  root?: string;
  unavailableHardware?: string[];
  unavailableApis?: string[];
  unavailableModels?: string[];
}): FallbackModeDecision {
  const initialization = loadBrainRecordSync(input?.root);
  const resourceMemory = initialization.record.sections.resource_memory;
  const unavailableHardware = input?.unavailableHardware ?? [];
  const unavailableApis = input?.unavailableApis ?? [];
  const unavailableModels = input?.unavailableModels ?? [];
  const resourcePressure = unavailableHardware.length + unavailableApis.length + unavailableModels.length;

  if (resourcePressure === 0) {
    return {
      mode: "standard_hybrid_mode",
      reason: "Core hardware and model/API access are available, so AI-E can keep using normal supervised continuity.",
      deferred_capabilities: [],
      continuity_actions: [
        "Keep recording outcomes and memory updates.",
        "Preserve approval gates for real-world mutations.",
      ],
    };
  }

  return {
    mode: resourceMemory.preferred_fallback_mode,
    reason: `Resource pressure detected: hardware=${unavailableHardware.length}, apis=${unavailableApis.length}, models=${unavailableModels.length}. Switch to local memory and checkpoint continuity until external capacity recovers.`,
    deferred_capabilities: [
      "High-frequency external model usage",
      "Non-essential API-dependent planning passes",
    ],
    continuity_actions: [
      "Persist current project summary to the second brain.",
      "Record the latest outcome and known-good checkpoint.",
      `Operate through ${resourceMemory.local_offline_fallback_options.join(", ")}.`,
    ],
  };
}

export async function loadSecondBrainStartupContext(input?: {
  root?: string;
  projectKey?: string;
  unavailableHardware?: string[];
  unavailableApis?: string[];
  unavailableModels?: string[];
}): Promise<SecondBrainStartupContext> {
  const [summary, projectContext, fallbackDecision] = await Promise.all([
    summarizeSecondBrainMemory(input),
    retrieveCurrentProjectContext(input),
    chooseSecondBrainFallbackMode(input),
  ]);

  return {
    summary,
    projectContext,
    fallbackDecision,
  };
}

export function loadSecondBrainStartupContextSync(input?: {
  root?: string;
  projectKey?: string;
  unavailableHardware?: string[];
  unavailableApis?: string[];
  unavailableModels?: string[];
}): SecondBrainStartupContext {
  return {
    summary: summarizeSecondBrainMemorySync(input),
    projectContext: retrieveCurrentProjectContextSync(input),
    fallbackDecision: chooseSecondBrainFallbackModeSync(input),
  };
}