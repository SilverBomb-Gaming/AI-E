import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundRunHistory } from "./backgroundRunHistory";
import { createBackgroundSessionQueue } from "./backgroundSessionQueue";
import {
  DEFAULT_RUNTIME_PROFILE_NAME,
  getRuntimeProfile,
  listRuntimeProfiles,
  resolveRuntimeProfile,
  summarizeRuntimeProfile,
  validateRuntimeProfile,
} from "./runtimeProfiles";
import { loadRuntimeEntrypointConfig } from "./runtimeEntrypoint";

test("lists available profiles", () => {
  const profiles = listRuntimeProfiles();

  assert.deepEqual(
    profiles.map((profile) => profile.profile_name),
    ["dry_run", "local_supervised", "operator_away_safe", "conservative_validation", "bounded_batch"],
  );
});

test("default profile is safe", () => {
  const profile = getRuntimeProfile(DEFAULT_RUNTIME_PROFILE_NAME);

  assert.equal(profile.profile_name, "local_supervised");
  assert.equal(profile.require_fresh_approvals, true);
  assert.equal(profile.require_fresh_context, true);
  assert.equal(profile.stop_on_blocker, true);
  assert.equal(profile.stop_on_error, true);
});

test("dry_run profile enables dry-run mode", () => {
  const profile = getRuntimeProfile("dry_run");

  assert.equal(profile.dry_run_mode, true);
  assert.equal(profile.operator_away_mode, false);
});

test("operator_away_safe preserves approvals and freshness", () => {
  const profile = getRuntimeProfile("operator_away_safe");

  assert.equal(profile.operator_away_mode, true);
  assert.equal(profile.require_fresh_approvals, true);
  assert.equal(profile.require_fresh_context, true);
});

test("rejects unknown profile", () => {
  assert.throws(() => getRuntimeProfile("missing_profile"), /Unknown runtime profile/);
});

test("rejects unbounded config", () => {
  assert.throws(
    () => validateRuntimeProfile({
      ...getRuntimeProfile("local_supervised"),
      max_ticks_per_run: Number.POSITIVE_INFINITY,
    }),
    /max_ticks_per_run/,
  );
  assert.throws(
    () => validateRuntimeProfile({
      ...getRuntimeProfile("local_supervised"),
      require_fresh_approvals: false,
    }),
    /require_fresh_approvals/,
  );
});

test("applies safe overrides", () => {
  const profile = resolveRuntimeProfile("bounded_batch", {
    max_ticks_per_run: 5,
    tick_interval_ms: 120_000,
  });

  assert.equal(profile.max_ticks_per_run, 5);
  assert.equal(profile.tick_interval_ms, 120_000);
  assert.equal(profile.require_fresh_context, true);
});

test("blocks unsafe overrides", () => {
  assert.throws(
    () => resolveRuntimeProfile("local_supervised", { require_fresh_context: false }),
    /require_fresh_context/,
  );
  assert.throws(
    () => resolveRuntimeProfile("local_supervised", { stop_on_blocker: false }),
    /stop_on_blocker/,
  );
});

test("integrates with runtime entrypoint", () => {
  const config = loadRuntimeEntrypointConfig({
    profile_name: "operator_away_safe",
    started_at: "2026-04-25T10:00:00.000Z",
  });

  assert.equal(config.profile_name, "operator_away_safe");
  assert.equal(config.operator_away_mode, true);
  assert.equal(config.require_fresh_approvals, true);
  assert.equal(config.stop_on_blocker, true);
});

test("summary is readable", () => {
  const summary = summarizeRuntimeProfile(getRuntimeProfile("dry_run"));

  assert.match(summary, /Runtime profile:/);
  assert.match(summary, /Profile description:/);
  assert.match(summary, /Dry run mode:/);
});