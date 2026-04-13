"""Helpers for reducing accidental secret leakage in runtime logs."""
from __future__ import annotations

import re


LOG_REDACTION_ENABLED = True
_OPENAI_KEY_PATTERN = re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b")
_TELEGRAM_TOKEN_PATTERN = re.compile(r"\b\d{6,}:[A-Za-z0-9_-]{20,}\b")
_KEY_VALUE_PATTERN = re.compile(r"(?i)\b(api[_-]?key|token|password)\b(\s*[:=]\s*)([^\s,;]+)")


def sanitize_log_text(value: str) -> str:
    redacted = _OPENAI_KEY_PATTERN.sub(_mask_openai_key, value)
    redacted = _TELEGRAM_TOKEN_PATTERN.sub(_mask_telegram_token, redacted)
    redacted = _KEY_VALUE_PATTERN.sub(_mask_key_value, redacted)
    return redacted


def contains_potential_secret(value: str) -> bool:
    return bool(_OPENAI_KEY_PATTERN.search(value) or _TELEGRAM_TOKEN_PATTERN.search(value))


def _mask_openai_key(match: re.Match[str]) -> str:
    token = match.group(0)
    if len(token) <= 10:
        return "*" * len(token)
    return f"{token[:6]}...{token[-4:]}"


def _mask_key_value(match: re.Match[str]) -> str:
    label, separator, raw_value = match.groups()
    masked_value = "***" if len(raw_value) <= 8 else f"{raw_value[:2]}***{raw_value[-2:]}"
    return f"{label}{separator}{masked_value}"


def _mask_telegram_token(match: re.Match[str]) -> str:
    token = match.group(0)
    bot_id, secret = token.split(":", 1)
    if len(secret) <= 6:
        return f"{bot_id}:***"
    return f"{bot_id}:{secret[:2]}***{secret[-2:]}"
