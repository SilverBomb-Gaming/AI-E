"""Bounded in-memory workflow store for current-session operator workflows."""
from __future__ import annotations

from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta
import secrets
import threading
from typing import Deque

from .workflow_models import ACTIVE_WORKFLOW_STATES, TERMINAL_WORKFLOW_STATES, WorkflowRecord


class WorkflowStore:
    def __init__(self, *, max_workflows_per_chat: int = 8, lifetime_seconds: float = 1800.0) -> None:
        self._max_workflows_per_chat = max(1, int(max_workflows_per_chat))
        self._lifetime_seconds = max(120.0, float(lifetime_seconds))
        self._items_by_id: dict[str, WorkflowRecord] = {}
        self._items_by_chat: dict[str, Deque[str]] = {}
        self._lock = threading.RLock()

    def create(self, record: WorkflowRecord) -> WorkflowRecord:
        with self._lock:
            self._expire_locked()
            workflow_id = record.workflow_id.upper()
            stored = replace(record, workflow_id=workflow_id)
            self._items_by_id[workflow_id] = stored
            bucket = self._items_by_chat.setdefault(stored.chat_id, deque())
            bucket.append(workflow_id)
            self._trim_bucket_locked(stored.chat_id)
            return stored

    def update(self, record: WorkflowRecord) -> WorkflowRecord:
        with self._lock:
            self._expire_locked()
            workflow_id = record.workflow_id.upper()
            stored = replace(record, workflow_id=workflow_id)
            self._items_by_id[workflow_id] = stored
            bucket = self._items_by_chat.setdefault(stored.chat_id, deque())
            if workflow_id not in bucket:
                bucket.append(workflow_id)
            self._trim_bucket_locked(stored.chat_id)
            return stored

    def get(self, workflow_id: str) -> WorkflowRecord | None:
        with self._lock:
            self._expire_locked()
            return self._items_by_id.get(workflow_id.strip().upper())

    def latest(self, *, chat_id: str) -> WorkflowRecord | None:
        with self._lock:
            self._expire_locked()
            bucket = self._items_by_chat.get(chat_id)
            if not bucket:
                return None
            return self._items_by_id.get(bucket[-1])

    def recent(self, *, chat_id: str, limit: int = 5) -> tuple[WorkflowRecord, ...]:
        with self._lock:
            self._expire_locked()
            bucket = self._items_by_chat.get(chat_id)
            if not bucket or limit <= 0:
                return ()
            records = [self._items_by_id[workflow_id] for workflow_id in bucket if workflow_id in self._items_by_id]
            return tuple(reversed(records[-limit:]))

    def resolve(self, *, chat_id: str, reference: str) -> WorkflowRecord | None:
        token = reference.strip().upper()
        if not token:
            return None
        recent_items = self.recent(chat_id=chat_id, limit=self._max_workflows_per_chat)
        if token.isdigit():
            index = int(token)
            if index < 1 or index > len(recent_items):
                return None
            return recent_items[index - 1]
        for item in recent_items:
            if item.workflow_id.upper() == token:
                return item
        return None

    def latest_any(self) -> WorkflowRecord | None:
        with self._lock:
            self._expire_locked()
            latest_record: WorkflowRecord | None = None
            for bucket in self._items_by_chat.values():
                if not bucket:
                    continue
                candidate = self._items_by_id.get(bucket[-1])
                if candidate is None:
                    continue
                if latest_record is None or candidate.created_at > latest_record.created_at:
                    latest_record = candidate
            return latest_record

    def current(self, *, chat_id: str) -> WorkflowRecord | None:
        with self._lock:
            self._expire_locked()
            bucket = self._items_by_chat.get(chat_id)
            if not bucket:
                return None
            for workflow_id in reversed(bucket):
                candidate = self._items_by_id.get(workflow_id)
                if candidate is None:
                    continue
                if candidate.current_state in ACTIVE_WORKFLOW_STATES:
                    return candidate
            return None

    def current_any(self) -> WorkflowRecord | None:
        with self._lock:
            self._expire_locked()
            current_record: WorkflowRecord | None = None
            for bucket in self._items_by_chat.values():
                for workflow_id in reversed(bucket):
                    candidate = self._items_by_id.get(workflow_id)
                    if candidate is None or candidate.current_state not in ACTIVE_WORKFLOW_STATES:
                        continue
                    if current_record is None or candidate.created_at > current_record.created_at:
                        current_record = candidate
                    break
            return current_record

    def cleanup_expired(self) -> tuple[WorkflowRecord, ...]:
        with self._lock:
            return self._expire_locked()

    def set_lifetime_seconds_for_testing(self, seconds: float) -> None:
        with self._lock:
            self._lifetime_seconds = max(1.0, float(seconds))

    def expire_for_testing(self, *, chat_id: str, workflow_id: str) -> bool:
        with self._lock:
            bucket = self._items_by_chat.get(chat_id)
            if bucket is None:
                return False
            key = workflow_id.strip().upper()
            existing = self._items_by_id.get(key)
            if existing is None or existing.chat_id != chat_id:
                return False
            self._items_by_id[key] = replace(existing, expires_at="2000-01-01T00:00:00+00:00")
            return True

    @staticmethod
    def generate_id() -> str:
        return f"WF-{secrets.token_hex(3).upper()}"

    def default_expires_at(self) -> str:
        return (self._now() + timedelta(seconds=self._lifetime_seconds)).isoformat(timespec="seconds")

    def _expire_locked(self) -> tuple[WorkflowRecord, ...]:
        now = self._now()
        expired_records: list[WorkflowRecord] = []
        for workflow_id, record in tuple(self._items_by_id.items()):
            if record.current_state not in ACTIVE_WORKFLOW_STATES:
                continue
            if self._parse_iso(record.expires_at) > now:
                continue
            expired = replace(
                record,
                current_state="expired",
                finished_at=record.finished_at or now.isoformat(timespec="seconds"),
                confirmation_state="expired" if record.confirmation_state == "pending" else record.confirmation_state,
            )
            self._items_by_id[workflow_id] = expired
            expired_records.append(expired)
        return tuple(expired_records)

    def _trim_bucket_locked(self, chat_id: str) -> int:
        bucket = self._items_by_chat.get(chat_id)
        if not bucket:
            return 0
        removed = 0
        while len(bucket) > self._max_workflows_per_chat:
            removable_id = next(
                (
                    workflow_id
                    for workflow_id in bucket
                    if (record := self._items_by_id.get(workflow_id)) is not None and record.current_state == "expired"
                ),
                None,
            )
            if removable_id is None:
                removable_id = next(
                    (
                        workflow_id
                        for workflow_id in bucket
                        if (record := self._items_by_id.get(workflow_id)) is not None and record.current_state in TERMINAL_WORKFLOW_STATES
                    ),
                    None,
                )
            if removable_id is None:
                removable_id = bucket[0]
            bucket.remove(removable_id)
            self._items_by_id.pop(removable_id, None)
            removed += 1
        if not bucket:
            self._items_by_chat.pop(chat_id, None)
        return removed

    @staticmethod
    def _now() -> datetime:
        return datetime.now().astimezone()

    @staticmethod
    def _parse_iso(value: str) -> datetime:
        return datetime.fromisoformat(value)
