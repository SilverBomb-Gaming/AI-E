import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoRoot, resolveRepoRootSync } from "./repoContext";

const SECOND_BRAIN_DIR = path.join("data", "second_brain");
const PRODUCTION_MEMORY_FILE = "production_memory.json";
const DEFAULT_CREATED_AT = "2026-05-07T00:00:00.000Z";

export type CostTier = "low" | "medium" | "high";

export type ProductionMemoryManagerSystem = {
  id:
    | "production-memory-manager"
    | "scene-graph-builder"
    | "shot-planner"
    | "trailer-cutscene-director"
    | "continuity-checker"
    | "asset-reuse-tracker"
    | "gameplay-cutscene-trigger-system"
    | "cinematic-prompt-compiler"
    | "cost-aware-iteration-system"
    | "second-brain-obsidian-integration";
  title: string;
  status: "planned" | "foundation" | "active";
  summary: string;
};

export type CinematicCharacterProfile = {
  character_id: string;
  name: string;
  role: string;
  visual_signature: string[];
  emotional_range: string[];
  continuity_rules: string[];
};

export type CinematicEnvironmentProfile = {
  environment_id: string;
  name: string;
  mood: string;
  visual_markers: string[];
  lighting_rules: string[];
  props: string[];
};

export type CinematicStoryBeat = {
  beat_id: string;
  title: string;
  summary: string;
  emotional_goal: string;
  gameplay_trigger: string;
  continuity_dependencies: string[];
};

export type CinematicShotRecord = {
  shot_id: string;
  recorded_at: string;
  beat_id: string;
  intent: string;
  camera_framing: string;
  camera_motion: string;
  lens_language: string;
  lighting_direction: string;
  outcome: string;
};

export type CinematicAssetRecord = {
  asset_id: string;
  kind: "image" | "video" | "audio" | "prompt" | "edit";
  label: string;
  source: string;
  reusable: boolean;
  reuse_notes: string[];
};

export type CinematicGenerationOutcome = {
  generation_id: string;
  recorded_at: string;
  shot_id: string;
  status: "failed" | "successful";
  prompt_summary: string;
  engine: string;
  cost_tier: CostTier;
  asset_ids: string[];
  notes: string[];
};

export type CinematicGameplayContext = {
  current_sequence: string;
  trigger_conditions: string[];
  player_state_requirements: string[];
  blocked_by: string[];
  downstream_payoffs: string[];
};

export type CinematicProductionMemoryRecord = {
  schema_version: 1;
  created_at: string;
  updated_at: string;
  project_key: string;
  mission_layer: string;
  roadmap_systems: ProductionMemoryManagerSystem[];
  characters: CinematicCharacterProfile[];
  environments: CinematicEnvironmentProfile[];
  story_beats: CinematicStoryBeat[];
  emotional_tone: string[];
  visual_style: string[];
  camera_language: string[];
  lighting: string[];
  props: string[];
  continuity_rules: string[];
  shot_history: CinematicShotRecord[];
  generated_assets: CinematicAssetRecord[];
  failed_generations: CinematicGenerationOutcome[];
  successful_generations: CinematicGenerationOutcome[];
  edit_decisions: string[];
  pacing_notes: string[];
  gameplay_context: CinematicGameplayContext;
  cost_aware_iteration_notes: string[];
};

export type CinematicProductionMemoryInitialization = {
  repoRoot: string;
  productionMemoryPath: string;
  record: CinematicProductionMemoryRecord;
};

export type CompiledCinematicShotPrompt = {
  shot_id: string;
  project_key: string;
  beat_id: string;
  prompt: string;
  continuity_constraints: string[];
  asset_reuse_candidates: string[];
  estimated_cost_tier: CostTier;
};

const DEFAULT_PRODUCTION_MEMORY_RECORD: CinematicProductionMemoryRecord = {
  schema_version: 1,
  created_at: DEFAULT_CREATED_AT,
  updated_at: DEFAULT_CREATED_AT,
  project_key: "babylon-2026",
  mission_layer: "Persistent Production Memory + Cinematic Video Intelligence",
  roadmap_systems: [
    {
      id: "production-memory-manager",
      title: "Production Memory Manager",
      status: "foundation",
      summary: "Persist characters, beats, style, continuity, and iteration outcomes as bounded production memory.",
    },
    {
      id: "scene-graph-builder",
      title: "Scene Graph Builder",
      status: "planned",
      summary: "Map playable scenes, cinematic spaces, and asset relationships into reusable scene context.",
    },
    {
      id: "shot-planner",
      title: "Shot Planner",
      status: "planned",
      summary: "Turn story beats and gameplay triggers into explicit shot plans with framing and pacing.",
    },
    {
      id: "trailer-cutscene-director",
      title: "Trailer/Cutscene Director",
      status: "planned",
      summary: "Sequence beats, reveals, and gameplay-cinematic transitions into a coherent directing pass.",
    },
    {
      id: "continuity-checker",
      title: "Continuity Checker",
      status: "planned",
      summary: "Guard tone, prop, costume, geography, and gameplay state continuity across generations.",
    },
    {
      id: "asset-reuse-tracker",
      title: "Asset Reuse Tracker",
      status: "planned",
      summary: "Track reusable shots, prompts, edits, and source assets to reduce drift and cost.",
    },
    {
      id: "gameplay-cutscene-trigger-system",
      title: "Gameplay Cutscene Trigger System",
      status: "planned",
      summary: "Bind gameplay conditions and state changes to cinematic beat activation points.",
    },
    {
      id: "cinematic-prompt-compiler",
      title: "Cinematic Prompt Compiler",
      status: "foundation",
      summary: "Compile production memory into structured shot prompts without invoking generation yet.",
    },
    {
      id: "cost-aware-iteration-system",
      title: "Cost-Aware Iteration System",
      status: "planned",
      summary: "Record failed/successful attempts with cost tiers and prioritize bounded iteration loops.",
    },
    {
      id: "second-brain-obsidian-integration",
      title: "Second Brain + Obsidian integration",
      status: "foundation",
      summary: "Export human-readable cinematic planning notes while keeping machine memory authoritative.",
    },
  ],
  characters: [
    {
      character_id: "babylon-protagonist",
      name: "BABYLON Runner",
      role: "player-avatar",
      visual_signature: ["compact armored silhouette", "clear traversal gear", "high contrast gameplay readability"],
      emotional_range: ["resolve", "pressure", "recovery"],
      continuity_rules: ["Keep silhouette readable in gameplay and cinematic framing.", "Do not contradict currently implemented player abilities."],
    },
  ],
  environments: [
    {
      environment_id: "babylon-arena-foundation",
      name: "BABYLON Arena Foundation",
      mood: "controlled tension",
      visual_markers: ["clean arena lanes", "clear enemy approach vectors", "combat readability first"],
      lighting_rules: ["Preserve readable player/enemy separation.", "Avoid dramatic darkness that obscures gameplay state."],
      props: ["spawn pads", "weapon pickup silhouettes", "impact debris accents"],
    },
  ],
  story_beats: [
    {
      beat_id: "babylon-cutscene-proof",
      title: "Wave Start Pressure Beat",
      summary: "A short gameplay-adjacent cutscene establishes the next wave as pressure rises before control returns.",
      emotional_goal: "anticipation without losing tactical clarity",
      gameplay_trigger: "wave countdown enters final beat",
      continuity_dependencies: ["Match current arena layout.", "Do not imply weapons or enemies not present in the playable build."],
    },
  ],
  emotional_tone: ["pressured", "readable", "confident", "kinetic"],
  visual_style: ["gameplay-first cinematic framing", "clean sci-fi action", "high legibility silhouettes"],
  camera_language: ["push-ins for wave reveals", "shoulder-height tactical framing", "brief hero inserts between combat beats"],
  lighting: ["rim light for subject separation", "arena practicals over abstract mood lighting"],
  props: ["arena barriers", "weapon silhouettes", "enemy spawn markers"],
  continuity_rules: [
    "Cinematics must respect the live gameplay state and known-good BABYLON systems.",
    "Do not invent props, locations, or powers that the current production case study does not support.",
    "Shot-to-shot lighting must preserve player/enemy readability over dramatic stylization.",
  ],
  shot_history: [
    {
      shot_id: "shot-wave-reveal-001",
      recorded_at: DEFAULT_CREATED_AT,
      beat_id: "babylon-cutscene-proof",
      intent: "Establish incoming pressure before the next combat loop.",
      camera_framing: "wide arena reveal",
      camera_motion: "slow push-in",
      lens_language: "24mm gameplay-aware environment read",
      lighting_direction: "practicals plus subject rim separation",
      outcome: "baseline planning only",
    },
  ],
  generated_assets: [
    {
      asset_id: "prompt-wave-reveal-001",
      kind: "prompt",
      label: "Wave reveal planning prompt",
      source: "ai-e cinematic production memory foundation",
      reusable: true,
      reuse_notes: ["Use as a baseline for countdown-to-wave reveal beats."],
    },
  ],
  failed_generations: [
    {
      generation_id: "failed-wave-overstyle-001",
      recorded_at: DEFAULT_CREATED_AT,
      shot_id: "shot-wave-reveal-001",
      status: "failed",
      prompt_summary: "Attempted an overly dark, trailerized reveal that hid gameplay geography.",
      engine: "planning-placeholder",
      cost_tier: "low",
      asset_ids: [],
      notes: ["Rejected because gameplay readability collapsed.", "Keep arena geography visible."],
    },
  ],
  successful_generations: [
    {
      generation_id: "success-wave-readable-001",
      recorded_at: DEFAULT_CREATED_AT,
      shot_id: "shot-wave-reveal-001",
      status: "successful",
      prompt_summary: "Readable arena reveal with light motion and preserved tactical clarity.",
      engine: "planning-placeholder",
      cost_tier: "low",
      asset_ids: ["prompt-wave-reveal-001"],
      notes: ["Use as the canonical starting point for BABYLON cutscene proofs."],
    },
  ],
  edit_decisions: [
    "Keep cutscene inserts short enough that they can hand control back to gameplay cleanly.",
    "Prefer inserts that clarify upcoming threat state instead of abstract montage."],
  pacing_notes: [
    "Pre-combat beats should feel brief and intentional, not like separate non-interactive scenes.",
    "Use a quick rise in framing intensity just before the player regains control."],
  gameplay_context: {
    current_sequence: "Wave transition pressure beat",
    trigger_conditions: ["wave countdown active", "arena state stable", "player not dead"],
    player_state_requirements: ["player weapon equipped", "camera ownership stable", "HUD readable"],
    blocked_by: ["combat still active", "unresolved validation regressions"],
    downstream_payoffs: ["clearer wave start anticipation", "gameplay-cinematic continuity proof for BABYLON 2026"],
  },
  cost_aware_iteration_notes: [
    "Start with low-cost prompt and storyboard iterations before any expensive video generation pass.",
    "Reuse approved prompts and shot language before introducing new stylistic branches.",
  ],
};

function cloneDefaultRecord(): CinematicProductionMemoryRecord {
  return JSON.parse(JSON.stringify(DEFAULT_PRODUCTION_MEMORY_RECORD)) as CinematicProductionMemoryRecord;
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

async function ensureFile(filePath: string, content: string): Promise<void> {
  try {
    await readFile(filePath, "utf8");
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
  }
}

async function writeProductionMemoryRecord(filePath: string, record: CinematicProductionMemoryRecord): Promise<CinematicProductionMemoryRecord> {
  const nextRecord: CinematicProductionMemoryRecord = {
    ...record,
    updated_at: new Date().toISOString(),
  };
  await writeFile(filePath, `${JSON.stringify(nextRecord, null, 2)}\n`, "utf8");
  return nextRecord;
}

async function loadProductionMemory(root?: string): Promise<CinematicProductionMemoryInitialization> {
  const repoRoot = await resolveRepoRoot(root ?? process.cwd());
  const productionMemoryPath = path.join(repoRoot, SECOND_BRAIN_DIR, PRODUCTION_MEMORY_FILE);
  await ensureFile(productionMemoryPath, `${JSON.stringify(cloneDefaultRecord(), null, 2)}\n`);

  let record = cloneDefaultRecord();
  try {
    const parsed = JSON.parse(await readFile(productionMemoryPath, "utf8")) as CinematicProductionMemoryRecord;
    record = { ...cloneDefaultRecord(), ...parsed };
  } catch {
    record = cloneDefaultRecord();
  }

  return {
    repoRoot,
    productionMemoryPath,
    record,
  };
}

function loadProductionMemorySync(root?: string): CinematicProductionMemoryInitialization {
  const repoRoot = resolveRepoRootSync(root ?? process.cwd());
  const productionMemoryPath = path.join(repoRoot, SECOND_BRAIN_DIR, PRODUCTION_MEMORY_FILE);

  let record = cloneDefaultRecord();
  if (existsSync(productionMemoryPath)) {
    try {
      record = { ...cloneDefaultRecord(), ...JSON.parse(readFileSync(productionMemoryPath, "utf8")) as CinematicProductionMemoryRecord };
    } catch {
      record = cloneDefaultRecord();
    }
  }

  return {
    repoRoot,
    productionMemoryPath,
    record,
  };
}

export async function ensureCinematicProductionMemoryInitialized(root?: string): Promise<CinematicProductionMemoryInitialization> {
  return loadProductionMemory(root);
}

export async function readCinematicProductionMemory(input?: { root?: string }): Promise<CinematicProductionMemoryRecord> {
  return (await loadProductionMemory(input?.root)).record;
}

export function readCinematicProductionMemorySync(input?: { root?: string }): CinematicProductionMemoryRecord {
  return loadProductionMemorySync(input?.root).record;
}

export async function writeCinematicProductionMemory(input: {
  root?: string;
  value: Partial<CinematicProductionMemoryRecord>;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    ...input.value,
  };
  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

export async function recordCinematicGenerationOutcome(input: {
  root?: string;
  entry: CinematicGenerationOutcome;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const entry: CinematicGenerationOutcome = {
    ...input.entry,
    prompt_summary: normalizeText(input.entry.prompt_summary),
    engine: normalizeText(input.entry.engine),
    notes: input.entry.notes.map((note) => normalizeText(note)).filter(Boolean),
  };

  const failedGenerations = entry.status === "failed"
    ? [entry, ...initialization.record.failed_generations.filter((value) => value.generation_id !== entry.generation_id)].slice(0, 20)
    : initialization.record.failed_generations;
  const successfulGenerations = entry.status === "successful"
    ? [entry, ...initialization.record.successful_generations.filter((value) => value.generation_id !== entry.generation_id)].slice(0, 20)
    : initialization.record.successful_generations;

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    failed_generations: failedGenerations,
    successful_generations: successfulGenerations,
  };

  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

export async function recordCinematicShotHistory(input: {
  root?: string;
  entry: CinematicShotRecord;
}): Promise<CinematicProductionMemoryRecord> {
  const initialization = await loadProductionMemory(input.root);
  const entry: CinematicShotRecord = {
    ...input.entry,
    intent: normalizeText(input.entry.intent),
    camera_framing: normalizeText(input.entry.camera_framing),
    camera_motion: normalizeText(input.entry.camera_motion),
    lens_language: normalizeText(input.entry.lens_language),
    lighting_direction: normalizeText(input.entry.lighting_direction),
    outcome: normalizeText(input.entry.outcome),
  };

  const nextRecord: CinematicProductionMemoryRecord = {
    ...initialization.record,
    shot_history: [entry, ...initialization.record.shot_history.filter((value) => value.shot_id !== entry.shot_id)].slice(0, 40),
  };

  return writeProductionMemoryRecord(initialization.productionMemoryPath, nextRecord);
}

function estimateCostTier(record: CinematicProductionMemoryRecord, beat: CinematicStoryBeat, shot: CinematicShotRecord): CostTier {
  const constraintCount = record.continuity_rules.length + beat.continuity_dependencies.length;
  const motionWeight = /crane|drone|long take|complex/i.test(shot.camera_motion) ? 2 : 0;
  const styleWeight = record.visual_style.length > 3 ? 1 : 0;
  const total = constraintCount + motionWeight + styleWeight;
  if (total >= 8) {
    return "high";
  }
  if (total >= 5) {
    return "medium";
  }
  return "low";
}

export async function compileCinematicShotPrompt(input: {
  root?: string;
  shotId: string;
}): Promise<CompiledCinematicShotPrompt> {
  const record = await readCinematicProductionMemory({ root: input.root });
  const shot = record.shot_history.find((entry) => entry.shot_id === input.shotId);
  if (!shot) {
    throw new Error(`Unknown cinematic shot id: ${input.shotId}`);
  }

  const beat = record.story_beats.find((entry) => entry.beat_id === shot.beat_id);
  if (!beat) {
    throw new Error(`Unknown cinematic beat id: ${shot.beat_id}`);
  }

  const assetReuseCandidates = record.generated_assets
    .filter((entry) => entry.reusable)
    .map((entry) => `${entry.asset_id}: ${entry.label}`)
    .slice(0, 6);
  const estimatedCostTier = estimateCostTier(record, beat, shot);

  const prompt = [
    `Project: ${record.project_key}`,
    `Beat: ${beat.title}`,
    `Intent: ${shot.intent}`,
    `Emotional target: ${beat.emotional_goal}`,
    `Visual style: ${record.visual_style.join(", ")}`,
    `Camera language: ${shot.camera_framing}; ${shot.camera_motion}; ${shot.lens_language}`,
    `Lighting: ${shot.lighting_direction}`,
    `Environment cues: ${record.environments.map((entry) => entry.name).join(", ")}`,
    `Gameplay context: ${record.gameplay_context.current_sequence}`,
    `Avoid breaking continuity: ${[...record.continuity_rules, ...beat.continuity_dependencies].join(" | ")}`,
  ].join("\n");

  return {
    shot_id: shot.shot_id,
    project_key: record.project_key,
    beat_id: beat.beat_id,
    prompt,
    continuity_constraints: [...record.continuity_rules, ...beat.continuity_dependencies],
    asset_reuse_candidates: assetReuseCandidates,
    estimated_cost_tier: estimatedCostTier,
  };
}