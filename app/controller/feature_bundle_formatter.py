"""Operator-facing formatting for bounded multi-file feature bundles."""
from __future__ import annotations

from .autonomous_dev_models import AutonomousDevChainRecord
from .feature_bundle_models import FeatureBundlePrPlan, FeatureBundleRecord


class FeatureBundleFormatter:
    def format_proposal(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "[FEATURE BUNDLE]",
            f"Bundle: {bundle.bundle_id} proposed",
            f"Feature: {bundle.feature_title}",
            f"Outcome: {bundle.intended_outcome}",
        ]
        self._append_coding_plan(lines, bundle)
        lines.append("Files:")
        for item in bundle.files:
            mode = "edit" if item.editable else "context"
            lines.append(f"- {item.relative_path} [{mode}, {item.scope_confidence:.2f}]")
            lines.append(f"  Reason: {item.inclusion_reason}")
            lines.append(f"  Change: {item.change_summary}")
        if bundle.assumptions:
            lines.append("Assumptions:")
            for assumption in bundle.assumptions:
                lines.append(f"- {assumption}")
        if bundle.risk_notes:
            lines.append("Risks:")
            for risk in bundle.risk_notes:
                lines.append(f"- {risk}")
        if bundle.validation_plan is not None:
            lines.append("Validation:")
            lines.append(f"- {bundle.validation_plan.command_text}")
            lines.append(f"  Why: {bundle.validation_plan.rationale}")
        lines.append("Status:")
        lines.append("- bundle prepared")
        lines.append("- approval required before apply")
        lines.append("Next: Use /featurestatus to inspect or /featureapply to request grouped apply approval.")
        return "\n".join(lines)

    def format_status(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "[FEATURE BUNDLE]",
            f"Bundle: {bundle.bundle_id} {bundle.state}",
            f"Feature: {bundle.feature_title}",
            f"Validation: {bundle.validation_state}",
        ]
        if bundle.apply_summary:
            lines.append(f"Apply: {bundle.apply_summary}")
        if bundle.validation_summary:
            lines.append(f"Validation summary: {bundle.validation_summary}")
        self._append_coding_plan(lines, bundle)
        lines.append("Files:")
        for item in bundle.files:
            mode = "edit" if item.editable else "context"
            lines.append(f"- {item.relative_path} [{mode}] {item.inclusion_reason}")
        if bundle.validation_plan is not None:
            lines.append(f"Validation command: {bundle.validation_plan.command_text}")
        self._append_completion_advisory(lines, bundle)
        return "\n".join(lines)

    def format_no_active_bundle(self) -> str:
        return "No active feature bundle.\nNext: send a bounded multi-file feature request in natural language."

    def format_apply_success(self, bundle: FeatureBundleRecord) -> str:
        lines = [
            "Feature bundle applied.",
            f"Bundle: {bundle.bundle_id}",
            f"Feature: {bundle.feature_title}",
            f"Applied files: {', '.join(bundle.applied_files) or '-'}",
        ]
        if bundle.validation_plan is not None:
            lines.append(f"Suggested validation: /run {bundle.validation_plan.command_text}")
        self._append_completion_advisory(lines, bundle)
        return "\n".join(lines)

    def format_apply_failure(self, bundle: FeatureBundleRecord, *, detail: str) -> str:
        return "\n".join(
            (
                "Feature bundle apply failed.",
                f"Bundle: {bundle.bundle_id}",
                f"Reason: {detail}",
                f"Applied files before stop: {', '.join(bundle.applied_files) or '-'}",
            )
        )

    def format_refusal(self, *, reason: str, next_step: str) -> str:
        return f"Couldn't plan that feature bundle.\nReason: {reason}\nNext: {next_step}"

    def format_clarification(self, *, question: str, next_step: str) -> str:
        return f"Need clarification before planning that coding bundle.\nQuestion: {question}\nNext: {next_step}"

    def format_pr_preview(self, plan: FeatureBundlePrPlan) -> str:
        lines = [
            "[FEATURE PR]",
            f"Status: {plan.status}",
            f"Mode: {plan.mode}",
            f"Bundle: {plan.bundle_id}",
            f"Feature: {plan.feature_title}",
        ]
        if plan.branch:
            lines.append(f"Branch: {plan.branch}")
        if plan.remote_name:
            lines.append(f"Remote: {plan.remote_name}")
        if plan.commit_sha:
            lines.append(f"Commit: {plan.commit_sha}")
        if plan.title:
            lines.append(f"Title: {plan.title}")
        if plan.summary:
            lines.append(f"Summary: {plan.summary}")
        lines.append(f"Merge readiness: {plan.merge_readiness}")
        if plan.merge_readiness_reason:
            lines.append(f"Merge readiness reason: {plan.merge_readiness_reason}")
        if plan.changed_paths:
            lines.append(f"Changed paths: {', '.join(plan.changed_paths)}")
        if plan.validation_summary:
            lines.append(f"Validation summary: {plan.validation_summary}")
        if plan.validation_command:
            lines.append(f"Validation command: {plan.validation_command}")
        if plan.readme_note:
            lines.append(f"README note: {plan.readme_note}")
        if plan.playtest_required:
            lines.append(f"Playtest required: yes - {plan.playtest_reason or 'Human verification is still required before merge.'}")
        else:
            lines.append("Playtest required: no")
        if plan.next_steps:
            lines.append("Next:")
            for step in plan.next_steps:
                lines.append(f"- {step}")
        return "\n".join(lines)

    def format_autonomous_dev_chain(self, chain: AutonomousDevChainRecord, *, include_plan: bool) -> str:
        lines = [
            "[AUTONOMOUS DEV LOOP]",
            f"Chain: {chain.chain_id}",
            f"Status: {chain.status}",
            f"Feature: {chain.feature_title}",
            f"Bundle: {chain.bundle_id}",
            f"Current step: {chain.current_step}",
        ]
        if chain.blocked_reason:
            lines.append(f"Blocked reason: {chain.blocked_reason}")
        if chain.final_outcome:
            lines.append(f"Outcome: {chain.final_outcome}")
        if chain.latest_summary:
            lines.append(f"Latest: {chain.latest_summary}")
        if chain.latest_branch:
            lines.append(f"Branch: {chain.latest_branch}")
        if chain.latest_commit_sha:
            lines.append(f"Commit: {chain.latest_commit_sha}")
        if chain.latest_pr_title:
            lines.append(f"PR title: {chain.latest_pr_title}")
        if include_plan:
            lines.append("Steps:")
            for step in chain.steps:
                lines.append(
                    f"- {step.name}: {step.status} | confirmation={'yes' if step.confirmation_required else 'no'} | eligible={'yes' if step.next_step_eligible else 'no'}"
                )
                if step.prerequisites:
                    lines.append(f"  Prerequisites: {', '.join(step.prerequisites)}")
                if step.result_summary:
                    lines.append(f"  Result: {step.result_summary}")
        return "\n".join(lines)

    def format_no_autonomous_dev_chain(self) -> str:
        return "No active autonomous dev chain.\nNext: send a bounded coding request that also asks AI-E to finish the workflow."

    @staticmethod
    def _append_coding_plan(lines: list[str], bundle: FeatureBundleRecord) -> None:
        plan = bundle.coding_task_plan
        if plan is None:
            return
        lines.extend(
            (
                "Coding plan:",
                f"- Type: {plan.task_type}",
                f"- Scope: {plan.scope_type}",
                f"- Risk: {plan.risk_level}",
                f"- Category: {plan.task_category or plan.task_type}",
                f"- Confidence: {plan.confidence}",
                f"- Status: {plan.status}",
                f"- Change: {plan.intended_change_type}",
                f"- Test impact: {plan.expected_test_impact}",
                f"- Validation: {plan.validation_command}",
                f"- Playtest required: {'yes' if plan.playtest_required else 'no'}",
                f"- Clarification needed: {'yes' if plan.clarification_needed else 'no'}",
            )
        )
        if plan.module_clusters:
            lines.append(f"- Clusters: {', '.join(plan.module_clusters)}")
        if plan.pattern_used:
            lines.append(f"- Pattern: {plan.pattern_used}")
            lines.append(f"- Pattern confidence: {plan.pattern_confidence}")
        if plan.pattern_summary:
            lines.append(f"- Pattern summary: {plan.pattern_summary}")
        if plan.cluster_plans:
            lines.append("- Cluster reasoning:")
            for cluster_plan in plan.cluster_plans:
                lines.append(f"  - {cluster_plan.cluster_id}: {cluster_plan.reason}")
        if plan.selection_summary:
            lines.append(f"- Selection: {plan.selection_summary}")
        if plan.expansion_summary:
            lines.append(f"- Expansion: {plan.expansion_summary}")
        if plan.target_files:
            lines.append(f"- Targets: {', '.join(plan.target_files)}")
        if plan.affected_tests:
            lines.append(f"- Tests: {', '.join(plan.affected_tests)}")
        if plan.impact_analysis.upstream:
            lines.append(f"- Impact upstream: {', '.join(plan.impact_analysis.upstream)}")
        if plan.impact_analysis.downstream:
            lines.append(f"- Impact downstream: {', '.join(plan.impact_analysis.downstream)}")
        if plan.impact_analysis.tests:
            lines.append(f"- Impact tests: {', '.join(plan.impact_analysis.tests)}")
        if plan.impact_analysis.interaction_points:
            lines.append(f"- Interaction points: {'; '.join(plan.impact_analysis.interaction_points)}")
        if plan.validation_rationale:
            lines.append(f"- Validation why: {plan.validation_rationale}")
        if plan.file_plans:
            lines.append("- File plan:")
            for file_plan in plan.file_plans:
                mode = "edit" if file_plan.editable else "context"
                lines.append(f"  - {file_plan.relative_path} [{mode}, {file_plan.scope_confidence:.2f}]")
                lines.append(f"    Change: {file_plan.change_type}")
                lines.append(f"    Reason: {file_plan.reason}")
        if plan.clarification_needed and plan.clarification_question:
            lines.append(f"- Clarification: {plan.clarification_question}")

    @staticmethod
    def _append_completion_advisory(lines: list[str], bundle: FeatureBundleRecord) -> None:
        advisory = bundle.completion_advisory
        if advisory is None:
            return
        lines.extend(
            (
                "Completion:",
                f"- {advisory.completion_summary}",
                f"- Repo: {advisory.repo_status}",
                f"- Milestone: {advisory.milestone_log}",
            )
        )
        lines.append(f"Commit prep: {advisory.commit_readiness_status}")
        if advisory.commit_readiness_reason:
            lines.append(f"Commit prep reason: {advisory.commit_readiness_reason}")
        if advisory.milestone_summary:
            lines.append(f"Milestone summary: {advisory.milestone_summary}")
        lines.append(f"README status: {advisory.readme_status}")
        if advisory.playtest_required:
            detail = advisory.playtest_reason or "Human or runtime verification is still required before commit."
            lines.append(f"Playtest required: yes - {detail}")
        else:
            lines.append("Playtest required: no")
        if advisory.included_paths:
            lines.append(f"Included paths: {', '.join(advisory.included_paths)}")
        if advisory.excluded_paths:
            lines.append(f"Excluded paths: {', '.join(advisory.excluded_paths)}")
        if advisory.ambiguous_paths:
            lines.append(f"Ambiguous paths: {', '.join(advisory.ambiguous_paths)}")
        if advisory.suggested_stage_paths:
            lines.append(f"Suggested stage: {', '.join(advisory.suggested_stage_paths)}")
        if advisory.suggested_commit_message:
            lines.append(f"Suggested commit message: {advisory.suggested_commit_message}")
        if advisory.readme_guidance:
            lines.append(f"README guidance: {advisory.readme_guidance}")
