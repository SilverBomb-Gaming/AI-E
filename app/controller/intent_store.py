"""In-memory store for active translation drafts per Telegram chat."""
from __future__ import annotations

from .intent_models import IntentTranslationSession


class IntentStore:
    """Track the active translation draft for each chat."""

    def __init__(self) -> None:
        self._active_sessions: dict[str, IntentTranslationSession] = {}

    def get_active(self, *, chat_id: str) -> IntentTranslationSession | None:
        session = self._active_sessions.get(chat_id)
        if session is None or session.state == "archived":
            return None
        return session

    def set_active(self, *, chat_id: str, session: IntentTranslationSession) -> None:
        self._active_sessions[chat_id] = session

    def archive_active(self, *, chat_id: str, archived_session: IntentTranslationSession) -> IntentTranslationSession | None:
        existing = self._active_sessions.get(chat_id)
        if existing is None:
            return None
        self._active_sessions.pop(chat_id, None)
        return archived_session