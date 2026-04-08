"""In-memory confirmation registry for one-shot capability approvals."""
from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta
import secrets
import threading
from typing import Literal

from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation


ConfirmationOutcome = Literal[
    "approved",
    "rejected",
    "not_found",
    "wrong_chat",
    "expired",
    "already_used",
]


class ConfirmationStore:
    def __init__(self, *, lifetime_seconds: float = 120.0) -> None:
        self._lifetime_seconds = max(30.0, float(lifetime_seconds))
        self._items: dict[str, PendingConfirmation] = {}
        self._lock = threading.RLock()

    def create(
        self,
        *,
        capability_id: str,
        original_command: str,
        argument_summary: str,
        prompt_text: str,
        response_style: str,
        chat_id: str,
        requester_label: str,
        evaluation_context: ConfirmationContextSnapshot,
        metadata: dict[str, str] | None = None,
    ) -> PendingConfirmation:
        with self._lock:
            self.cleanup_expired()
            confirmation_id = self._generate_id_locked()
            created_at = self._now()
            expires_at = created_at + timedelta(seconds=self._lifetime_seconds)
            confirmation = PendingConfirmation(
                confirmation_id=confirmation_id,
                capability_id=capability_id,
                original_command=original_command,
                argument_summary=argument_summary,
                prompt_text=prompt_text,
                response_style=response_style,
                timestamp_created=created_at.isoformat(timespec="seconds"),
                expires_at=expires_at.isoformat(timespec="seconds"),
                current_state="pending",
                chat_id=chat_id,
                requester_label=requester_label,
                evaluation_context=evaluation_context,
                metadata=dict(metadata or {}),
            )
            self._items[confirmation_id] = confirmation
            return confirmation

    def approve(self, confirmation_id: str, *, chat_id: str) -> tuple[ConfirmationOutcome, PendingConfirmation | None]:
        with self._lock:
            self.cleanup_expired()
            confirmation = self._items.get(confirmation_id.upper())
            if confirmation is None:
                return "not_found", None
            if confirmation.chat_id != chat_id:
                return "wrong_chat", None
            if confirmation.current_state == "expired":
                return "expired", confirmation
            if confirmation.current_state != "pending":
                return "already_used", confirmation
            approved = replace(confirmation, current_state="approved")
            self._items[confirmation_id.upper()] = approved
            return "approved", approved

    def reject(self, confirmation_id: str, *, chat_id: str) -> tuple[ConfirmationOutcome, PendingConfirmation | None]:
        with self._lock:
            self.cleanup_expired()
            confirmation = self._items.get(confirmation_id.upper())
            if confirmation is None:
                return "not_found", None
            if confirmation.chat_id != chat_id:
                return "wrong_chat", None
            if confirmation.current_state == "expired":
                return "expired", confirmation
            if confirmation.current_state != "pending":
                return "already_used", confirmation
            rejected = replace(confirmation, current_state="rejected")
            self._items[confirmation_id.upper()] = rejected
            return "rejected", rejected

    def get(self, confirmation_id: str) -> PendingConfirmation | None:
        with self._lock:
            self.cleanup_expired()
            return self._items.get(confirmation_id.upper())

    def update_metadata(self, confirmation_id: str, *, metadata: dict[str, str]) -> PendingConfirmation | None:
        with self._lock:
            self.cleanup_expired()
            existing = self._items.get(confirmation_id.upper())
            if existing is None:
                return None
            updated = replace(existing, metadata={**existing.metadata, **metadata})
            self._items[confirmation_id.upper()] = updated
            return updated

    def pending_count(self, *, chat_id: str | None = None) -> int:
        with self._lock:
            self.cleanup_expired()
            return sum(
                1
                for confirmation in self._items.values()
                if confirmation.current_state == "pending" and (chat_id is None or confirmation.chat_id == chat_id)
            )

    def cleanup_expired(self) -> int:
        with self._lock:
            now = self._now()
            expired_ids: list[str] = []
            for confirmation_id, confirmation in self._items.items():
                if confirmation.current_state != "pending":
                    continue
                expires_at = self._parse_iso(confirmation.expires_at)
                if expires_at <= now:
                    expired_ids.append(confirmation_id)
            for confirmation_id in expired_ids:
                self._items[confirmation_id] = replace(self._items[confirmation_id], current_state="expired")
            return len(expired_ids)

    def set_lifetime_seconds_for_testing(self, seconds: float) -> None:
        with self._lock:
            self._lifetime_seconds = max(1.0, float(seconds))

    def _generate_id_locked(self) -> str:
        for _ in range(32):
            candidate = secrets.token_hex(3).upper()
            if candidate not in self._items:
                return candidate
        raise RuntimeError("Unable to allocate a unique confirmation id.")

    @staticmethod
    def _now() -> datetime:
        return datetime.now().astimezone()

    @staticmethod
    def _parse_iso(value: str) -> datetime:
        return datetime.fromisoformat(value)
