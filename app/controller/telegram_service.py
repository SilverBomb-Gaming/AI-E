"""Telegram channel validation and connection testing."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime
import json
from typing import Callable
import urllib.error
import urllib.parse
import urllib.request

from ..platform.secrets import SecretStore
from .channel_models import TelegramChannelStatus


def mask_telegram_token(token: str) -> str:
    trimmed = token.strip()
    if not trimmed:
        return ""
    if ":" not in trimmed:
        if len(trimmed) <= 8:
            return "*" * max(4, len(trimmed))
        return f"{trimmed[:4]}...{trimmed[-4:]}"
    bot_id, secret = trimmed.split(":", 1)
    if len(secret) <= 6:
        return f"{bot_id}:***"
    return f"{bot_id}:{secret[:2]}***{secret[-2:]}"


class TelegramApiError(RuntimeError):
    """Raised when Telegram API validation fails."""


@dataclass(frozen=True)
class TelegramBotIdentity:
    bot_id: str
    username: str
    display_name: str


class TelegramApiClient:
    def __init__(self, request_json: Callable[[str], dict[str, object]] | None = None) -> None:
        self._request_json = request_json or self._default_request_json

    def get_me(self, token: str) -> TelegramBotIdentity:
        safe_token = urllib.parse.quote(token, safe=":_-")
        payload = self._request_json(f"https://api.telegram.org/bot{safe_token}/getMe")
        if not isinstance(payload, dict):
            raise TelegramApiError("Telegram API returned an invalid response.")
        if not payload.get("ok"):
            description = str(payload.get("description") or "Telegram API rejected the bot token.")
            raise TelegramApiError(description)
        result = payload.get("result")
        if not isinstance(result, dict):
            raise TelegramApiError("Telegram API did not return bot metadata.")
        bot_id = str(result.get("id") or "")
        username = str(result.get("username") or "")
        display_name = str(result.get("first_name") or result.get("name") or "")
        if not (bot_id or username or display_name):
            raise TelegramApiError("Telegram API returned incomplete bot metadata.")
        return TelegramBotIdentity(bot_id=bot_id, username=username, display_name=display_name)

    @staticmethod
    def _default_request_json(url: str) -> dict[str, object]:
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=4.0) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except (ValueError, OSError):
                payload = {}
            description = str(payload.get("description") or f"Telegram API returned HTTP {exc.code}.")
            raise TelegramApiError(description) from None
        except urllib.error.URLError:
            raise TelegramApiError("Telegram API could not be reached from this machine.") from None
        except (OSError, TimeoutError, ValueError):
            raise TelegramApiError("Telegram API returned an unreadable response.") from None


class TelegramChannelService:
    def __init__(self, api_client: TelegramApiClient | None = None) -> None:
        self._api_client = api_client or TelegramApiClient()

    def validate(
        self,
        *,
        secret_store: SecretStore,
        secret_id: str,
        transient_token: str = "",
    ) -> TelegramChannelStatus:
        source = "provided" if transient_token.strip() else "stored"
        token = transient_token.strip() or secret_store.get_secret(secret_id).strip()
        masked = mask_telegram_token(token)
        if not token:
            return TelegramChannelStatus(
                configured=False,
                token_present=False,
                token_masked="",
                validation_state="invalid",
                available=False,
                ready=False,
                message="Telegram is not configured. Save a bot token before validating the channel.",
            )

        if not self._looks_like_token(token):
            return TelegramChannelStatus(
                configured=True,
                token_present=True,
                token_masked=masked,
                validation_state="invalid",
                available=False,
                ready=False,
                message=f"The {source} Telegram bot token does not match the expected format.",
            )

        try:
            identity = self._api_client.get_me(token)
        except TelegramApiError as exc:
            message = str(exc)
            validation_state = "partial" if "could not be reached" in message.lower() or "unreadable response" in message.lower() else "invalid"
            return TelegramChannelStatus(
                configured=True,
                token_present=True,
                token_masked=masked,
                validation_state=validation_state,
                available=validation_state != "partial",
                ready=False,
                message=message,
            )

        identity_label = f"@{identity.username}" if identity.username else (identity.display_name or f"Bot {identity.bot_id}")
        message = f"Telegram bot {identity_label} authenticated successfully."
        if source == "provided":
            message = f"{message} Save Telegram Settings to store the token."
        return TelegramChannelStatus(
            configured=True,
            token_present=True,
            token_masked=masked,
            validation_state="valid",
            available=True,
            ready=True,
            message=message,
            bot_id=identity.bot_id,
            bot_username=identity.username,
            bot_display_name=identity.display_name,
        )

    def test_connection(
        self,
        *,
        secret_store: SecretStore,
        secret_id: str,
        existing_status: TelegramChannelStatus | None = None,
    ) -> TelegramChannelStatus:
        validated = self.validate(secret_store=secret_store, secret_id=secret_id, transient_token="")
        ran_at = datetime.now().astimezone().isoformat(timespec="seconds")
        if validated.ready:
            return replace(
                validated,
                last_test_result="passed",
                last_test_message=f"Telegram connection test passed for {validated.identity_label}.",
                last_test_at=ran_at,
            )
        fallback = existing_status or TelegramChannelStatus()
        return replace(
            validated,
            last_test_result="failed",
            last_test_message=validated.message or fallback.last_test_message,
            last_test_at=ran_at,
        )

    @staticmethod
    def _looks_like_token(token: str) -> bool:
        trimmed = token.strip()
        if ":" not in trimmed:
            return False
        bot_id, secret = trimmed.split(":", 1)
        return bot_id.isdigit() and len(bot_id) >= 6 and len(secret) >= 20
