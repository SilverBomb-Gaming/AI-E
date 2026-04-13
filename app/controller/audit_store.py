"""Bounded in-memory audit store for recent capability executions."""
from __future__ import annotations

from collections import deque
from typing import Deque

from .audit_models import AuditRecord


class AuditStore:
    """Append-only, bounded audit record store."""

    def __init__(self, *, max_records: int = 50) -> None:
        self._items: Deque[AuditRecord] = deque(maxlen=max_records)

    @property
    def max_records(self) -> int:
        return self._items.maxlen or 0

    def append(self, record: AuditRecord) -> None:
        self._items.append(record)

    def recent(self, *, limit: int = 5) -> tuple[AuditRecord, ...]:
        items = list(self._items)
        if limit <= 0:
            return ()
        return tuple(reversed(items[-limit:]))

    def latest(self) -> AuditRecord | None:
        if not self._items:
            return None
        return self._items[-1]

    def __len__(self) -> int:
        return len(self._items)
