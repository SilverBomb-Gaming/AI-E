"""Deterministic bridge from build plans to one-step execution proposals."""
from __future__ import annotations

from dataclasses import replace

from .build_plan_models import BuildPlan, BuildPlanPhase, BuildPlanTaskGroup
from .execution_models import CapabilityExecutionResult
from .plan_bridge_models import BuildExecutionBridgeState, PlanExecutionProposal, PlanTaskGroupProgress


class PlanBridge:
    """Select the next actionable plan step and track its execution state."""

    def ordered_task_groups(self, plan: BuildPlan) -> tuple[tuple[BuildPlanPhase, BuildPlanTaskGroup], ...]:
        return self._ordered_task_groups(plan)

    def build_task_group_proposal(
        self,
        plan: BuildPlan,
        *,
        phase: BuildPlanPhase,
        task_group: BuildPlanTaskGroup,
        previous_status: str,
        proposal_id: str,
    ) -> PlanExecutionProposal:
        return self._build_proposal(
            plan,
            phase=phase,
            task_group=task_group,
            previous_status=previous_status,
            proposal_id=proposal_id,
        )

    def ensure_state(self, plan: BuildPlan, state: BuildExecutionBridgeState | None) -> BuildExecutionBridgeState:
        if state is None or state.active_plan_id != plan.plan_id:
            state = BuildExecutionBridgeState(
                active_plan_id=plan.plan_id,
                current_phase_id="",
                current_task_group_id="",
                current_step_state="idle",
                execution_proposal=None,
                task_group_progress=(),
                last_result_summary="",
                last_result_state="",
            )
        progress_map = {item.task_group_id: item for item in state.task_group_progress}
        active_task_group_id = state.execution_proposal.task_group_id if state.execution_proposal is not None else ""
        has_ready_slot = False
        entries: list[PlanTaskGroupProgress] = []
        for phase, task_group in self._ordered_task_groups(plan):
            existing = progress_map.get(
                task_group.task_group_id,
                PlanTaskGroupProgress(
                    phase_id=phase.phase_id,
                    task_group_id=task_group.task_group_id,
                    task_group_name=task_group.name,
                    status="pending",
                    execution_proposal=None,
                    last_result_summary="",
                    last_result_state="",
                ),
            )
            status = existing.status
            proposal = existing.execution_proposal
            if task_group.task_group_id == active_task_group_id and state.current_step_state in {"proposed", "approved", "executing"}:
                status = "in_progress"
                proposal = state.execution_proposal
                has_ready_slot = True
            elif existing.status == "completed":
                status = "completed"
            elif plan.state == "blocked":
                status = "blocked"
            elif not has_ready_slot:
                status = existing.status if existing.status in {"failed", "cancelled"} else "ready"
                has_ready_slot = True
            else:
                status = "pending"
                proposal = None
            entries.append(
                replace(
                    existing,
                    phase_id=phase.phase_id,
                    task_group_name=task_group.name,
                    status=status,
                    execution_proposal=proposal,
                )
            )
        return replace(state, task_group_progress=tuple(entries))

    def propose_next_step(
        self,
        plan: BuildPlan,
        state: BuildExecutionBridgeState,
        *,
        proposal_id: str,
    ) -> BuildExecutionBridgeState:
        state = self.ensure_state(plan, state)
        if state.execution_proposal is not None and state.current_step_state in {"proposed", "approved", "executing"}:
            return state
        if plan.state == "blocked":
            return replace(state, execution_proposal=None, current_step_state="idle")
        candidate = self._next_candidate(plan, state)
        if candidate is None:
            completed = all(item.status == "completed" for item in state.task_group_progress)
            return replace(
                state,
                execution_proposal=None,
                current_phase_id="",
                current_task_group_id="",
                current_step_state="completed" if completed else "idle",
            )
        phase, task_group, progress = candidate
        proposal = self._build_proposal(plan, phase=phase, task_group=task_group, previous_status=progress.status, proposal_id=proposal_id)
        entries = [
            replace(item, status="in_progress", execution_proposal=proposal)
            if item.task_group_id == task_group.task_group_id
            else item
            for item in state.task_group_progress
        ]
        return replace(
            state,
            current_phase_id=phase.phase_id,
            current_task_group_id=task_group.task_group_id,
            current_step_state="proposed",
            execution_proposal=proposal,
            task_group_progress=tuple(entries),
        )

    def reset_current_step(self, plan: BuildPlan, state: BuildExecutionBridgeState) -> BuildExecutionBridgeState:
        state = self.ensure_state(plan, state)
        current_task_group_id = state.current_task_group_id
        entries = []
        for item in state.task_group_progress:
            if item.task_group_id == current_task_group_id and item.status != "completed":
                entries.append(replace(item, status="ready", execution_proposal=None))
            else:
                entries.append(replace(item, execution_proposal=None if item.task_group_id == current_task_group_id else item.execution_proposal))
        return replace(
            state,
            current_phase_id="",
            current_task_group_id="",
            current_step_state="idle",
            execution_proposal=None,
            task_group_progress=tuple(entries),
        )

    def mark_approved(self, state: BuildExecutionBridgeState) -> BuildExecutionBridgeState:
        return replace(state, current_step_state="approved")

    def mark_executing(self, state: BuildExecutionBridgeState) -> BuildExecutionBridgeState:
        return replace(state, current_step_state="executing")

    def apply_execution_result(
        self,
        plan: BuildPlan,
        state: BuildExecutionBridgeState,
        result: CapabilityExecutionResult,
    ) -> BuildExecutionBridgeState:
        state = self.ensure_state(plan, state)
        proposal = state.execution_proposal
        if proposal is None:
            return state
        if result.outcome == "success":
            task_status = "completed"
            step_state = "completed"
        elif result.outcome in {"blocked", "unavailable", "out_of_scope"}:
            task_status = "blocked"
            step_state = "failed"
        elif result.outcome in {"denied", "expired"}:
            task_status = "cancelled"
            step_state = "cancelled"
        else:
            task_status = "failed"
            step_state = "failed"
        entries = []
        for item in state.task_group_progress:
            if item.task_group_id == proposal.task_group_id:
                entries.append(
                    replace(
                        item,
                        status=task_status,
                        execution_proposal=proposal,
                        last_result_summary=result.internal_summary,
                        last_result_state=result.outcome,
                    )
                )
            else:
                entries.append(item)
        return replace(
            state,
            execution_proposal=None,
            current_step_state=step_state,
            task_group_progress=tuple(entries),
            last_result_summary=result.internal_summary,
            last_result_state=result.outcome,
        )

    def counts(self, state: BuildExecutionBridgeState) -> dict[str, int]:
        counts = {"pending": 0, "ready": 0, "in_progress": 0, "completed": 0, "blocked": 0, "failed": 0, "cancelled": 0}
        for item in state.task_group_progress:
            counts[item.status] += 1
        return counts

    def _next_candidate(
        self,
        plan: BuildPlan,
        state: BuildExecutionBridgeState,
    ) -> tuple[BuildPlanPhase, BuildPlanTaskGroup, PlanTaskGroupProgress] | None:
        progress_map = {item.task_group_id: item for item in state.task_group_progress}
        for phase, task_group in self._ordered_task_groups(plan):
            item = progress_map[task_group.task_group_id]
            if item.status in {"ready", "failed", "cancelled"}:
                return phase, task_group, item
        return None

    def _build_proposal(
        self,
        plan: BuildPlan,
        *,
        phase: BuildPlanPhase,
        task_group: BuildPlanTaskGroup,
        previous_status: str,
        proposal_id: str,
    ) -> PlanExecutionProposal:
        target_capability_id, command_label, command_argument, expected_outputs = self._command_mapping(plan, phase=phase, task_group=task_group)
        suggested_entry_command = command_label if not command_argument else f"{command_label} {command_argument}"
        rationale = f"{task_group.name} is the earliest incomplete task group in {phase.name.lower()} and its dependencies are satisfied."
        if previous_status in {"failed", "cancelled"}:
            rationale = f"Retry {task_group.name.lower()} after the previous {previous_status} result because it is still the next incomplete task group."
        proposed_actions = (
            f"Execute {suggested_entry_command} through the controlled operator path.",
            f"Capture the result against {task_group.name.lower()} before asking for another plan step.",
        )
        return PlanExecutionProposal(
            proposal_id=proposal_id,
            plan_id=plan.plan_id,
            phase_id=phase.phase_id,
            task_group_id=task_group.task_group_id,
            title=f"{phase.name} -> {task_group.name}",
            rationale=rationale,
            proposed_actions=proposed_actions,
            expected_outputs=expected_outputs,
            required_confirmations=("Operator approval via /planapprove.",),
            suggested_entry_command=suggested_entry_command,
            blockers=plan.blockers,
            target_capability_id=target_capability_id,
            command_label=command_label,
            command_argument=command_argument,
        )

    def _command_mapping(
        self,
        plan: BuildPlan,
        *,
        phase: BuildPlanPhase,
        task_group: BuildPlanTaskGroup,
    ) -> tuple[str, str, str, tuple[str, ...]]:
        name = task_group.name.lower()
        goal = task_group.objective.lower()
        request_type = plan.request_type
        if "quality" in name or "acceptance" in name or "validate" in goal:
            return (
                "test.command.run",
                "/test",
                "tests.test_telegram_commands",
                ("Focused unittest result for tests.test_telegram_commands.", "Controller validation summary for the proposed plan step."),
            )
        if "ui" in name and request_type == "website":
            return (
                "file.read",
                "/file",
                "app/main.py",
                ("Preview of app/main.py.", "Buffered context for the current website shell implementation surface."),
            )
        if "capture" in name:
            return (
                "file.read",
                "/file",
                "app/actions.py",
                ("Preview of app/actions.py.", "Buffered context for conversion and capture-related logic."),
            )
        if "shell" in name and request_type == "desktop_app":
            return (
                "file.read",
                "/file",
                "app/ui.py",
                ("Preview of app/ui.py.", "Buffered context for the desktop shell surface."),
            )
        if "processing" in name or "export" in goal:
            return (
                "file.read",
                "/file",
                "app/artifacts.py",
                ("Preview of app/artifacts.py.", "Buffered context for export and artifact-handling logic."),
            )
        if "technical" in name or "platform" in name or "packaging" in name or "deployment" in name:
            return (
                "file.read",
                "/file",
                "README.md",
                ("Preview of README.md.", "Repository contract context for the proposed implementation step."),
            )
        return (
            "repo.status.read",
            "/repo",
            "status",
            ("Scoped repository status summary.", "Buffered repo context for the next bounded implementation step."),
        )

    @staticmethod
    def _ordered_task_groups(plan: BuildPlan) -> tuple[tuple[BuildPlanPhase, BuildPlanTaskGroup], ...]:
        return tuple((phase, task_group) for phase in plan.phases for task_group in phase.task_groups)