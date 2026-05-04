import type { AutonomyPolicy } from "./autonomyPolicy";
import { simulateAutonomousRun, type AutonomySimulationResult } from "./autonomySimulation";
import type { LearningApplicationQueueExecutionResult, LearningApplicationQueueRecord } from "./learningApplicationQueue";
import { confirmAndExecute, proposeNextQueueExecution } from "./learningQueueExecutionProposal";

export const AUTONOMOUS_EXECUTION_SAFETY_STACK = [
  "policy",
  "simulation",
  "proposal",
  "snapshot",
  "cooldown",
  "conflict_lock",
  "gate",
  "drift_guard",
] as const;

export type AutonomousExecutionResult = {
  simulated: true;
  executed: boolean;
  queue_id?: string;
  reason?: string;
  policy_snapshot: AutonomyPolicy;
  simulation: AutonomySimulationResult;
  execution_result?: LearningApplicationQueueExecutionResult;
  single_item_execution: true;
  safety_stack_used: typeof AUTONOMOUS_EXECUTION_SAFETY_STACK;
  execution_triggered: boolean;
  autonomy_triggered: boolean;
};

export async function runAutonomousStep(
  queueItems: readonly LearningApplicationQueueRecord[],
  policy: AutonomyPolicy,
  options?: Parameters<typeof confirmAndExecute>[1],
): Promise<AutonomousExecutionResult> {
  const simulation = simulateAutonomousRun(queueItems, policy);

  if (!policy.autonomy_enabled) {
    return {
      simulated: true,
      executed: false,
      reason: "autonomy disabled",
      policy_snapshot: { ...policy, allowed_actions: [...policy.allowed_actions] },
      simulation,
      single_item_execution: true,
      safety_stack_used: AUTONOMOUS_EXECUTION_SAFETY_STACK,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const queueId = simulation.executable_items[0];

  if (!queueId) {
    return {
      simulated: true,
      executed: false,
      reason: simulation.reasons[0] ?? "no executable autonomous item",
      policy_snapshot: { ...policy, allowed_actions: [...policy.allowed_actions] },
      simulation,
      single_item_execution: true,
      safety_stack_used: AUTONOMOUS_EXECUTION_SAFETY_STACK,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const proposal = proposeNextQueueExecution(queueItems);

  if (proposal.next_queue_id !== queueId) {
    return {
      simulated: true,
      executed: false,
      queue_id: queueId,
      reason: "simulation and proposal selection mismatch",
      policy_snapshot: { ...policy, allowed_actions: [...policy.allowed_actions] },
      simulation,
      single_item_execution: true,
      safety_stack_used: AUTONOMOUS_EXECUTION_SAFETY_STACK,
      execution_triggered: false,
      autonomy_triggered: false,
    };
  }

  const executionResult = await confirmAndExecute(queueId, options);

  return {
    simulated: true,
    executed: executionResult.applied,
    queue_id: queueId,
    reason: executionResult.applied ? undefined : executionResult.reason,
    policy_snapshot: { ...policy, allowed_actions: [...policy.allowed_actions] },
    simulation,
    execution_result: executionResult,
    single_item_execution: true,
    safety_stack_used: AUTONOMOUS_EXECUTION_SAFETY_STACK,
    execution_triggered: executionResult.applied,
    autonomy_triggered: executionResult.applied,
  };
}