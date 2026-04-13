"""In-memory store for active bootstrap proposals per Telegram chat."""
from __future__ import annotations

from .project_bootstrap_models import ProjectBootstrapProposal


class ProjectBootstrapStore:
    """Track the active bounded bootstrap proposal for each chat."""

    def __init__(self) -> None:
        self._active_proposals: dict[str, ProjectBootstrapProposal] = {}

    def get_active(self, *, chat_id: str) -> ProjectBootstrapProposal | None:
        return self._active_proposals.get(chat_id)

    def set_active(self, *, chat_id: str, proposal: ProjectBootstrapProposal) -> None:
        self._active_proposals[chat_id] = proposal

    def clear_active(self, *, chat_id: str) -> ProjectBootstrapProposal | None:
        return self._active_proposals.pop(chat_id, None)