"""Bounded in-memory store for explicit, per-chat context buffers."""
from __future__ import annotations

from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta
import threading
from typing import Deque

from .context_models import BufferedContext, ContextContentKind, ContextFreshnessState, ContextSizeClass
from .scope_models import ScopeType


class ContextStore:
    def __init__(
        self,
        *,
        max_contexts_per_chat: int = 6,
        lifetime_seconds: float = 1800.0,
        stale_after_seconds: float | None = None,
    ) -> None:
        self._max_contexts_per_chat = max(1, int(max_contexts_per_chat))
        self._lifetime_seconds = max(60.0, float(lifetime_seconds))
        configured_stale_after = stale_after_seconds if stale_after_seconds is not None else self._lifetime_seconds * 0.75
        self._stale_after_seconds = min(max(60.0, float(configured_stale_after)), self._lifetime_seconds - 1.0)
        self._items: dict[str, Deque[BufferedContext]] = {}
        self._sequence_by_chat: dict[str, int] = {}
        self._lock = threading.RLock()

    def create(
        self,
        *,
        source_capability_id: str,
        source_command: str,
        scope_type: ScopeType,
        source_summary: str,
        content_kind: ContextContentKind,
        content_preview: str,
        normalized_content: str,
        size_class: ContextSizeClass,
        truncated: bool = False,
        trust_summary: str = "",
        user_id: str,
        chat_id: str,
        originating_request_id: str,
    ) -> BufferedContext:
        with self._lock:
            created_at = self._now()
            expires_at = created_at + timedelta(seconds=self._lifetime_seconds)
            next_id = self._next_context_id_locked(chat_id)
            item = BufferedContext(
                context_id=next_id,
                source_capability_id=source_capability_id,
                source_command=source_command,
                created_at=created_at.isoformat(timespec="seconds"),
                expires_at=expires_at.isoformat(timespec="seconds"),
                scope_type=scope_type,
                source_summary=source_summary,
                content_kind=content_kind,
                content_preview=content_preview,
                normalized_content=normalized_content,
                size_class=size_class,
                truncated=truncated,
                trust_summary=trust_summary,
                user_id=user_id,
                chat_id=chat_id,
                originating_request_id=originating_request_id,
            )
            bucket = self._items.setdefault(chat_id, deque())
            bucket.append(item)
            self._trim_bucket_locked(chat_id)
            return item

    def latest(self, *, chat_id: str) -> BufferedContext | None:
        return self.current(chat_id=chat_id)

    def current(self, *, chat_id: str) -> BufferedContext | None:
        with self._lock:
            bucket = self._items.get(chat_id)
            if bucket is None:
                return None
            for item in reversed(bucket):
                if self.freshness_of(item) != "expired":
                    return item
            return None

    def recent(self, *, chat_id: str, limit: int = 5) -> tuple[BufferedContext, ...]:
        with self._lock:
            bucket = self._items.get(chat_id)
            if bucket is None or limit <= 0:
                return ()
            return tuple(reversed(list(bucket)[-limit:]))

    def resolve(self, *, chat_id: str, reference: str) -> BufferedContext | None:
        token = reference.strip().upper()
        if not token:
            return None
        recent_items = self.recent(chat_id=chat_id, limit=self._max_contexts_per_chat)
        if token.isdigit():
            index = int(token)
            if index < 1 or index > len(recent_items):
                return None
            return recent_items[index - 1]
        for item in recent_items:
            if item.context_id.upper() == token:
                return item
        return None

    def clear(self, *, chat_id: str) -> int:
        with self._lock:
            bucket = self._items.get(chat_id)
            if bucket is None:
                return 0
            count = len(bucket)
            bucket.clear()
            self._items.pop(chat_id, None)
            return count

    def count(self, *, chat_id: str) -> int:
        with self._lock:
            bucket = self._items.get(chat_id)
            return len(bucket) if bucket is not None else 0

    def total_count(self) -> int:
        with self._lock:
            return sum(len(bucket) for bucket in self._items.values())

    def latest_any(self) -> BufferedContext | None:
        with self._lock:
            newest: BufferedContext | None = None
            newest_time: datetime | None = None
            for bucket in self._items.values():
                if not bucket:
                    continue
                candidate = bucket[-1]
                candidate_time = self._parse_iso(candidate.created_at)
                if newest_time is None or candidate_time > newest_time:
                    newest = candidate
                    newest_time = candidate_time
            return newest

    def current_any(self) -> BufferedContext | None:
        with self._lock:
            newest: BufferedContext | None = None
            newest_time: datetime | None = None
            for bucket in self._items.values():
                for candidate in reversed(bucket):
                    if self.freshness_of(candidate) == "expired":
                        continue
                    candidate_time = self._parse_iso(candidate.created_at)
                    if newest_time is None or candidate_time > newest_time:
                        newest = candidate
                        newest_time = candidate_time
                    break
            return newest

    def cleanup_expired(self) -> int:
        with self._lock:
            removed = 0
            for chat_id in tuple(self._items.keys()):
                removed += self._trim_bucket_locked(chat_id)
            return removed

    def freshness_of(self, item: BufferedContext) -> ContextFreshnessState:
        now = self._now()
        expires_at = self._parse_iso(item.expires_at)
        if expires_at <= now:
            return "expired"
        created_at = self._parse_iso(item.created_at)
        age_seconds = max(0.0, (now - created_at).total_seconds())
        if age_seconds >= self._stale_after_seconds:
            return "stale"
        return "active"

    def age_seconds(self, item: BufferedContext) -> float:
        return max(0.0, (self._now() - self._parse_iso(item.created_at)).total_seconds())

    def remaining_seconds(self, item: BufferedContext) -> float:
        return max(0.0, (self._parse_iso(item.expires_at) - self._now()).total_seconds())

    def expire_for_testing(self, *, chat_id: str, context_id: str) -> bool:
        with self._lock:
            bucket = self._items.get(chat_id)
            if bucket is None:
                return False
            replaced = False
            updated: list[BufferedContext] = []
            for item in bucket:
                if item.context_id.upper() == context_id.upper():
                    updated.append(
                        replace(
                            item,
                            expires_at="2000-01-01T00:00:00+00:00",
                        )
                    )
                    replaced = True
                else:
                    updated.append(item)
            if replaced:
                self._items[chat_id] = deque(updated)
            return replaced

    def set_age_for_testing(self, *, chat_id: str, context_id: str, age_seconds: float) -> bool:
        with self._lock:
            bucket = self._items.get(chat_id)
            if bucket is None:
                return False
            now = self._now()
            created_at = now - timedelta(seconds=max(0.0, float(age_seconds)))
            remaining_seconds = max(0.0, self._lifetime_seconds - max(0.0, float(age_seconds)))
            expires_at = now + timedelta(seconds=remaining_seconds)
            if age_seconds >= self._lifetime_seconds:
                expires_at = now - timedelta(seconds=1.0)
            replaced = False
            updated: list[BufferedContext] = []
            for item in bucket:
                if item.context_id.upper() == context_id.upper():
                    updated.append(
                        replace(
                            item,
                            created_at=created_at.isoformat(timespec="seconds"),
                            expires_at=expires_at.isoformat(timespec="seconds"),
                        )
                    )
                    replaced = True
                else:
                    updated.append(item)
            if replaced:
                self._items[chat_id] = deque(updated)
            return replaced

    def _next_context_id_locked(self, chat_id: str) -> str:
        next_value = self._sequence_by_chat.get(chat_id, 0) + 1
        self._sequence_by_chat[chat_id] = next_value
        return f"C{next_value}"

    def _trim_bucket_locked(self, chat_id: str) -> int:
        bucket = self._items.get(chat_id)
        if bucket is None:
            return 0
        removed = 0
        while len(bucket) > self._max_contexts_per_chat:
            expired_index = next((index for index, item in enumerate(bucket) if self.freshness_of(item) == "expired"), None)
            if expired_index is None:
                bucket.popleft()
            else:
                del bucket[expired_index]
            removed += 1
        if not bucket:
            self._items.pop(chat_id, None)
        return removed

    @staticmethod
    def _now() -> datetime:
        return datetime.now().astimezone()

    @staticmethod
    def _parse_iso(value: str) -> datetime:
        return datetime.fromisoformat(value)
