"""In-memory store for active plan bridge state per Telegram chat."""
from __future__ import annotations

from .plan_bridge_models import BuildExecutionBridgeState


class PlanBridgeStore:
    """Track the active plan-step bridge state for each chat."""

    def __init__(self) -> None:
        self._active_states: dict[str, BuildExecutionBridgeState] = {}

    def get_active(self, *, chat_id: str) -> BuildExecutionBridgeState | None:
        return self._active_states.get(chat_id)

    def set_active(self, *, chat_id: str, state: BuildExecutionBridgeState) -> None:
        self._active_states[chat_id] = state

    def clear_active(self, *, chat_id: str) -> BuildExecutionBridgeState | None:
        return self._active_states.pop(chat_id, None)