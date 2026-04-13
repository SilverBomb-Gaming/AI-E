"""Human-readable formatting helpers for plan-step bridge state."""
from __future__ import annotations

from .build_plan_models import BuildPlan
from .plan_bridge import PlanBridge
from .plan_bridge_models import BuildExecutionBridgeState, PlanExecutionProposal


class PlanBridgeFormatter:
    """Render plan proposals and bridge progress into concise operator-facing text."""

    def __init__(self, bridge: PlanBridge | None = None) -> None:
        self._bridge = bridge or PlanBridge()

    def format_proposal(self, plan: BuildPlan, state: BuildExecutionBridgeState, proposal: PlanExecutionProposal) -> str:
        lines = [
            "Plan step",
            f"Plan: {plan.plan_id} {state.current_step_state}",
            f"Task: {proposal.title}",
            f"Action: {proposal.suggested_entry_command}",
            f"Why: {proposal.rationale}",
            f"Expected: {self._join_items(proposal.expected_outputs, limit=2)}",
            "Approve: /planapprove",
        ]
        return "\n".join(lines)

    def format_blocked_plan(self, plan: BuildPlan) -> str:
        lines = [
            "Couldn't propose a plan step.",
            "Reason: The active build plan is blocked.",
        ]
        if plan.blockers:
            lines.append("Blockers:")
            lines.extend(f"- {item}" for item in plan.blockers[:3])
        lines.append("Next: Resolve the blockers, then rerun /planbuild.")
        return "\n".join(lines)

    def format_no_active_plan(self) -> str:
        return "Couldn't propose a plan step.\nReason: No active build plan exists.\nNext: Use /planbuild after /translate or /refine."

    def format_no_active_proposal(self) -> str:
        return "Couldn't approve that plan step.\nReason: No proposed plan step exists.\nNext: Use /planstep first."

    def format_reset_reply(self, had_state: bool, had_proposal: bool) -> str:
        if not had_state and not had_proposal:
            return "No active plan step to reset."
        return "Plan step reset.\nNext: Use /planstep to generate a fresh proposal."

    def format_completed_plan(self, plan: BuildPlan) -> str:
        return f"Plan step\nPlan: {plan.plan_id} completed\nNext: No pending task groups remain."

    def format_status(self, plan: BuildPlan, state: BuildExecutionBridgeState) -> str:
        counts = self._bridge.counts(state)
        lines = [
            "Plan status",
            f"Plan: {plan.plan_id} {state.current_step_state}",
            f"Completed: {counts['completed']}",
            f"Ready: {counts['ready']}",
        ]
        if counts["in_progress"]:
            lines.append(f"In progress: {counts['in_progress']}")
        if counts["blocked"]:
            lines.append(f"Blocked: {counts['blocked']}")
        if counts["failed"]:
            lines.append(f"Failed: {counts['failed']}")
        if state.execution_proposal is not None:
            lines.append(f"Current: {state.execution_proposal.title}")
            lines.append(f"Action: {state.execution_proposal.suggested_entry_command}")
        elif state.last_result_summary:
            lines.append(f"Last: {state.last_result_state} | {state.last_result_summary}")
        lines.append("Next: Use /planstep for the next proposal or /planapprove for the current one.")
        return "\n".join(lines)

    def format_approval_result(
        self,
        proposal: PlanExecutionProposal,
        executed_capability_id: str,
        outcome: str,
        summary: str,
    ) -> str:
        lines = [
            "Plan approval",
            f"Task: {proposal.title}",
            f"Action: {proposal.suggested_entry_command}",
            f"Executed: {executed_capability_id}",
            f"Outcome: {outcome}",
            f"Summary: {summary}",
            "Next: Use /planstatus or /planstep.",
        ]
        return "\n".join(lines)

    @staticmethod
    def _join_items(items: tuple[str, ...], *, limit: int) -> str:
        selected = list(items[:limit])
        remaining = len(items) - len(selected)
        summary = "; ".join(selected)
        if remaining > 0:
            return f"{summary}; +{remaining} more"
        return summary