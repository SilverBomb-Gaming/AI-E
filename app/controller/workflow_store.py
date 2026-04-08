"""Bounded in-memory workflow store for current-session operator workflows."""
from __future__ import annotations

from collections import deque
from dataclasses import replace
import secrets
import threading
from typing import Deque

from .workflow_models import WorkflowRecord


class WorkflowStore:
    def __init__(self, *, max_workflows_per_chat: int = 8) -> None:
        self._max_workflows_per_chat = max(1, int(max_workflows_per_chat))
        self._items_by_id: dict[str, WorkflowRecord] = {}
        self._items_by_chat: dict[str, Deque[str]] = {}
        self._lock = threading.RLock()

    def create(self, record: WorkflowRecord) -> WorkflowRecord:
        with self._lock:
            workflow_id = record.workflow_id.upper()
            stored = replace(record, workflow_id=workflow_id)
            self._items_by_id[workflow_id] = stored
            bucket = self._items_by_chat.setdefault(stored.chat_id, deque())
            bucket.append(workflow_id)
            while len(bucket) > self._max_workflows_per_chat:
                expired_id = bucket.popleft()
                self._items_by_id.pop(expired_id, None)
            return stored

    def update(self, record: WorkflowRecord) -> WorkflowRecord:
        with self._lock:
            workflow_id = record.workflow_id.upper()
            stored = replace(record, workflow_id=workflow_id)
            self._items_by_id[workflow_id] = stored
            bucket = self._items_by_chat.setdefault(stored.chat_id, deque())
            if workflow_id not in bucket:
                bucket.append(workflow_id)
            return stored

    def get(self, workflow_id: str) -> WorkflowRecord | None:
        with self._lock:
            return self._items_by_id.get(workflow_id.strip().upper())

    def latest(self, *, chat_id: str) -> WorkflowRecord | None:
        with self._lock:
            bucket = self._items_by_chat.get(chat_id)
            if not bucket:
                return None
            return self._items_by_id.get(bucket[-1])

    def latest_any(self) -> WorkflowRecord | None:
        with self._lock:
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
            bucket = self._items_by_chat.get(chat_id)
            if not bucket:
                return None
            for workflow_id in reversed(bucket):
                candidate = self._items_by_id.get(workflow_id)
                if candidate is None:
                    continue
                if candidate.current_state in {"running", "waiting_confirmation"}:
                    return candidate
            return None

    def current_any(self) -> WorkflowRecord | None:
        with self._lock:
            current_record: WorkflowRecord | None = None
            for bucket in self._items_by_chat.values():
                for workflow_id in reversed(bucket):
                    candidate = self._items_by_id.get(workflow_id)
                    if candidate is None or candidate.current_state not in {"running", "waiting_confirmation"}:
                        continue
                    if current_record is None or candidate.created_at > current_record.created_at:
                        current_record = candidate
                    break
            return current_record

    @staticmethod
    def generate_id() -> str:
        return f"WF-{secrets.token_hex(3).upper()}"
