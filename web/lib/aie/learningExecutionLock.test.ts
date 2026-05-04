import assert from "node:assert/strict";
import test from "node:test";

import {
  beginExecutionLock,
  isExecutionInProgress,
  releaseExecutionLock,
  resetExecutionLockForTests,
} from "./learningExecutionLock";

test.afterEach(() => {
  resetExecutionLockForTests();
});

test("default state is not in progress", () => {
  assert.deepEqual(isExecutionInProgress(), {
    execution_in_progress: false,
    conflict_detected: false,
  });
});

test("beginExecutionLock sets in-progress", () => {
  const status = beginExecutionLock();

  assert.deepEqual(status, {
    execution_in_progress: true,
    conflict_detected: false,
  });
  assert.equal(isExecutionInProgress().execution_in_progress, true);
});

test("releaseExecutionLock clears in-progress", () => {
  beginExecutionLock();
  const status = releaseExecutionLock();

  assert.deepEqual(status, {
    execution_in_progress: false,
    conflict_detected: false,
  });
});

test("second begin detects conflict", () => {
  beginExecutionLock();
  const status = beginExecutionLock();

  assert.deepEqual(status, {
    execution_in_progress: true,
    conflict_detected: true,
  });
});

test("reset clears lock for tests", () => {
  beginExecutionLock();
  const status = resetExecutionLockForTests();

  assert.deepEqual(status, {
    execution_in_progress: false,
    conflict_detected: false,
  });
});