"""Bounded conversational developer replies grounded in feature bundle and milestone state."""
from __future__ import annotations

from dataclasses import dataclass, field

from .feature_bundle_models import FeatureBundleMilestoneRecord, FeatureBundlePrPlan, FeatureBundleRecord


@dataclass(frozen=True)
class ConversationalDevReply:
    matched: bool
    reply: str = ""
    summary: str = ""
    telemetry: dict[str, object] = field(default_factory=dict)


class ConversationalDevPlanner:
    _ABOUT_MARKERS = ("about to change", "what are we changing", "what are we about to change", "current bundle")
    _BLOCKED_MARKERS = ("why is this blocked", "what is blocked", "what's blocked")
    _PR_MARKERS = ("what would this pr say", "pr say", "pr summary", "pull request summary")
    _MERGE_MARKERS = ("before merge", "before we merge", "still needs to happen before merge", "merge readiness")

    def plan(
        self,
        *,
        message: str,
        active_bundle: FeatureBundleRecord | None,
        latest_milestone: FeatureBundleMilestoneRecord | None,
        pr_plan: FeatureBundlePrPlan | None,
    ) -> ConversationalDevReply:
        normalized = " ".join(message.lower().split())
        if any(marker in normalized for marker in self._ABOUT_MARKERS):
            if active_bundle is None:
                return ConversationalDevReply(matched=False)
            changed_paths = ", ".join(active_bundle.file_paths()) or "-"
            reply = "\n".join(
                (
                    f"About to change: {active_bundle.feature_title}.",
                    f"Outcome: {active_bundle.intended_outcome}",
                    f"Files: {changed_paths}",
                    f"State: {active_bundle.state}",
                )
            )
            return ConversationalDevReply(
                matched=True,
                reply=reply,
                summary="Explained the active bounded feature bundle.",
                telemetry={
                    "conversational_dev_topic": "about_to_change",
                    "feature_bundle_id": active_bundle.bundle_id,
                },
            )
        if any(marker in normalized for marker in self._BLOCKED_MARKERS):
            if active_bundle is not None and active_bundle.completion_advisory is not None:
                advisory = active_bundle.completion_advisory
                reply = "\n".join(
                    (
                        f"Blocked status: {advisory.commit_readiness_status}",
                        f"Reason: {advisory.commit_readiness_reason or 'No active block is recorded.'}",
                        f"Next: {advisory.readme_guidance or 'Resolve the readiness issue and rerun the bounded preview.'}",
                    )
                )
                return ConversationalDevReply(
                    matched=True,
                    reply=reply,
                    summary="Explained the current bounded readiness block.",
                    telemetry={
                        "conversational_dev_topic": "blocked_reason",
                        "feature_bundle_id": active_bundle.bundle_id,
                    },
                )
            if pr_plan is not None:
                return ConversationalDevReply(
                    matched=True,
                    reply="\n".join(
                        (
                            f"Blocked status: {pr_plan.merge_readiness}",
                            f"Reason: {pr_plan.merge_readiness_reason}",
                            f"Next: {pr_plan.next_steps[0] if pr_plan.next_steps else 'Review the PR preview and resolve the remaining gate.'}",
                        )
                    ),
                    summary="Explained merge-readiness guidance for the latest milestone.",
                    telemetry={
                        "conversational_dev_topic": "blocked_reason",
                        "feature_bundle_id": pr_plan.bundle_id,
                    },
                )
            return ConversationalDevReply(matched=False)
        if any(marker in normalized for marker in self._PR_MARKERS):
            if pr_plan is None:
                return ConversationalDevReply(matched=False)
            reply = "\n".join(
                (
                    f"PR title: {pr_plan.title}",
                    f"PR summary: {pr_plan.summary}",
                    f"Merge readiness: {pr_plan.merge_readiness}",
                )
            )
            return ConversationalDevReply(
                matched=True,
                reply=reply,
                summary="Summarized the bounded PR package.",
                telemetry={
                    "conversational_dev_topic": "pr_summary",
                    "feature_bundle_id": pr_plan.bundle_id,
                },
            )
        if any(marker in normalized for marker in self._MERGE_MARKERS):
            if pr_plan is None:
                return ConversationalDevReply(matched=False)
            next_step_text = "; ".join(pr_plan.next_steps) if pr_plan.next_steps else "No additional merge guidance recorded."
            reply = "\n".join(
                (
                    f"Merge readiness: {pr_plan.merge_readiness}",
                    f"Reason: {pr_plan.merge_readiness_reason}",
                    f"Next: {next_step_text}",
                )
            )
            return ConversationalDevReply(
                matched=True,
                reply=reply,
                summary="Explained remaining merge steps for the latest milestone.",
                telemetry={
                    "conversational_dev_topic": "merge_readiness",
                    "feature_bundle_id": pr_plan.bundle_id,
                },
            )
        return ConversationalDevReply(matched=False)