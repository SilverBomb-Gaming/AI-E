import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  approveCinematicGenerationJobs,
  buildCinematicSubmissionPackage,
  compareCinematicProviderReadiness,
  ensureCinematicProductionMemoryInitialized,
  evaluateCinematicApprovalEscalation,
  exportCinematicRealProviderPayloads,
  planCinematicGenerationJobs,
  planCinematicSequence,
  previewCinematicRealProviderDryRun,
  readCinematicProductionMemory,
} from "./cinematicProductionMemory";

test("real-provider dry-run bridge serializes payloads, simulates provider constraints, and builds manual submission packages deterministically", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "aie-real-provider-dry-run-"));

  try {
    await ensureCinematicProductionMemoryInitialized(tempRoot);
    const sequence = await planCinematicSequence({
      root: tempRoot,
      sequenceId: "sequence-real-provider-dry-run-001",
      title: "Real Provider Dry Run Sequence",
    });
    const planned = await planCinematicGenerationJobs({
      root: tempRoot,
      sequenceId: sequence.sequence.sequence_id,
      routingMode: "premium-cinematic-provider",
    });
    const approval = await approveCinematicGenerationJobs({
      root: tempRoot,
      operatorId: "operator-dry-run-001",
      jobIds: planned.jobs.map((entry) => entry.job_id),
    });

    const payloadExports = await exportCinematicRealProviderPayloads({
      root: tempRoot,
      jobIds: planned.jobs.slice(0, 2).map((entry) => entry.job_id),
      provider: "Sora",
      targetDurationSeconds: 10,
      targetResolution: "1080p",
      targetFrameRate: 24,
    });

    assert.equal(payloadExports.length, 2);
    assert.match(payloadExports[0]!.provider_ready_json, /"prompt"/);
    assert.ok(payloadExports[0]!.normalized_prompt.length > 0);
    assert.ok(payloadExports[0]!.continuity_references.length > 0);
    assert.ok(payloadExports[0]!.shot_references.length > 0);
    assert.ok(payloadExports[0]!.retry_metadata.some((entry) => /retry_recommendation=/i.test(entry)));

    const dryRun = await previewCinematicRealProviderDryRun({
      root: tempRoot,
      operatorId: "operator-dry-run-001",
      jobIds: planned.jobs.slice(0, 2).map((entry) => entry.job_id),
      provider: "Sora",
      approvalTokenId: approval.token?.token_id,
      targetDurationSeconds: 10,
      targetResolution: "1080p",
      targetFrameRate: 24,
    });

    assert.equal(dryRun.preview.provider_acceptance, true);
    assert.ok(dryRun.preview.estimated_total_queue_minutes > 0);
    assert.ok(dryRun.preview.estimated_total_cost_impact > 0);
    assert.ok(dryRun.preview.constraint_results.every((entry) => entry.provider_response === "accepted-dry-run"));
    assert.ok(dryRun.preview.retry_routing_summary.every((entry) => /retry/i.test(entry)));
    assert.ok(dryRun.audit_entries.length === 1);

    const constrainedDryRun = await previewCinematicRealProviderDryRun({
      root: tempRoot,
      jobIds: [planned.jobs[0]!.job_id],
      provider: "Seedance",
      targetDurationSeconds: 7,
      targetResolution: "1080p",
      targetFrameRate: 30,
      persist: false,
    });

    assert.equal(constrainedDryRun.preview.provider_acceptance, false);
    assert.ok(constrainedDryRun.preview.constraint_results.some((entry) => entry.issues.some((issue) => /Seedance dry-run rejects 1080p at 30fps/i.test(issue.detail))));

    const escalation = await evaluateCinematicApprovalEscalation({
      root: tempRoot,
      jobIds: planned.jobs.map((entry) => entry.job_id),
      provider: "Sora",
    });

    assert.equal(escalation.requires_additional_approval, true);
    assert.ok(escalation.reasons.some((entry) => entry.code === "premium-provider"));
    assert.ok(escalation.reasons.some((entry) => entry.code === "large-batch"));

    const comparison = await compareCinematicProviderReadiness({
      root: tempRoot,
      jobIds: planned.jobs.slice(0, 2).map((entry) => entry.job_id),
      targetDurationSeconds: 8,
      targetResolution: "1080p",
      targetFrameRate: 24,
    });

    assert.equal(comparison[0]!.provider, "LocalFutureProvider");
    assert.ok(comparison.some((entry) => entry.provider === "Sora" && entry.valid));
    assert.ok(comparison.some((entry) => entry.provider === "Seedance"));

    const submissionPackage = await buildCinematicSubmissionPackage({
      root: tempRoot,
      operatorId: "operator-dry-run-001",
      jobIds: planned.jobs.slice(0, 2).map((entry) => entry.job_id),
      provider: "Sora",
      approvalTokenId: approval.token?.token_id,
    });

    assert.equal(submissionPackage.submission_package.provider, "Sora");
    assert.equal(submissionPackage.submission_package.sequence_package.job_ids.length, 2);
    assert.equal(submissionPackage.submission_package.shot_package.length, 2);
    assert.equal(submissionPackage.submission_package.provider_package.payload_exports.length, 2);
    assert.equal(submissionPackage.submission_package.execution_manifest.manual_execution_only, true);
    assert.equal(submissionPackage.submission_package.operator_approval_manifest.approval_token_valid, true);
    assert.ok(submissionPackage.submission_package.audit_references.length >= 1);
    assert.match(submissionPackage.submission_package.package_json, /"manual_execution_only": true/);

    const record = await readCinematicProductionMemory({ root: tempRoot });
    const recentAuditActions = record.approval_audit_trail.slice(-2).map((entry) => entry.action);
    const recentIndices = record.approval_audit_trail.slice(-2).map((entry) => entry.append_only_index);

    assert.deepEqual(recentAuditActions, ["preview-real-provider-dry-run", "export-submission-package"]);
    assert.equal(recentIndices[1], recentIndices[0]! + 1);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});