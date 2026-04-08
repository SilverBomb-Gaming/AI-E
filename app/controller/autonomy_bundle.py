"""Bounded autonomy bundle selection and run-state helpers."""
from __future__ import annotations

from dataclasses import replace

from .autonomy_bundle_models import (
    AutonomyBundleProposal,
    AutonomyBundleRunState,
    AutonomyBundleSelectedStep,
    AutonomyBundleState,
    AutonomyBundleStepResult,
    AutonomyBundleStopConditions,
)
from .build_plan_models import BuildPlan
from .plan_bridge import PlanBridge
from .plan_bridge_models import BuildExecutionBridgeState


class AutonomyBundle:
    """Build and track tightly bounded multi-step execution bundles."""

    MAX_BUNDLE_STEPS = 3
    BUNDLE_TIMEOUT_SECONDS = 60
    ALLOWED_CAPABILITY_IDS = frozenset(
        {
            "repo.status.read",
            "file.read",
            "file.patch.write",
            "file.write.replace",
            "shell.command.run",
            "test.command.run",
        }
    )
    TERMINAL_STATES = frozenset({"completed", "failed", "cancelled", "invalidated"})

    def __init__(self, plan_bridge: PlanBridge | None = None) -> None:
        self._plan_bridge = plan_bridge or PlanBridge()

    def build_proposal(
        self,
        plan: BuildPlan,
        bridge_state: BuildExecutionBridgeState | None,
        *,
        bundle_id: str,
    ) -> AutonomyBundleProposal | None:
        if plan.state != "ready":
            return None
        state = self._plan_bridge.ensure_state(plan, bridge_state)
        progress_map = {item.task_group_id: item for item in state.task_group_progress}
        ordered = self._plan_bridge.ordered_task_groups(plan)
        start_index = self._first_incomplete_index(ordered, progress_map)
        if start_index is None:
            return None
        steps: list[AutonomyBundleSelectedStep] = []
        selected_task_groups: list[str] = []
        expected_outputs: list[str] = []
        risk_notes: list[str] = []
        for phase, task_group in ordered[start_index:]:
            if len(steps) >= self.MAX_BUNDLE_STEPS:
                break
            progress = progress_map[task_group.task_group_id]
            if progress.status == "completed":
                continue
            if progress.status == "blocked":
                break
            proposal = self._plan_bridge.build_task_group_proposal(
                plan,
                phase=phase,
                task_group=task_group,
                previous_status=progress.status,
                proposal_id=f"{bundle_id}-S{len(steps) + 1}",
            )
            if proposal.target_capability_id not in self.ALLOWED_CAPABILITY_IDS:
                break
            selected_task_groups.append(task_group.name)
            expected_outputs.extend(output for output in proposal.expected_outputs if output not in expected_outputs)
            if proposal.command_label in {"/run", "/test"}:
                note = f"{proposal.command_label} can fail and will stop the bundle immediately."
                if note not in risk_notes:
                    risk_notes.append(note)
            dependency_state = "ready now" if not steps else f"depends on step {len(steps)} succeeding first"
            steps.append(
                AutonomyBundleSelectedStep(
                    step_index=len(steps) + 1,
                    plan_id=plan.plan_id,
                    phase_id=phase.phase_id,
                    task_group_id=task_group.task_group_id,
                    title=proposal.title,
                    mapped_execution_action=proposal.suggested_entry_command,
                    dependency_state=dependency_state,
                    expected_result=proposal.expected_outputs[0] if proposal.expected_outputs else "Step completes with a guarded execution result.",
                    target_capability_id=proposal.target_capability_id,
                    command_label=proposal.command_label,
                    command_argument=proposal.command_argument,
                    suggested_entry_command=proposal.suggested_entry_command,
                )
            )
        if not steps:
            return None
        stop_conditions = AutonomyBundleStopConditions(
            stop_on_first_failure=True,
            stop_after_max_steps=min(self.MAX_BUNDLE_STEPS, len(steps)),
            stop_if_scope_denied=True,
            stop_if_confirmation_required_beyond_bundle=True,
            stop_if_plan_invalidated=True,
            bundle_timeout_seconds=self.BUNDLE_TIMEOUT_SECONDS,
        )
        first_step = steps[0]
        title = f"{first_step.title} bundle"
        rationale = (
            f"Bundle the next {len(steps)} dependency-valid task groups from plan {plan.plan_id} into one small approved slice."
        )
        if len(steps) == self.MAX_BUNDLE_STEPS:
            risk_notes.append("Bundle stops after the approved 3-step budget even if more plan work remains.")
        return AutonomyBundleProposal(
            bundle_id=bundle_id,
            plan_id=plan.plan_id,
            title=title,
            rationale=rationale,
            selected_task_groups=tuple(selected_task_groups),
            selected_steps=tuple(steps),
            max_steps=stop_conditions.stop_after_max_steps,
            stop_conditions=stop_conditions,
            expected_outputs=tuple(expected_outputs),
            risk_notes=tuple(risk_notes),
            approval_required=True,
        )

    def proposed_run_state(self, proposal: AutonomyBundleProposal, *, timestamp: str) -> AutonomyBundleRunState:
        return AutonomyBundleRunState(
            bundle_id=proposal.bundle_id,
            plan_id=proposal.plan_id,
            state="proposed",
            started_at="",
            updated_at=timestamp,
            completed_steps=(),
            failed_step=None,
            stop_reason="",
            result_summary="Bundle proposed and waiting for explicit approval.",
            current_step_index=0,
            current_step_title="",
            proposal=proposal,
        )

    def mark_approved(self, state: AutonomyBundleRunState, *, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="approved",
            updated_at=timestamp,
            result_summary="Bundle approved and ready to run.",
        )

    def mark_running(self, state: AutonomyBundleRunState, *, timestamp: str) -> AutonomyBundleRunState:
        started_at = state.started_at or timestamp
        return replace(
            state,
            state="running",
            started_at=started_at,
            updated_at=timestamp,
            result_summary="Bundle is running within the approved step budget.",
        )

    def mark_step_running(self, state: AutonomyBundleRunState, step: AutonomyBundleSelectedStep, *, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="running",
            updated_at=timestamp,
            current_step_index=step.step_index,
            current_step_title=step.title,
            result_summary=f"Running step {step.step_index}/{state.proposal.max_steps}: {step.title}",
        )

    def record_step_result(
        self,
        state: AutonomyBundleRunState,
        step: AutonomyBundleSelectedStep,
        *,
        capability_id: str,
        outcome: str,
        reason_code: str,
        summary: str,
        timestamp: str,
    ) -> AutonomyBundleRunState:
        step_result = AutonomyBundleStepResult(
            step_index=step.step_index,
            phase_id=step.phase_id,
            task_group_id=step.task_group_id,
            title=step.title,
            capability_id=capability_id,
            command_label=step.command_label,
            outcome=outcome,
            reason_code=reason_code,
            summary=summary,
        )
        if outcome == "success":
            completed_steps = state.completed_steps + (step_result,)
            return replace(
                state,
                updated_at=timestamp,
                completed_steps=completed_steps,
                current_step_index=step.step_index,
                current_step_title=step.title,
                result_summary=f"Completed {len(completed_steps)}/{state.proposal.max_steps} approved bundle steps.",
            )
        return replace(
            state,
            state="failed",
            updated_at=timestamp,
            failed_step=step_result,
            stop_reason=self._stop_reason_for_outcome(outcome),
            current_step_index=step.step_index,
            current_step_title=step.title,
            result_summary=f"Bundle stopped on step {step.step_index}: {summary}",
        )

    def mark_completed(self, state: AutonomyBundleRunState, *, stop_reason: str, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="completed",
            updated_at=timestamp,
            stop_reason=stop_reason,
            result_summary=f"Bundle completed {len(state.completed_steps)}/{state.proposal.max_steps} approved steps and stopped at the agreed boundary.",
        )

    def mark_cancelled(self, state: AutonomyBundleRunState, *, reason: str, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="cancelled",
            updated_at=timestamp,
            stop_reason=reason,
            result_summary=f"Bundle cancelled: {reason}",
        )

    def mark_invalidated(self, state: AutonomyBundleRunState, *, reason: str, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="invalidated",
            updated_at=timestamp,
            stop_reason=reason,
            result_summary=f"Bundle invalidated: {reason}",
        )

    def mark_timeout(self, state: AutonomyBundleRunState, *, timestamp: str) -> AutonomyBundleRunState:
        return replace(
            state,
            state="failed",
            updated_at=timestamp,
            stop_reason="bundle_timeout",
            result_summary="Bundle stopped because the bounded execution timeout was reached.",
        )

    def is_terminal(self, state: AutonomyBundleRunState | None) -> bool:
        return state is not None and state.state in self.TERMINAL_STATES

    @staticmethod
    def _first_incomplete_index(ordered, progress_map) -> int | None:
        for index, (_, task_group) in enumerate(ordered):
            status = progress_map[task_group.task_group_id].status
            if status != "completed":
                return index
        return None

    @staticmethod
    def _stop_reason_for_outcome(outcome: str) -> str:
        if outcome == "out_of_scope":
            return "scope_denied"
        if outcome == "confirmation_required":
            return "confirmation_required_beyond_bundle"
        if outcome == "timed_out":
            return "bundle_timeout"
        if outcome == "blocked":
            return "step_blocked"
        if outcome == "unavailable":
            return "step_unavailable"
        return "step_failed"