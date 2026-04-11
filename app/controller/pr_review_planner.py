"""Deterministic planner for bounded PR preview and merge-readiness guidance."""
from __future__ import annotations

from .feature_bundle_models import FeatureBundleMilestoneRecord, FeatureBundlePrPlan


class PrReviewPlanner:
    def build_plan(self, *, milestone: FeatureBundleMilestoneRecord, mode: str) -> FeatureBundlePrPlan:
        normalized_mode = "execute" if str(mode).strip().lower() == "execute" else "preview"
        status = "manual_only" if normalized_mode == "execute" else "ready_for_review"
        merge_readiness = "ready_for_review"
        merge_reason = "Bounded commit and push completed; PR creation remains manual in v1."
        next_steps: list[str] = [
            "Open the PR manually with the title and summary below.",
            "Request review after confirming the validation summary is still accurate.",
        ]
        if milestone.playtest_required:
            merge_readiness = "blocked_pending_playtest"
            merge_reason = milestone.playtest_reason or "Human verification is still required before merge."
            next_steps.insert(0, "Complete the required playtest or human verification before merging.")
        if normalized_mode == "execute":
            next_steps = [
                "PR creation remains manual in v1.",
                "Use this preview to open the PR yourself and keep the bounded scope unchanged.",
            ]
        summary_parts = [milestone.milestone_summary or milestone.completion_summary]
        if milestone.validation_summary:
            summary_parts.append(f"Validation: {milestone.validation_summary}")
        if milestone.readme_status == "dirty_but_unrelated":
            summary_parts.append("README.md remained excluded because it was dirty but unrelated.")
        summary = " ".join(part.strip() for part in summary_parts if part and part.strip())
        title_suffix = milestone.feature_title.strip() or "bounded milestone"
        return FeatureBundlePrPlan(
            status=status,
            mode=normalized_mode,
            bundle_id=milestone.bundle_id,
            feature_title=milestone.feature_title,
            branch=milestone.branch,
            commit_sha=milestone.commit_sha,
            title=f"{title_suffix}",
            summary=summary,
            changed_paths=milestone.committed_paths,
            validation_summary=milestone.validation_summary,
            validation_command=milestone.validation_command,
            merge_readiness=merge_readiness,
            merge_readiness_reason=merge_reason,
            readme_note=milestone.readme_guidance,
            playtest_required=milestone.playtest_required,
            playtest_reason=milestone.playtest_reason,
            remote_name=milestone.push_remote_name,
            next_steps=tuple(next_steps),
        )