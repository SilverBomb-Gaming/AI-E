"""In-memory store for the active generated project per Telegram chat."""
from __future__ import annotations

from .generated_project_models import GeneratedProjectRecord


class GeneratedProjectStore:
    """Track the active isolated generated project for each chat."""

    def __init__(self) -> None:
        self._active_projects: dict[str, GeneratedProjectRecord] = {}

    def get_active(self, *, chat_id: str) -> GeneratedProjectRecord | None:
        return self._active_projects.get(chat_id)

    def set_active(self, *, chat_id: str, project: GeneratedProjectRecord) -> None:
        self._active_projects[chat_id] = project

    def clear_active(self, *, chat_id: str) -> GeneratedProjectRecord | None:
        return self._active_projects.pop(chat_id, None)