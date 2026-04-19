import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceExecutionOrchestration,
  buildExecutionOrchestrationContextBlock,
  createExecutionOrchestrationState,
  deriveNextExecutionOrchestrationPhase,
} from "./orchestrationSession";

test("orchestration completes a successful bounded multi-step path", () => {
  const firstState = createExecutionOrchestrationState({
    goal: "Restore CLI startup and confirm the startup banner in both modes.",
    currentPhase: "identify-blocker",
  });
  const first = advanceExecutionOrchestration({
    state: firstState,
    phase: firstState.currentPhase,
    proposedAction: "Identify the startup blocker.",
    executedAction: "Inspect the missing import that blocks CLI startup.",
    actionResult: "The CLI fails before startup because a controller import is missing.",
    verificationState: "confirmed",
    diagnosis: "The missing controller import is the active blocker.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Apply the smallest import compatibility fix.",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: firstState.currentPhase,
      verificationState: "confirmed",
      loopTerminationStatus: "converging",
      nextSafeAction: "Apply the smallest import compatibility fix.",
    }),
  });
  const second = advanceExecutionOrchestration({
    state: first.state,
    phase: first.state.currentPhase,
    proposedAction: "Apply the smallest import compatibility fix.",
    executedAction: "Guard the missing controller imports with bounded fallbacks.",
    actionResult: "The import blocker is removed and CLI startup can run again.",
    verificationState: "confirmed",
    diagnosis: "Startup can now reach the CLI banner path.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Rerun the original CLI startup validation.",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: first.state.currentPhase,
      verificationState: "confirmed",
      loopTerminationStatus: "converging",
      nextSafeAction: "Rerun the original CLI startup validation.",
    }),
  });
  const third = advanceExecutionOrchestration({
    state: second.state,
    phase: second.state.currentPhase,
    proposedAction: "Rerun the original CLI startup validation.",
    executedAction: "Run the CLI in default and --debug modes and compare startup output.",
    actionResult: 'The CLI prints "Debug routing disabled." by default and "Debug routing enabled." with --debug.',
    verificationState: "confirmed",
    diagnosis: "The startup banner validation is complete on the real runtime path.",
    loopTerminationStatus: "resolved",
    nextSafeAction: "",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: second.state.currentPhase,
      verificationState: "confirmed",
      loopTerminationStatus: "resolved",
      nextSafeAction: "",
    }),
  });

  assert.equal(third.state.currentStatus, "complete");
  assert.equal(third.state.currentPhase, "complete");
  assert.equal(third.state.completedSteps.length, 3);
  assert.equal(third.state.blockedSteps.length, 0);
  assert.match(buildExecutionOrchestrationContextBlock({ orchestration: third.state }), /Status: complete/i);
});

test("orchestration records a recoverable failure and continues safely", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup with a bounded recovery chain.",
    currentPhase: "apply-fix",
  });
  const failed = advanceExecutionOrchestration({
    state: orchestration,
    phase: orchestration.currentPhase,
    proposedAction: "Apply the smallest import fix.",
    executedAction: "Patch the missing import path.",
    actionResult: "The patch fails because the missing module never existed on this branch.",
    verificationState: "falsified",
    diagnosis: "The original fix path was wrong because the module is absent rather than misnamed.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Inspect the controller import surface and add the narrowest compatible fallback.",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: orchestration.currentPhase,
      verificationState: "falsified",
      loopTerminationStatus: "converging",
      nextSafeAction: "Inspect the controller import surface and add the narrowest compatible fallback.",
    }),
  });
  const recovered = advanceExecutionOrchestration({
    state: failed.state,
    phase: failed.state.currentPhase,
    proposedAction: "Inspect the controller import surface and add the narrowest compatible fallback.",
    executedAction: "Add a bounded compatibility fallback and rerun startup.",
    actionResult: "The CLI now starts and reaches the banner path again.",
    verificationState: "confirmed",
    diagnosis: "The fallback restored the startup path without widening the scope.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Rerun the original validation.",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: failed.state.currentPhase,
      verificationState: "confirmed",
      loopTerminationStatus: "converging",
      nextSafeAction: "Rerun the original validation.",
    }),
  });

  assert.equal(failed.state.currentStatus, "active");
  assert.equal(failed.state.currentPhase, "recover");
  assert.equal(failed.state.blockedSteps.length, 1);
  assert.equal(recovered.state.currentStatus, "active");
  assert.equal(recovered.state.completedSteps.length, 1);
  assert.equal(recovered.state.blockedSteps.length, 1);
});

test("orchestration blocks when no safe next step remains", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup without widening the fix.",
    currentPhase: "apply-fix",
  });
  const blocked = advanceExecutionOrchestration({
    state: orchestration,
    phase: orchestration.currentPhase,
    proposedAction: "Apply a bounded import fix.",
    executedAction: "Patch the import path.",
    actionResult: "The import path is missing and no equivalent module exists in the repo.",
    verificationState: "falsified",
    diagnosis: "No safe follow-up exists within the current bounded scope.",
    loopTerminationStatus: "stuck",
    nextSafeAction: "",
    nextPhase: deriveNextExecutionOrchestrationPhase({
      currentPhase: orchestration.currentPhase,
      verificationState: "falsified",
      loopTerminationStatus: "stuck",
      nextSafeAction: "",
    }),
  });

  assert.equal(blocked.state.currentStatus, "blocked");
  assert.equal(blocked.state.currentPhase, "blocked");
  assert.equal(blocked.state.blockedSteps.length, 1);
  assert.match(buildExecutionOrchestrationContextBlock({ orchestration: blocked.state }), /Blocked orchestration steps/i);
});

test("orchestration blocks at the configured autonomous step limit", () => {
  let orchestration = createExecutionOrchestrationState({
    goal: "Carry a bounded goal without drifting indefinitely.",
    currentPhase: "identify-blocker",
    maxAutonomousSteps: 3,
  });

  for (const [index, phase] of (["identify-blocker", "apply-fix"] as const).entries()) {
    orchestration = advanceExecutionOrchestration({
      state: orchestration,
      phase,
      proposedAction: `Execute bounded step ${index + 1}.`,
      executedAction: `Run bounded step ${index + 1}.`,
      actionResult: `Step ${index + 1} produced more signal but the goal still needs another safe move.`,
      verificationState: "inconclusive",
      diagnosis: `Step ${index + 1} narrowed the issue without resolving it.`,
      loopTerminationStatus: "converging",
      nextSafeAction: `Execute bounded step ${index + 2}.`,
      nextPhase: index === 0 ? "apply-fix" : "rerun-validation",
    }).state;
  }

  const blocked = advanceExecutionOrchestration({
    state: orchestration,
    phase: orchestration.currentPhase,
    proposedAction: "Execute bounded step 3.",
    executedAction: "Run bounded step 3.",
    actionResult: "The goal still needs another step, but the bounded limit is reached.",
    verificationState: "inconclusive",
    diagnosis: "The orchestration should stop instead of proposing an unbounded fourth step.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Execute bounded step 4.",
    nextPhase: "decide-next-step",
  });

  assert.equal(blocked.state.currentStatus, "blocked");
  assert.equal(blocked.state.blockedSteps.length, 1);
  assert.equal(blocked.state.completedSteps.length, 2);
});