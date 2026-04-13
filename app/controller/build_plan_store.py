"""In-memory store for active build plans per Telegram chat."""
from __future__ import annotations

from .build_plan_models import BuildPlan


class BuildPlanStore:
    """Track the active derived build plan for each chat."""

    def __init__(self) -> None:
        self._active_plans: dict[str, BuildPlan] = {}

    def get_active(self, *, chat_id: str) -> BuildPlan | None:
        return self._active_plans.get(chat_id)

    def set_active(self, *, chat_id: str, plan: BuildPlan) -> None:
        self._active_plans[chat_id] = plan

    def clear_active(self, *, chat_id: str) -> BuildPlan | None:
        return self._active_plans.pop(chat_id, None)