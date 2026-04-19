import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import type { FollowUpVerificationState, StoredActionChainState } from "./components/AnalysisForm";
import { buildAnalysisTraceRecord } from "./lib/aie/analysisTrace";
import type { AnalysisInput, FreeAnalysisResponse } from "./lib/aie/types";

const prompts = {
  isolation: "After refactoring the wall-jump handoff, the player only sticks on shallow slopes right after a dash. The symptom appears immediately when that movement handoff runs, while the rest of movement feels normal.",
  duplicateWriter: "Sprint speed flickers after I added a stamina limiter. The limiter writes run speed in Update, but the locomotion controller also writes speed later in the same frame, so movement keeps bouncing between two values.",
  ownership: "A homing missile prefab spawns correctly, but it sometimes has no target and flies straight ahead. The launcher stores the target on one object, while the spawned projectile reads from another reference, so this may be an ownership or reference handoff issue.",
  animator: "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.",
};

const observations = {
  falsifies: "Disabling the stamina limiter changed nothing, but disabling the animator speed sync removes the slowdown completely.",
  pending: "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.",
  committed: "The same Animator handoff still cleanly drives the symptom, and the confirm check keeps matching the expected path.",
};

async function analyze(problemDescription: string): Promise<FreeAnalysisResponse> {
  const response = await fetch("http://localhost:3000/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ problemDescription }),
  });
  return response.json();
}

async function runProbe() {
  const logicModule = await import(pathToFileURL(resolve(process.cwd(), "components/analysisResultLogic.ts")).href);
  const { deriveAnalysisResultSignals, buildFollowUpProblemDescription, classifyFollowUpResult, buildFalsifiedDiagnosis, buildNextStepGuidance, buildGuidedStepStack } = logicModule;

  function derive(
    input: AnalysisInput,
    result: FreeAnalysisResponse,
    isRefined?: boolean,
    lastObservation?: string,
    verificationState?: FollowUpVerificationState,
    previousActionChainState?: StoredActionChainState,
  ) {
    return deriveAnalysisResultSignals({ result, problemDescription: input.problemDescription, isRefined, lastObservation, verificationState, previousActionChainState });
  }

  const results = [];

  // 1. Clean Isolation
  const isoResult = await analyze(prompts.isolation);
  const isoDerived = derive({ problemDescription: prompts.isolation }, isoResult, false);
  results.push({
    name: "clean isolation",
    ...buildAnalysisTraceRecord({ input: { problemDescription: prompts.isolation }, result: isoResult }),
    mode: isoDerived.recommendedDebuggingMode,
    intent: isoDerived.currentSupervisedActionChainStep?.intent,
  });

  // 2. Duplicate Writer
  const dupResult = await analyze(prompts.duplicateWriter);
  const dupDerived = derive({ problemDescription: prompts.duplicateWriter }, dupResult, false);
  results.push({
    name: "duplicate-writer",
    ...buildAnalysisTraceRecord({ input: { problemDescription: prompts.duplicateWriter }, result: dupResult }),
    mode: dupDerived.recommendedDebuggingMode,
    intent: dupDerived.currentSupervisedActionChainStep?.intent,
  });

  // 3. Ownership/Reference
  const ownResult = await analyze(prompts.ownership);
  const ownDerived = derive({ problemDescription: prompts.ownership }, ownResult, false);
  results.push({
    name: "ownership/reference",
    ...buildAnalysisTraceRecord({ input: { problemDescription: prompts.ownership }, result: ownResult }),
    mode: ownDerived.recommendedDebuggingMode,
    intent: ownDerived.currentSupervisedActionChainStep?.intent,
  });

  // 4. Falsification Follow-up
  const falsifyPrompt = buildFollowUpProblemDescription(prompts.duplicateWriter, observations.falsifies, dupDerived.currentGuidedStep ?? undefined, dupDerived.currentGuidedStepNumber || undefined);
  const falsifyResultRaw = await analyze(falsifyPrompt);
  const falsifyVerification = classifyFollowUpResult({ originalResult: dupResult, nextResult: falsifyResultRaw, observation: observations.falsifies });
  const falsifyResult = { ...falsifyResultRaw, what_happened: buildFalsifiedDiagnosis({ originalResult: dupResult, nextResult: falsifyResultRaw, observation: observations.falsifies }), what_to_do_next: buildGuidedStepStack(buildNextStepGuidance({ verificationState: falsifyVerification, currentResult: falsifyResultRaw, observation: observations.falsifies, priorSteps: dupDerived.guidedStepStack }), dupDerived.guidedStepStack) };
  const falsifyActionState = dupDerived.supervisedActionChain ? { currentStepIndex: dupDerived.supervisedActionChainActiveStepIndex, totalSteps: dupDerived.supervisedActionChain.length, lastStepIntent: dupDerived.currentSupervisedActionChainStep?.intent, previousConfidenceLevel: dupDerived.confidenceLevel } : undefined;
  const falsifyDerived = derive({ problemDescription: prompts.duplicateWriter }, falsifyResult, true, observations.falsifies, falsifyVerification, falsifyActionState);
  results.push({
    name: "falsification",
    ...buildAnalysisTraceRecord({
      input: { problemDescription: prompts.duplicateWriter },
      result: falsifyResult,
      isRefined: true,
      lastObservation: observations.falsifies,
      verificationState: falsifyVerification,
      previousActionChainState: falsifyActionState,
    }),
    verification: falsifyVerification,
    mode: falsifyDerived.recommendedDebuggingMode,
    commitment: falsifyDerived.decisionCommitment,
  });

  // 5. Pending Commitment (Animator base -> Pending)
  const animResult = await analyze(prompts.animator);
  const animDerived = derive({ problemDescription: prompts.animator }, animResult, false);
  const pendingPrompt = buildFollowUpProblemDescription(prompts.animator, observations.pending, animDerived.currentGuidedStep ?? undefined, animDerived.currentGuidedStepNumber || undefined);
  const pendingResultRaw = await analyze(pendingPrompt);
  const pendingVerification = classifyFollowUpResult({ originalResult: animResult, nextResult: pendingResultRaw, observation: observations.pending });
  const pendingResult = { ...pendingResultRaw, what_to_do_next: buildGuidedStepStack(buildNextStepGuidance({ verificationState: pendingVerification, currentResult: pendingResultRaw, observation: observations.pending, priorSteps: animDerived.guidedStepStack }), animDerived.guidedStepStack) };
  const pendingActionState = animDerived.supervisedActionChain ? { currentStepIndex: animDerived.supervisedActionChainActiveStepIndex, totalSteps: animDerived.supervisedActionChain.length, lastStepIntent: animDerived.currentSupervisedActionChainStep?.intent, previousConfidenceLevel: animDerived.confidenceLevel } : undefined;
  const pendingDerived = derive({ problemDescription: prompts.animator }, pendingResult, true, observations.pending, pendingVerification, pendingActionState);
  results.push({
    name: "pending commitment",
    ...buildAnalysisTraceRecord({
      input: { problemDescription: prompts.animator },
      result: pendingResult,
      isRefined: true,
      lastObservation: observations.pending,
      verificationState: pendingVerification,
      previousActionChainState: pendingActionState,
    }),
    commitment: pendingDerived.decisionCommitment,
    trend: pendingDerived.confidenceAlignment,
  });

  // 6. Committed Confirmation
  if (pendingDerived.decisionCommitment === "pending" || pendingDerived.supervisedActionChain) {
    const committedPrompt = buildFollowUpProblemDescription(prompts.animator, observations.committed, pendingDerived.currentGuidedStep ?? undefined, pendingDerived.currentGuidedStepNumber || undefined);
    const committedResultRaw = await analyze(committedPrompt);
    const committedVerification = classifyFollowUpResult({ originalResult: pendingResult, nextResult: committedResultRaw, observation: observations.committed });
    const committedResult = { ...committedResultRaw, what_to_do_next: buildGuidedStepStack(buildNextStepGuidance({ verificationState: committedVerification, currentResult: committedResultRaw, observation: observations.committed, priorSteps: pendingDerived.guidedStepStack }), pendingDerived.guidedStepStack) };
    const committedActionState = pendingDerived.supervisedActionChain ? { currentStepIndex: pendingDerived.supervisedActionChainActiveStepIndex, totalSteps: pendingDerived.supervisedActionChain.length, lastStepIntent: pendingDerived.currentSupervisedActionChainStep?.intent, previousConfidenceLevel: pendingDerived.confidenceLevel, isCommitted: pendingDerived.decisionCommitment === "committed" || pendingDerived.decisionCommitment === "pending" } : undefined;
    const committedDerived = derive({ problemDescription: prompts.animator }, committedResult, true, observations.committed, committedVerification, committedActionState);
    results.push({
      name: "committed confirmation",
      ...buildAnalysisTraceRecord({
        input: { problemDescription: prompts.animator },
        result: committedResult,
        isRefined: true,
        lastObservation: observations.committed,
        verificationState: committedVerification,
        previousActionChainState: committedActionState,
      }),
      commitment: committedDerived.decisionCommitment,
      trend: committedDerived.confidenceAlignment,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

runProbe().catch(e => { console.error(e); process.exit(1); });
