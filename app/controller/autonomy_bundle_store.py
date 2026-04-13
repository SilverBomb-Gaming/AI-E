"""In-memory storage for bounded autonomy bundle state per Telegram chat."""
from __future__ import annotations

from .autonomy_bundle_models import AutonomyBundleRunState


class AutonomyBundleStore:
    """Track the active bounded-autonomy bundle for each chat."""

    def __init__(self) -> None:
        self._active_states: dict[str, AutonomyBundleRunState] = {}

    def get_active(self, *, chat_id: str) -> AutonomyBundleRunState | None:
        return self._active_states.get(chat_id)

    def set_active(self, *, chat_id: str, state: AutonomyBundleRunState) -> None:
        self._active_states[chat_id] = state

    def clear_active(self, *, chat_id: str) -> AutonomyBundleRunState | None:
        return self._active_states.pop(chat_id, None)