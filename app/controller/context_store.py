"""Bounded in-memory store for explicit, per-chat context buffers."""
from __future__ import annotations

from collections import deque
from dataclasses import replace
from datetime import datetime, timedelta
import threading
from typing import Deque

from .context_models import BufferedContext, ContextContentKind, ContextSizeClass
from .scope_models import ScopeType


class ContextStore:
    def __init__(self, *, max_contexts_per_chat: int = 6, lifetime_seconds: float = 1800.0) -> None:
        self._max_contexts_per_chat = max(1, int(max_contexts_per_chat))
        self._lifetime_seconds = max(60.0, float(lifetime_seconds))
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
        user_id: str,
        chat_id: str,
        originating_request_id: str,
    ) -> BufferedContext:
        with self._lock:
            self.cleanup_expired()
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
                user_id=user_id,
                chat_id=chat_id,
                originating_request_id=originating_request_id,
            )
            bucket = self._items.setdefault(chat_id, deque(maxlen=self._max_contexts_per_chat))
            bucket.append(item)
            return item

    def latest(self, *, chat_id: str) -> BufferedContext | None:
        recent = self.recent(chat_id=chat_id, limit=1)
        return recent[0] if recent else None

    def recent(self, *, chat_id: str, limit: int = 5) -> tuple[BufferedContext, ...]:
        with self._lock:
            self.cleanup_expired()
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
            self.cleanup_expired()
            bucket = self._items.get(chat_id)
            if bucket is None:
                return 0
            count = len(bucket)
            bucket.clear()
            self._items.pop(chat_id, None)
            return count

    def count(self, *, chat_id: str) -> int:
        with self._lock:
            self.cleanup_expired()
            bucket = self._items.get(chat_id)
            return len(bucket) if bucket is not None else 0

    def total_count(self) -> int:
        with self._lock:
            self.cleanup_expired()
            return sum(len(bucket) for bucket in self._items.values())

    def latest_any(self) -> BufferedContext | None:
        with self._lock:
            self.cleanup_expired()
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

    def cleanup_expired(self) -> int:
        with self._lock:
            now = self._now()
            removed = 0
            empty_chats: list[str] = []
            for chat_id, bucket in self._items.items():
                kept = [item for item in bucket if self._parse_iso(item.expires_at) > now]
                removed += len(bucket) - len(kept)
                if kept:
                    self._items[chat_id] = deque(kept, maxlen=self._max_contexts_per_chat)
                else:
                    empty_chats.append(chat_id)
            for chat_id in empty_chats:
                self._items.pop(chat_id, None)
            return removed

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
                self._items[chat_id] = deque(updated, maxlen=self._max_contexts_per_chat)
            return replaced

    def _next_context_id_locked(self, chat_id: str) -> str:
        next_value = self._sequence_by_chat.get(chat_id, 0) + 1
        self._sequence_by_chat[chat_id] = next_value
        return f"C{next_value}"

    @staticmethod
    def _now() -> datetime:
        return datetime.now().astimezone()

    @staticmethod
    def _parse_iso(value: str) -> datetime:
        return datetime.fromisoformat(value)
