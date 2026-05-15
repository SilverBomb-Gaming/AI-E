import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function runVerbose() {
  const logicModule = await import(pathToFileURL(resolve(process.cwd(), "components/analysisResultLogic.ts")).href);
  const { deriveAnalysisResultSignals, getRecommendedDebuggingMode, classifyFollowUpResult, buildNextStepGuidance, buildGuidedStepStack } = logicModule;

  const animPrompt = "Player movement breaks after changing the Animator speed sync. The bad transition happens right when the Animator resume handoff runs, and the symptom seems tied to that handoff rather than the rest of movement.";
  const pendingObservation = "Disabling the Animator speed sync now cleanly tracks the symptom to the same handoff, and restoring it brings the bad transition back.";

  const animRes = await fetch("http://localhost:3000/api/analyze", {
     method: "POST", headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ problemDescription: animPrompt })
  }).then(r => r.json());
  
  const animDerived = deriveAnalysisResultSignals({ result: animRes, problemDescription: animPrompt, isRefined: false });
  
  const pendingRes = await fetch("http://localhost:3000/api/analyze", {
     method: "POST", headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ problemDescription: "Observation: " + pendingObservation })
  }).then(r => r.json());

  const pendingVerification = classifyFollowUpResult({ originalResult: animRes, nextResult: pendingRes, observation: pendingObservation });
  const pendingNextStep = buildNextStepGuidance({ verificationState: pendingVerification, currentResult: pendingRes, observation: pendingObservation, priorSteps: animDerived.guidedStepStack });
  const pendingNextStack = buildGuidedStepStack(pendingNextStep, animDerived.guidedStepStack);
  const pendingWithGuidance = { ...pendingRes, what_to_do_next: pendingNextStack };

  const prevActionState = animDerived.supervisedActionChain ? {
     currentStepIndex: animDerived.supervisedActionChainActiveStepIndex, 
     totalSteps: animDerived.supervisedActionChain.length,
     lastStepIntent: animDerived.currentSupervisedActionChainStep?.intent,
     previousConfidenceLevel: animDerived.confidenceLevel
  } : undefined;

  const pendingDerived = deriveAnalysisResultSignals({
     result: pendingWithGuidance, problemDescription: animPrompt, isRefined: true, 
     lastObservation: pendingObservation, verificationState: pendingVerification,
     previousActionChainState: prevActionState
  });

  console.log(JSON.stringify({
    animConfidence: animDerived.confidenceLevel,
    pendingVerification,
    pendingConfidence: pendingDerived.confidenceLevel,
    alignedSignalCount: pendingDerived.alignedSignalCount,
    commitment: pendingDerived.decisionCommitment
  }, null, 2));
}
runVerbose().catch(e => { console.error(e); process.exit(1); });
