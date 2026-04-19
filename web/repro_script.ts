import { deriveAnalysisResultSignals } from './components/analysisResultLogic';
import { shapeFreeAnalysisResponse } from './lib/aie/run-analysis';

// Duplicate-Writer Repeated-Confirmation Repro
const signals = deriveAnalysisResultSignals({
  isRefined: true,
  verificationState: "inconclusive",
  lastObservation:
    "Disabling the cutscene zoom script consistently removes the jitter, and re-enabling it consistently brings the jitter back. This strongly suggests the cutscene zoom writer is part of the duplicate-writer conflict.",
  previousActionChainState: {
    currentStepIndex: 1,
    totalSteps: 3,
    lastStepIntent: "duplicate-writer",
    lastStepVerification: "inconclusive",
    lastStepWatchFor:
      "Watch for the bad state to track the same cutscene zoom writer overwrite path instead of drifting to a different writer.",
    previousConfidenceLevel: "high",
    confidenceHistory: ["medium", "high"],
  },
  problemDescription:
    "Camera motion jitters during the cutscene transition because the cutscene zoom script and another camera zoom path are both writing the same zoom value during the same state change.",
  result: {
    what_happened:
      "The cutscene zoom writer continues to reproduce the same confirmed behavior under repeated validation. The same overwrite path keeps matching the expected duplicate-writer conflict.",
    what_matters: ["Test"],
    what_to_do_next: [
      "Temporarily disable cutscene zoom writer and compare whether the same jitter changes immediately before and after.",
    ],
    upgrade_hint: "",
  },
});

console.log('--- Duplicate-Writer Repeated-Confirmation Repro ---');
console.log('confidenceLevel:', signals.confidenceLevel);
console.log('loopTerminationStatus:', signals.loopTerminationStatus);
console.log('suggestedNextAction:', signals.suggestedNextAction);
console.log('recommendedDebuggingMode:', signals.recommendedDebuggingMode);
console.log('decisionCommitment:', signals.decisionCommitment);
console.log('supervisedActionChainStepIndicator:', signals.supervisedActionChainStepIndicator);
console.log('currentSupervisedActionChainStep?.intent:', signals.currentSupervisedActionChainStep?.intent);
console.log('suggestedEscalationStrategy:', signals.suggestedEscalationStrategy);
console.log('nextStepGuidance:', signals.nextStepGuidance);

// Cutscene Zoom Repro
const shaped = shapeFreeAnalysisResponse({
  input: {
    problemDescription: "Camera motion jitters during the cutscene transition because the cutscene zoom script and another camera zoom path are both writing the same zoom value during the same state change.",
    actionResult: "Disabling the cutscene zoom script consistently removes the jitter, and re-enabling it consistently brings the jitter back. This strongly suggests the cutscene zoom writer is part of the duplicate-writer conflict.",
  },
  response: {
    what_happened: "The camera zoom path is still the most likely cause.",
    what_matters: ["test"],
    what_to_do_next: ["test"],
    upgrade_hint: "",
  },
});

console.log('\n--- Cutscene Zoom Repro ---');
console.log('shaped.what_to_do_next[0]:', shaped.what_to_do_next[0]);
