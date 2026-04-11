"""Deterministic bounded orchestration for the autonomous development loop."""
from __future__ import annotations

from dataclasses import replace

from .autonomous_dev_models import (
    AutonomousDevChainRecord,
    AutonomousDevPlanningDecision,
    AutonomousDevStepName,
    AutonomousDevStepRecord,
)
from .feature_bundle_models import FeatureBundleRecord


class AutonomousDevLoop:
    _REQUEST_MARKERS = (
        "then finish the workflow",
        "finish the workflow",
        "finish workflow",
        "complete the workflow",
        "run the full workflow",
        "through the full workflow",
        "autonomous dev loop",
    )

    def plan_request(self, *, prompt: str, active_chain: AutonomousDevChainRecord | None) -> AutonomousDevPlanningDecision:
        normalized = " ".join(prompt.lower().split())
        if not any(marker in normalized for marker in self._REQUEST_MARKERS):
            return AutonomousDevPlanningDecision(kind="not_applicable")
        if active_chain is not None and active_chain.status not in {"completed", "blocked", "stopped"}:
            return AutonomousDevPlanningDecision(
                kind="refused",
                refusal_reason="An autonomous dev chain is already active for this chat.",
                next_step="Use /devchain status to inspect it, /devchain resume to continue, or /devchain stop before starting a different loop.",
            )
        cleaned = prompt
        for marker in self._REQUEST_MARKERS:
            cleaned = cleaned.replace(marker, "")
            cleaned = cleaned.replace(marker.title(), "")
        cleaned = " ".join(cleaned.replace(" ,", ",").split()).strip(" ,.")
        if not cleaned:
            return AutonomousDevPlanningDecision(
                kind="needs_clarification",
                clarification_question="What bounded coding or feature-bundle task should the autonomous loop run?",
                next_step="Reply with one bounded controller/model/formatter/test update that the existing feature-bundle planner already supports.",
            )
        return AutonomousDevPlanningDecision(kind="planned", cleaned_prompt=cleaned)

    def build_chain(
        self,
        *,
        chain_id: str,
        prompt: str,
        cleaned_prompt: str,
        bundle: FeatureBundleRecord,
        timestamp: str,
    ) -> AutonomousDevChainRecord:
        steps = (
            AutonomousDevStepRecord(
                name="coding_plan",
                status="completed",
                prerequisites=(),
                confirmation_required=False,
                result_summary=bundle.bundle_summary,
                outcome_code="ok",
                next_step_eligible=True,
            ),
            AutonomousDevStepRecord(
                name="feature_apply",
                status="pending",
                prerequisites=("coding_plan",),
                confirmation_required=True,
                next_step_eligible=True,
            ),
            AutonomousDevStepRecord(
                name="validation",
                status="pending",
                prerequisites=("feature_apply",),
                confirmation_required=False,
            ),
            AutonomousDevStepRecord(
                name="commit_prepare",
                status="pending",
                prerequisites=("validation",),
                confirmation_required=False,
            ),
            AutonomousDevStepRecord(
                name="commit_execute",
                status="pending",
                prerequisites=("commit_prepare",),
                confirmation_required=True,
            ),
            AutonomousDevStepRecord(
                name="push_execute",
                status="pending",
                prerequisites=("commit_execute",),
                confirmation_required=True,
            ),
            AutonomousDevStepRecord(
                name="pr_preview",
                status="pending",
                prerequisites=("push_execute",),
                confirmation_required=False,
            ),
        )
        return AutonomousDevChainRecord(
            chain_id=chain_id,
            originating_request=prompt,
            feature_request=cleaned_prompt,
            feature_title=bundle.feature_title,
            bundle_id=bundle.bundle_id,
            status="chain_ready",
            current_step="feature_apply",
            completed_steps=("coding_plan",),
            blocked_reason="",
            final_outcome="",
            created_at=timestamp,
            updated_at=timestamp,
            steps=steps,
            latest_summary="Bounded coding plan prepared and ready to enter the supervised apply step.",
        )

    def mark_awaiting_confirmation(
        self,
        chain: AutonomousDevChainRecord,
        *,
        step_name: AutonomousDevStepName,
        summary: str,
        updated_at: str,
    ) -> AutonomousDevChainRecord:
        return self._replace_step(
            chain,
            step_name=step_name,
            updated_at=updated_at,
            status="awaiting_confirmation",
            summary=summary,
            outcome_code="confirmation_required",
            chain_status="awaiting_confirmation",
            current_step=step_name,
        )

    def mark_completed(
        self,
        chain: AutonomousDevChainRecord,
        *,
        step_name: AutonomousDevStepName,
        summary: str,
        updated_at: str,
        next_step: AutonomousDevStepName,
    ) -> AutonomousDevChainRecord:
        completed_steps = chain.completed_steps
        if step_name not in completed_steps:
            completed_steps = (*completed_steps, step_name)
        return self._replace_step(
            chain,
            step_name=step_name,
            updated_at=updated_at,
            status="completed",
            summary=summary,
            outcome_code="ok",
            chain_status="chain_ready",
            current_step=next_step,
            completed_steps=completed_steps,
        )

    def mark_blocked(
        self,
        chain: AutonomousDevChainRecord,
        *,
        step_name: AutonomousDevStepName,
        reason: str,
        updated_at: str,
    ) -> AutonomousDevChainRecord:
        return self._replace_step(
            chain,
            step_name=step_name,
            updated_at=updated_at,
            status="blocked",
            summary=reason,
            outcome_code="blocked",
            chain_status="blocked",
            current_step=step_name,
            blocked_reason=reason,
        )

    def mark_stopped(self, chain: AutonomousDevChainRecord, *, reason: str, updated_at: str) -> AutonomousDevChainRecord:
        return self._replace_step(
            chain,
            step_name=chain.current_step,
            updated_at=updated_at,
            status="stopped",
            summary=reason,
            outcome_code="stopped",
            chain_status="stopped",
            current_step=chain.current_step,
            stop_reason=reason,
            final_outcome=reason,
        )

    def mark_completed_terminal(
        self,
        chain: AutonomousDevChainRecord,
        *,
        step_name: AutonomousDevStepName,
        summary: str,
        updated_at: str,
    ) -> AutonomousDevChainRecord:
        completed_steps = chain.completed_steps
        if step_name not in completed_steps:
            completed_steps = (*completed_steps, step_name)
        return self._replace_step(
            chain,
            step_name=step_name,
            updated_at=updated_at,
            status="completed",
            summary=summary,
            outcome_code="ok",
            chain_status="completed",
            current_step=step_name,
            completed_steps=completed_steps,
            final_outcome=summary,
        )

    @staticmethod
    def next_command_for_step(step_name: AutonomousDevStepName) -> str:
        command_map = {
            "feature_apply": "/featureapply",
            "commit_execute": "/featurecommit execute",
            "push_execute": "/featurepush execute",
        }
        return command_map.get(step_name, "")

    def _replace_step(
        self,
        chain: AutonomousDevChainRecord,
        *,
        step_name: AutonomousDevStepName,
        updated_at: str,
        status: str,
        summary: str,
        outcome_code: str,
        chain_status: str,
        current_step: AutonomousDevStepName,
        completed_steps: tuple[AutonomousDevStepName, ...] | None = None,
        blocked_reason: str | None = None,
        final_outcome: str | None = None,
        stop_reason: str | None = None,
    ) -> AutonomousDevChainRecord:
        updated_steps: list[AutonomousDevStepRecord] = []
        for step in chain.steps:
            if step.name == step_name:
                updated_steps.append(
                    replace(
                        step,
                        status=status,
                        result_summary=summary,
                        outcome_code=outcome_code,
                        next_step_eligible=(status == "completed"),
                    )
                )
                continue
            eligible = step.name == current_step and chain_status in {"chain_ready", "awaiting_confirmation"}
            updated_steps.append(replace(step, next_step_eligible=eligible and step.status == "pending"))
        return replace(
            chain,
            status=chain_status,  # type: ignore[arg-type]
            current_step=current_step,
            completed_steps=chain.completed_steps if completed_steps is None else completed_steps,
            blocked_reason=chain.blocked_reason if blocked_reason is None else blocked_reason,
            final_outcome=chain.final_outcome if final_outcome is None else final_outcome,
            updated_at=updated_at,
            steps=tuple(updated_steps),
            latest_summary=summary,
            stop_reason=chain.stop_reason if stop_reason is None else stop_reason,
        )