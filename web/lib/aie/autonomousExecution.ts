import type { AutonomyPolicy } from "./autonomyPolicy";
import { simulateAutonomousRun, type AutonomySimulationResult } from "./autonomySimulation";
import type { LearningApplicationQueueExecutionResult, LearningApplicationQueueRecord } from "./learningApplicationQueue";
import { confirmAndExecute, proposeNextQueueExecution } from "./learningQueueExecutionProposal";

export type AutonomousExecutionResult = {
  simulated: true;
  executed: boolean;
  queue_id?: string;
  reason?: string;
  simulation: AutonomySimulationResult;
  execution_result?: LearningApplicationQueueExecutionResult;
  single_item_execution: true;
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
      simulation,
      single_item_execution: true,
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
      simulation,
      single_item_execution: true,
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
      simulation,
      single_item_execution: true,
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
    simulation,
    execution_result: executionResult,
    single_item_execution: true,
    execution_triggered: executionResult.applied,
    autonomy_triggered: executionResult.applied,
  };
}