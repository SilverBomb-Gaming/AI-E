import assert from "node:assert/strict";
import test from "node:test";

import { GOVERNED_OPERATION_LANE_VERSION } from "@/lib/aie/governedOperationLane";
import { createSeededGovernedOperationsDashboardViewModel } from "./governedOperationsDashboardModel";

test("createSeededGovernedOperationsDashboardViewModel returns a valid seeded view model", () => {
  const vm = createSeededGovernedOperationsDashboardViewModel();

  assert.equal(vm.allExecutionBlocked, true);
  assert.equal(vm.allDryRun, true);
  assert.equal(vm.totalLanes, 3);
  assert.equal(vm.lanes.length, 3);
  assert.equal(vm.summary.snapshotVersion, GOVERNED_OPERATION_LANE_VERSION);
  assert.equal(vm.summary.allLanesExecutionAllowed, false);
  assert.equal(vm.summary.allLanesDryRun, true);
  assert.equal(typeof vm.queueId, "string");
  assert.match(vm.governanceNote, /SEEDED DEMO STATE/i);
});

test("createSeededGovernedOperationsDashboardViewModel lanes are all execution-blocked and dry-run", () => {
  const vm = createSeededGovernedOperationsDashboardViewModel();

  for (const lane of vm.lanes) {
    assert.equal(lane.executionAllowed, false);
    assert.equal(lane.dryRun, true);
    assert.ok(lane.safetyBadges.includes("execution-blocked"), `Lane ${lane.laneId} missing execution-blocked badge`);
    assert.ok(lane.safetyBadges.includes("dry-run-enforced"), `Lane ${lane.laneId} missing dry-run-enforced badge`);
    assert.ok(lane.safetyBadges.includes("human-authority"), `Lane ${lane.laneId} missing human-authority badge`);
  }
});

test("createSeededGovernedOperationsDashboardViewModel summary counts match lane states", () => {
  const vm = createSeededGovernedOperationsDashboardViewModel();

  assert.equal(vm.summary.pendingApprovalCount, 1);
  assert.equal(vm.summary.blockedCount, 1);
  assert.equal(vm.summary.deniedCount, 0);
  assert.equal(vm.summary.completedCount, 0);
  assert.equal(vm.summary.totalLanes, 3);
  assert.equal(vm.summary.laneStateCounts.length, 3);
});

test("createSeededGovernedOperationsDashboardViewModel lane states represent realistic governance lifecycle", () => {
  const vm = createSeededGovernedOperationsDashboardViewModel();

  const approvalPendingLane = vm.lanes.find((l) => l.laneState.label === "Approval Pending");
  const readyLane = vm.lanes.find((l) => l.laneState.label === "Ready");
  const blockedLane = vm.lanes.find((l) => l.laneState.label === "Blocked");

  assert.ok(approvalPendingLane, "Expected a lane in approval_pending state");
  assert.ok(readyLane, "Expected a lane in ready state");
  assert.ok(blockedLane, "Expected a lane in blocked state");

  assert.equal(approvalPendingLane?.approvalState.label, "Pending");
  assert.equal(readyLane?.approvalState.label, "Approved");
  assert.equal(blockedLane?.unresolvedDependencyCount, 1);
});
