import {
  executeWithAdapter,
  getExecutableActionType,
  isExecutableAction,
  selectExecutionAdapter,
  type ExecutionAdapterContext,
} from "./executionAdapters";
import type { ExecutionActionPreview, ExecutionRuntimeResult } from "./types";

export async function executeAction(
  action: ExecutionActionPreview,
  context: ExecutionAdapterContext = {},
): Promise<ExecutionRuntimeResult> {
  const execution = await executeWithAdapter(action, context);
  return execution.result;
}

export { getExecutableActionType, isExecutableAction, selectExecutionAdapter };
export type { ExecutionAdapterContext };