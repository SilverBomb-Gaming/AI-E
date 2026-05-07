import {
  approveCinematicGenerationJobs,
  archiveFailedCinematicPlan,
  compileCinematicProviderPayload,
  deferCinematicExecutionPlan,
  forecastCinematicSequenceCost,
  readCinematicProductionMemory,
  recordCinematicBudgetOverrideDecision,
  recordCinematicContinuityReviewNote,
  rejectCinematicGenerationJobs,
  requestCinematicRetryPlan,
  simulateCinematicExecutionSandbox,
  validateCinematicExecutionReadiness,
  type CinematicApprovalActionResult,
  type CinematicExecutionReadinessReport,
  type CinematicGenerationJob,
  type CinematicOperatorApprovalStatus,
  type CinematicProviderRoutingMode,
} from "./cinematicProductionMemory";

export type CinematicOperatorQueueItem = {
  job_id: string;
  provider_target: string;
  estimated_cost: number;
  retry_state: string;
  continuity_dependencies: string[];
  prompt_summary: string;
  execution_lifecycle_state: string;
  validation_warnings: string[];
  budget_status: string;
  manual_approval_status: CinematicOperatorApprovalStatus;
  approval_token_id: string | null;
  deferred_until: string | null;
};

export type CinematicOperatorReviewViews = {
  sequence_structure: string[];
  shot_ordering: string[];
  continuity_graph: string[];
  provider_constraints: string[];
  estimated_sequence_budget: string[];
  retry_impact_forecast: string[];
  asset_reuse_opportunities: string[];
};

export type CinematicOperatorApprovalConsole = {
  queue: CinematicOperatorQueueItem[];
  review_views: CinematicOperatorReviewViews;
  readiness: CinematicExecutionReadinessReport | null;
  audit_trail_preview: string[];
  deferred_plan_preview: string[];
};

function promptSummary(job: CinematicGenerationJob): string {
  return job.prompt_payload.compiled_prompt.slice(0, 140);
}

function inferRoutingMode(job?: CinematicGenerationJob): CinematicProviderRoutingMode {
  if (!job) {
    return "offline-planning-mode";
  }
  if (job.provider === "Seedance") {
    return "cheap-draft-provider";
  }
  if (job.provider === "LocalFutureProvider") {
    return "offline-planning-mode";
  }
  if (job.provider === "Veo" || job.provider === "Runway") {
    return "balanced-comparison-mode";
  }
  return "premium-cinematic-provider";
}

export async function readCinematicOperatorApprovalConsole(input?: {
  root?: string;
  sequenceId?: string;
  approvalTokenId?: string;
}): Promise<CinematicOperatorApprovalConsole> {
  const record = await readCinematicProductionMemory({ root: input?.root });
  const jobs = record.generation_jobs.filter((entry) => !input?.sequenceId || entry.sequence_id === input.sequenceId);
  const queue = jobs.map((job) => ({
    job_id: job.job_id,
    provider_target: job.provider,
    estimated_cost: job.estimated_cost,
    retry_state: `retry=${job.retry_count}`,
    continuity_dependencies: job.continuity_context.dependency_shot_ids,
    prompt_summary: promptSummary(job),
    execution_lifecycle_state: job.generation_status,
    validation_warnings: job.validation_state === "invalid" ? ["Provider or continuity validation flagged this job."] : [],
    budget_status: job.requires_manual_approval ? "awaiting operator governance" : "policy-cleared",
    manual_approval_status: job.manual_approval_status,
    approval_token_id: job.approval_token_id,
    deferred_until: job.deferred_until,
  }));

  const relatedSequenceId = input?.sequenceId ?? jobs[0]?.sequence_id;
  const readiness = relatedSequenceId && jobs.length > 0
    ? await validateCinematicExecutionReadiness({
      root: input?.root,
      jobIds: jobs.map((entry) => entry.job_id),
      approvalTokenId: input?.approvalTokenId,
    })
    : null;
  const sequence = relatedSequenceId
    ? record.scene_sequences.find((entry) => entry.sequence_id === relatedSequenceId) ?? null
    : null;
  const budget = relatedSequenceId
    ? await forecastCinematicSequenceCost({
      root: input?.root,
      sequenceId: relatedSequenceId,
      routingMode: inferRoutingMode(jobs[0]),
    })
    : null;

  return {
    queue,
    review_views: {
      sequence_structure: sequence ? sequence.shots.map((entry) => `${entry.shot_id}: ${entry.shot_purpose}`) : ["No sequence selected."],
      shot_ordering: sequence ? sequence.shots.map((entry) => `${entry.shot_order}: ${entry.shot_id}`) : ["No shot ordering available."],
      continuity_graph: sequence ? sequence.shots.map((entry) => `${entry.shot_id} -> ${entry.continuity_dependencies.join(", ") || "none"}`) : ["No continuity graph available."],
      provider_constraints: record.provider_capability_registry.map((entry) => `${entry.provider}: duration<=${entry.max_duration_seconds}s | prompt<=${entry.max_prompt_characters} | refs<=${entry.max_image_references}`),
      estimated_sequence_budget: budget ? [
        `Provider: ${budget.provider}`,
        `Sequence cost: ${budget.estimated_sequence_cost}`,
        `Retry cost: ${budget.estimated_retry_cost}`,
        `Variance: ${budget.provider_variance}`,
      ] : ["No budget forecast available."],
      retry_impact_forecast: budget ? [budget.draft_vs_premium_tradeoff] : ["No retry impact forecast available."],
      asset_reuse_opportunities: sequence
        ? sequence.shots.flatMap((entry) => entry.required_assets.map((assetId) => `${entry.shot_id}: reuse ${assetId} when possible`))
        : ["No asset reuse opportunities available."],
    },
    readiness,
    audit_trail_preview: record.approval_audit_trail.slice(-10).map((entry) => `${entry.append_only_index}. ${entry.action} | ${entry.detail}`),
    deferred_plan_preview: record.deferred_execution_plans.slice(-10).map((entry) => `${entry.defer_id}: until ${entry.deferred_until} | ${entry.reason}`),
  };
}

export async function approveCinematicOperatorConsoleJobs(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  tokenTtlMinutes?: number;
}): Promise<CinematicApprovalActionResult> {
  return approveCinematicGenerationJobs(input);
}

export async function rejectCinematicOperatorConsoleJobs(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
}): Promise<CinematicApprovalActionResult> {
  return rejectCinematicGenerationJobs(input);
}

export async function requestCinematicOperatorRetryPlan(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
}): Promise<CinematicApprovalActionResult> {
  return requestCinematicRetryPlan(input);
}

export async function archiveCinematicOperatorFailedPlan(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
}): Promise<CinematicApprovalActionResult> {
  return archiveFailedCinematicPlan(input);
}

export async function deferCinematicOperatorExecution(input: {
  root?: string;
  operatorId: string;
  jobIds: string[];
  reason: string;
  deferredUntil: string;
}): Promise<CinematicApprovalActionResult> {
  return deferCinematicExecutionPlan(input);
}

export async function sandboxSimulateCinematicOperatorPlan(input: {
  root?: string;
  sequenceId: string;
  routingMode: CinematicProviderRoutingMode;
}) {
  return simulateCinematicExecutionSandbox(input);
}

export async function reviewCinematicOperatorPayloads(input: {
  root?: string;
  jobIds: string[];
}) {
  return Promise.all(input.jobIds.map((jobId) => compileCinematicProviderPayload({ root: input.root, jobId })));
}

export async function recordCinematicOperatorBudgetDecision(input: {
  root?: string;
  operatorId: string;
  sequenceId: string;
  provider: CinematicGenerationJob["provider"];
  requestedBudgetCap: number;
  approvedOverride: boolean;
  reason: string;
}) {
  return recordCinematicBudgetOverrideDecision(input);
}

export async function recordCinematicOperatorContinuityReview(input: {
  root?: string;
  operatorId: string;
  sequenceId: string;
  shotId?: string;
  detail: string;
}) {
  return recordCinematicContinuityReviewNote(input);
}