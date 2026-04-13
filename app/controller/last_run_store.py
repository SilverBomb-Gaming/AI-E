"""In-memory store for the most recent approved run result per Telegram chat."""
from __future__ import annotations

from .last_run_models import LastRunRecord


class LastRunStore:
    """Track the latest approved run result for each chat."""

    def __init__(self) -> None:
        self._records: dict[str, LastRunRecord] = {}

    def get_latest(self, *, chat_id: str) -> LastRunRecord | None:
        return self._records.get(chat_id)

    def set_latest(self, *, chat_id: str, record: LastRunRecord) -> None:
        self._records[chat_id] = record

    def clear_latest(self, *, chat_id: str) -> LastRunRecord | None:
        return self._records.pop(chat_id, None)