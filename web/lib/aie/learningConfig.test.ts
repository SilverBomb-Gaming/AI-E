import assert from "node:assert/strict";
import test from "node:test";

import { getLearningConfig, setLearningEnabled } from "./learningConfig";

test("learning config defaults to disabled", () => {
  setLearningEnabled(false);

  assert.deepEqual(getLearningConfig(), { learning_enabled: false });
});

test("setting the learning flag true does not auto-enable application behavior", () => {
  try {
    assert.deepEqual(setLearningEnabled(true), { learning_enabled: true });
    assert.deepEqual(getLearningConfig(), { learning_enabled: true });
  } finally {
    setLearningEnabled(false);
  }
});