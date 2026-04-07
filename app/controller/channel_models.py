"""Channel-side state models for daily-use integrations."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from .models import ValidationState


TelegramTestResult = Literal["not_run", "passed", "failed"]
TelegramLoopState = Literal["stopped", "starting", "running", "error"]


@dataclass(frozen=True)
class TelegramChannelStatus:
    configured: bool = False
    token_present: bool = False
    token_masked: str = ""
    validation_state: ValidationState = "unknown"
    available: bool = False
    ready: bool = False
    message: str = "Telegram has not been configured yet."
    bot_id: str = ""
    bot_username: str = ""
    bot_display_name: str = ""
    last_test_result: TelegramTestResult = "not_run"
    last_test_message: str = "Telegram connection test has not been run yet."
    last_test_at: str = ""

    @property
    def identity_label(self) -> str:
        if self.bot_username:
            return f"@{self.bot_username}"
        if self.bot_display_name:
            return self.bot_display_name
        if self.bot_id:
            return f"Bot {self.bot_id}"
        return "Unknown"

    def as_payload(self) -> dict[str, object]:
        return {
            "configured": self.configured,
            "token_present": self.token_present,
            "token_masked": self.token_masked,
            "validation_state": self.validation_state,
            "available": self.available,
            "ready": self.ready,
            "message": self.message,
            "bot_id": self.bot_id,
            "bot_username": self.bot_username,
            "bot_display_name": self.bot_display_name,
            "last_test_result": self.last_test_result,
            "last_test_message": self.last_test_message,
            "last_test_at": self.last_test_at,
        }

    @classmethod
    def from_payload(cls, raw: dict[str, Any] | None) -> "TelegramChannelStatus":
        if not isinstance(raw, dict):
            return cls()
        return cls(
            configured=bool(raw.get("configured", False)),
            token_present=bool(raw.get("token_present", False)),
            token_masked=str(raw.get("token_masked", "")),
            validation_state=str(raw.get("validation_state", "unknown")),  # type: ignore[arg-type]
            available=bool(raw.get("available", False)),
            ready=bool(raw.get("ready", False)),
            message=str(raw.get("message", "Telegram has not been configured yet.")),
            bot_id=str(raw.get("bot_id", "")),
            bot_username=str(raw.get("bot_username", "")),
            bot_display_name=str(raw.get("bot_display_name", "")),
            last_test_result=str(raw.get("last_test_result", "not_run")),  # type: ignore[arg-type]
            last_test_message=str(raw.get("last_test_message", "Telegram connection test has not been run yet.")),
            last_test_at=str(raw.get("last_test_at", "")),
        )


@dataclass(frozen=True)
class TelegramLoopStatus:
    state: TelegramLoopState = "stopped"
    message: str = "Telegram loop is stopped."
    last_activity_at: str = ""
    last_success_at: str = ""
    last_inbound_summary: str = "No inbound Telegram activity yet."
    last_outbound_summary: str = "No outbound Telegram activity yet."
