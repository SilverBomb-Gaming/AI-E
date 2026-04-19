import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceExecutionSelfDirection,
  advanceExecutionOrchestration,
  buildExecutionOrchestrationContextBlock,
  createExecutionOrchestrationState,
  deriveNextExecutionOrchestrationPhase,
  initializeExecutionSelfDirection,
  recordExecutorOutcome,
  recordPlannerHandoff,
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

test("two-agent orchestration records planner to executor to planner completion", () => {
  const initial = createExecutionOrchestrationState({
    goal: "Restore CLI startup with an explicit planner and executor handoff.",
    currentPhase: "identify-blocker",
  });
  const planned = recordPlannerHandoff({
    state: initial,
    stepNumber: 1,
    diagnosis: "The startup blocker is a missing controller import on this branch.",
    proposedAction: "Add the narrowest compatibility fallback around the missing import.",
    expectedOutcome: "The CLI should reach the banner path again.",
    plannerDecision: "continue",
  });
  const executed = recordExecutorOutcome({
    state: planned.state,
    stepNumber: 1,
    executedAction: "Add the compatibility fallback and rerun the CLI.",
    actionResult: "The CLI starts and prints the expected banner output in both modes.",
    validationResult: "confirmed",
    executionNotes: "The bounded fix restored startup without widening the scope.",
  });
  const advanced = advanceExecutionOrchestration({
    state: executed.state,
    phase: executed.state.currentPhase,
    proposedAction: "Add the narrowest compatibility fallback around the missing import.",
    executedAction: "Add the compatibility fallback and rerun the CLI.",
    actionResult: "The CLI starts and prints the expected banner output in both modes.",
    verificationState: "confirmed",
    diagnosis: "The startup validation is complete.",
    loopTerminationStatus: "resolved",
    nextSafeAction: "",
    nextPhase: "complete",
  });
  const completed = recordPlannerHandoff({
    state: advanced.state,
    stepNumber: 1,
    diagnosis: "The executor result confirms the bounded goal is complete.",
    proposedAction: "Stop the orchestration.",
    expectedOutcome: "No further bounded step is required.",
    plannerDecision: "complete",
    handoffTo: null,
  });

  assert.equal(planned.state.currentAgent, "executor");
  assert.equal(executed.state.currentAgent, "planner");
  assert.equal(completed.state.currentStatus, "complete");
  assert.equal(completed.state.currentAgent, "planner");
  assert.equal(completed.state.agentHistory.length, 3);
  assert.equal(completed.state.agentHistory[0]?.agentRole, "planner");
  assert.equal(completed.state.agentHistory[1]?.agentRole, "executor");
  assert.equal(completed.state.agentHistory[2]?.plannerDecision, "complete");
});

test("two-agent orchestration lets the planner reroute after executor falsification", () => {
  const initial = createExecutionOrchestrationState({
    goal: "Recover from a wrong first bounded fix path.",
    currentPhase: "apply-fix",
  });
  const planned = recordPlannerHandoff({
    state: initial,
    stepNumber: 1,
    diagnosis: "The current import path looks like the leading blocker.",
    proposedAction: "Patch the import path directly.",
    expectedOutcome: "Startup should recover immediately.",
    plannerDecision: "continue",
  });
  const executed = recordExecutorOutcome({
    state: planned.state,
    stepNumber: 1,
    executedAction: "Patch the import path directly.",
    actionResult: "The module does not exist on this branch, so the original fix path fails.",
    validationResult: "falsified",
    executionNotes: "The executor disproved the original planner path.",
  });
  const advanced = advanceExecutionOrchestration({
    state: executed.state,
    phase: executed.state.currentPhase,
    proposedAction: "Patch the import path directly.",
    executedAction: "Patch the import path directly.",
    actionResult: "The module does not exist on this branch, so the original fix path fails.",
    verificationState: "falsified",
    diagnosis: "The planner must reroute to a compatibility fallback instead.",
    loopTerminationStatus: "converging",
    nextSafeAction: "Inspect the controller surface and add the narrowest fallback.",
    nextPhase: "recover",
  });
  const rerouted = recordPlannerHandoff({
    state: advanced.state,
    stepNumber: 2,
    diagnosis: "The executor falsified the original fix, so the bounded reroute is to add a compatibility fallback.",
    proposedAction: "Inspect the controller surface and add the narrowest fallback.",
    expectedOutcome: "Startup should recover without widening the scope.",
    plannerDecision: "reroute",
  });

  assert.equal(rerouted.state.currentStatus, "active");
  assert.equal(rerouted.state.currentAgent, "executor");
  assert.equal(rerouted.state.lastHandoff?.handoffFrom, "planner");
  assert.equal(rerouted.state.lastHandoff?.handoffTo, "executor");
  assert.equal(rerouted.state.agentHistory.at(-1)?.plannerDecision, "reroute");
});

test("two-agent orchestration records a blocked planner decision after executor results", () => {
  const initial = createExecutionOrchestrationState({
    goal: "Stop safely when no bounded next step remains.",
    currentPhase: "apply-fix",
  });
  const planned = recordPlannerHandoff({
    state: initial,
    stepNumber: 1,
    diagnosis: "The next bounded move is to patch the import path.",
    proposedAction: "Patch the import path.",
    expectedOutcome: "Startup should recover.",
    plannerDecision: "continue",
  });
  const executed = recordExecutorOutcome({
    state: planned.state,
    stepNumber: 1,
    executedAction: "Patch the import path.",
    actionResult: "No equivalent module exists in the repo, so no safe bounded follow-up remains.",
    validationResult: "falsified",
    executionNotes: "The executor reached a bounded dead end.",
  });
  const advanced = advanceExecutionOrchestration({
    state: executed.state,
    phase: executed.state.currentPhase,
    proposedAction: "Patch the import path.",
    executedAction: "Patch the import path.",
    actionResult: "No equivalent module exists in the repo, so no safe bounded follow-up remains.",
    verificationState: "falsified",
    diagnosis: "No safe bounded follow-up remains.",
    loopTerminationStatus: "stuck",
    nextSafeAction: "",
    nextPhase: "blocked",
  });
  const blocked = recordPlannerHandoff({
    state: advanced.state,
    stepNumber: 1,
    diagnosis: "The executor result leaves no safe bounded next action.",
    proposedAction: "Stop the orchestration.",
    expectedOutcome: "Preserve bounded behavior by blocking the thread.",
    plannerDecision: "block",
    handoffTo: null,
  });

  assert.equal(blocked.state.currentStatus, "blocked");
  assert.equal(blocked.state.currentAgent, "planner");
  assert.equal(blocked.state.lastHandoff?.handoffTo, null);
  assert.equal(blocked.state.agentHistory.at(-1)?.plannerDecision, "block");
});

test("self-direction initializes a bounded concrete subgoal queue", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup and confirm the banner output.",
    currentPhase: "identify-blocker",
  });

  const selfDirection = initializeExecutionSelfDirection({
    state: orchestration.selfDirectionState,
    currentPhase: orchestration.currentPhase,
    diagnosis: "The current blocker is a missing controller import on this branch.",
    proposedAction: "Add the narrowest compatibility fallback around the missing import.",
    expectedOutcome: "The CLI should reach the banner path again.",
  });

  assert.equal(selfDirection.selfDirectionStatus, "active");
  assert.equal(selfDirection.topLevelGoal, "Restore CLI startup and confirm the banner output.");
  assert.ok(selfDirection.currentSubgoal);
  assert.ok(selfDirection.currentSubgoal?.title.length);
  assert.ok(selfDirection.subgoalQueue.length >= 1);
  assert.ok(selfDirection.subgoalQueue.length <= 2);
});

test("self-direction inserts a recovery subgoal after a recoverable failure", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Recover CLI startup without widening the fix.",
    currentPhase: "apply-fix",
  });
  const initialized = initializeExecutionSelfDirection({
    state: orchestration.selfDirectionState,
    currentPhase: orchestration.currentPhase,
    diagnosis: "The leading bounded move is to patch the import path.",
    proposedAction: "Patch the import path directly.",
    expectedOutcome: "Startup should recover immediately.",
  });

  const rerouted = advanceExecutionSelfDirection({
    state: initialized,
    verificationState: "falsified",
    loopTerminationStatus: "converging",
    plannerDecision: "reroute",
    nextProposedAction: "Inspect the controller surface and add the narrowest compatibility fallback.",
    nextExpectedOutcome: "Startup should recover without widening the scope.",
    rerouteReason: "The original import path never existed on this branch.",
  });

  assert.equal(rerouted.selfDirectionStatus, "active");
  assert.equal(rerouted.abandonedSubgoals.length, 1);
  assert.ok(rerouted.currentSubgoal);
  assert.match(rerouted.currentSubgoal?.title ?? "", /compatibility fallback/i);
  assert.match(rerouted.lastRerouteReason, /never existed/i);
});

test("self-direction blocks when no safe next subgoal remains", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup without widening the scope.",
    currentPhase: "apply-fix",
  });
  const initialized = initializeExecutionSelfDirection({
    state: orchestration.selfDirectionState,
    currentPhase: orchestration.currentPhase,
    diagnosis: "The bounded next move is to patch the import path.",
    proposedAction: "Patch the import path.",
    expectedOutcome: "Startup should recover.",
  });

  const blocked = advanceExecutionSelfDirection({
    state: initialized,
    verificationState: "falsified",
    loopTerminationStatus: "stuck",
    plannerDecision: "block",
    blockReason: "No equivalent module exists in the repo, so no safe bounded next step remains.",
  });

  assert.equal(blocked.selfDirectionStatus, "blocked");
  assert.equal(blocked.blockedSubgoals.length, 1);
  assert.equal(blocked.currentSubgoal, null);
  assert.match(blocked.lastBlockReason, /no safe bounded next step/i);
});

test("self-direction stops early when the top-level goal is already satisfied", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Restore CLI startup and confirm the banner output.",
    currentPhase: "rerun-validation",
  });
  const initialized = initializeExecutionSelfDirection({
    state: orchestration.selfDirectionState,
    currentPhase: orchestration.currentPhase,
    diagnosis: "The only remaining move is to rerun validation.",
    proposedAction: "Rerun the CLI in both modes.",
    expectedOutcome: "The CLI should print the expected banner output in both modes.",
  });

  const completed = advanceExecutionSelfDirection({
    state: initialized,
    verificationState: "confirmed",
    loopTerminationStatus: "resolved",
    plannerDecision: "complete",
    stopReason: "The executor result already satisfies the approved top-level goal.",
  });

  assert.equal(completed.selfDirectionStatus, "complete");
  assert.equal(completed.currentSubgoal, null);
  assert.equal(completed.subgoalQueue.length, 0);
  assert.equal(completed.completedSubgoals.length, 1);
  assert.match(completed.lastStopReason, /approved top-level goal/i);
});

test("paused self-direction keeps planner ownership instead of handing off execution", () => {
  const orchestration = createExecutionOrchestrationState({
    goal: "Pause safely when confidence drops too low.",
    currentPhase: "decide-next-step",
  });
  const initialized = initializeExecutionSelfDirection({
    state: orchestration.selfDirectionState,
    currentPhase: orchestration.currentPhase,
    diagnosis: "The next bounded step still needs review.",
    proposedAction: "Rerun the bounded validation check.",
    expectedOutcome: "Confidence should recover only if the same signal repeats.",
  });
  const pausedSelfDirection = advanceExecutionSelfDirection({
    state: initialized,
    verificationState: "inconclusive",
    loopTerminationStatus: "converging",
    plannerDecision: "continue",
    nextProposedAction: "Rerun the bounded validation check.",
    confidenceLevel: "low",
    pauseReason: "Confidence fell too low to keep chaining the same self-directed run.",
  });
  const paused = recordPlannerHandoff({
    state: {
      ...orchestration,
      selfDirectionState: pausedSelfDirection,
    },
    stepNumber: 1,
    diagnosis: "The planner paused the self-directed queue because confidence dropped too low.",
    proposedAction: "Rerun the bounded validation check.",
    expectedOutcome: "Confidence should recover only if the same signal repeats.",
    plannerDecision: "continue",
    handoffTo: "executor",
  });

  assert.equal(paused.state.selfDirectionState.selfDirectionStatus, "paused");
  assert.equal(paused.state.currentAgent, "planner");
  assert.equal(paused.state.lastHandoff?.handoffTo, null);
});