"""Human-readable formatting helpers for derived build plans."""
from __future__ import annotations

from .build_plan_models import BuildPlan


class BuildPlanFormatter:
    """Render build plans into concise operator-facing text."""

    def format_build_plan(self, plan: BuildPlan, *, heading: str) -> str:
        phase_names = "; ".join(phase.name for phase in plan.phases[:3])
        lines = [
            heading,
            f"Plan: {plan.plan_id} {plan.state}",
            f"Type: {plan.request_type}",
            f"Summary: {plan.summary}",
            f"Phases: {phase_names}",
        ]
        if plan.confirmed_values:
            lines.append(f"Confirmed: {self._join_items(plan.confirmed_values, limit=4)}")
        if plan.cross_phase_dependencies:
            lines.append(f"Dependencies: {self._join_items(plan.cross_phase_dependencies, limit=3)}")
        if plan.blockers:
            lines.append("Blockers:")
            lines.extend(f"- {item}" for item in plan.blockers[:3])
        lines.append(f"Next: {plan.next_step}")
        return "\n".join(lines)

    def format_no_active_plan(self) -> str:
        return "No active build plan.\nNext: Use /planbuild after /translate or /refine."

    def format_clear_reply(self, plan: BuildPlan | None) -> str:
        if plan is None:
            return "No active build plan to clear."
        return f"Build plan cleared.\nPlan: {plan.plan_id} removed."

    @staticmethod
    def _join_items(items: tuple[str, ...], *, limit: int) -> str:
        selected = list(items[:limit])
        remaining = len(items) - len(selected)
        summary = "; ".join(selected)
        if remaining > 0:
            return f"{summary}; +{remaining} more"
        return summary