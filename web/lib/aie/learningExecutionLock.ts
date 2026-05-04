export type LearningExecutionLockStatus = {
  execution_in_progress: boolean;
  conflict_detected: boolean;
};

let executionInProgress = false;

export function isExecutionInProgress(): LearningExecutionLockStatus {
  return {
    execution_in_progress: executionInProgress,
    conflict_detected: executionInProgress,
  };
}

export function beginExecutionLock(): LearningExecutionLockStatus {
  if (executionInProgress) {
    return {
      execution_in_progress: true,
      conflict_detected: true,
    };
  }

  executionInProgress = true;
  return {
    execution_in_progress: true,
    conflict_detected: false,
  };
}

export function releaseExecutionLock(): LearningExecutionLockStatus {
  executionInProgress = false;
  return {
    execution_in_progress: false,
    conflict_detected: false,
  };
}

export function resetExecutionLockForTests(): LearningExecutionLockStatus {
  executionInProgress = false;
  return {
    execution_in_progress: false,
    conflict_detected: false,
  };
}