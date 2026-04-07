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


@dataclass(frozen=True)
class TelegramInboundMessage:
    update_id: int
    chat_id: str
    text: str
    sender_label: str
    message_id: int = 0
    has_text: bool = True

    @property
    def summary(self) -> str:
        if self.has_text and self.text.strip():
            return f"{self.sender_label}: {self.text.strip()}"
        return f"{self.sender_label}: [non-text message]"


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

    def get_updates(self, token: str, *, offset: int = 0, timeout: int = 2) -> tuple[TelegramInboundMessage, ...]:
        payload = self._call(token, "getUpdates", {"offset": str(offset), "timeout": str(timeout)})
        result = payload.get("result")
        if not isinstance(result, list):
            raise TelegramApiError("Telegram API did not return an updates list.")
        updates: list[TelegramInboundMessage] = []
        for raw_update in result:
            if not isinstance(raw_update, dict):
                continue
            try:
                update_id = int(raw_update.get("update_id"))
            except (TypeError, ValueError):
                continue
            message = raw_update.get("message")
            if not isinstance(message, dict):
                continue
            chat = message.get("chat")
            if not isinstance(chat, dict):
                continue
            chat_id = str(chat.get("id") or "").strip()
            if not chat_id:
                continue
            sender = message.get("from")
            sender_label = self._sender_label(sender, chat)
            text = str(message.get("text") or "")
            has_text = bool(text.strip())
            try:
                message_id = int(message.get("message_id", 0) or 0)
            except (TypeError, ValueError):
                message_id = 0
            updates.append(
                TelegramInboundMessage(
                    update_id=update_id,
                    chat_id=chat_id,
                    text=text,
                    sender_label=sender_label,
                    message_id=message_id,
                    has_text=has_text,
                )
            )
        return tuple(updates)

    def send_text(self, token: str, *, chat_id: str, text: str) -> int:
        payload = self._call(
            token,
            "sendMessage",
            {
                "chat_id": chat_id,
                "text": text,
                "disable_web_page_preview": "true",
            },
        )
        result = payload.get("result")
        if not isinstance(result, dict):
            raise TelegramApiError("Telegram API did not confirm the outbound message.")
        try:
            return int(result.get("message_id", 0) or 0)
        except (TypeError, ValueError):
            return 0

    def _call(self, token: str, method_name: str, params: dict[str, str]) -> dict[str, object]:
        safe_token = urllib.parse.quote(token, safe=":_-")
        query = urllib.parse.urlencode(params)
        payload = self._request_json(f"https://api.telegram.org/bot{safe_token}/{method_name}?{query}")
        if not isinstance(payload, dict):
            raise TelegramApiError("Telegram API returned an invalid response.")
        if not payload.get("ok"):
            description = str(payload.get("description") or "Telegram API rejected the request.")
            raise TelegramApiError(description)
        return payload

    @staticmethod
    def _sender_label(sender: object, chat: dict[str, object]) -> str:
        if isinstance(sender, dict):
            username = str(sender.get("username") or "").strip()
            if username:
                return f"@{username}"
            first_name = str(sender.get("first_name") or "").strip()
            last_name = str(sender.get("last_name") or "").strip()
            full_name = " ".join(part for part in (first_name, last_name) if part)
            if full_name:
                return full_name
        title = str(chat.get("title") or "").strip()
        if title:
            return title
        return f"chat {chat.get('id', '?')}"

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

    def get_updates(
        self,
        *,
        secret_store: SecretStore,
        secret_id: str,
        offset: int = 0,
        timeout: int = 2,
    ) -> tuple[TelegramInboundMessage, ...]:
        token = secret_store.get_secret(secret_id).strip()
        if not token:
            raise TelegramApiError("Telegram bot token is not configured.")
        if not self._looks_like_token(token):
            raise TelegramApiError("Stored Telegram bot token format is invalid.")
        return self._api_client.get_updates(token, offset=offset, timeout=timeout)

    def send_text(
        self,
        *,
        secret_store: SecretStore,
        secret_id: str,
        chat_id: str,
        text: str,
    ) -> int:
        token = secret_store.get_secret(secret_id).strip()
        if not token:
            raise TelegramApiError("Telegram bot token is not configured.")
        if not self._looks_like_token(token):
            raise TelegramApiError("Stored Telegram bot token format is invalid.")
        return self._api_client.send_text(token, chat_id=chat_id, text=text)

    @staticmethod
    def _looks_like_token(token: str) -> bool:
        trimmed = token.strip()
        if ":" not in trimmed:
            return False
        bot_id, secret = trimmed.split(":", 1)
        return bot_id.isdigit() and len(bot_id) >= 6 and len(secret) >= 20
