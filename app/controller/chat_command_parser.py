"""Shared slash-command and plain-text parser for chat surfaces."""
from __future__ import annotations

from dataclasses import dataclass

from .command_grammar import SUPPORTED_COMMANDS, usage_hint_for_prefix


@dataclass(frozen=True)
class ParsedChatCommand:
    command_label: str
    argument: str = ""
    normalized_text: str = ""
    usage_hint: str = ""


def parse_chat_command(*, text: str, has_text: bool = True) -> ParsedChatCommand:
    if not has_text:
        return ParsedChatCommand(command_label="non_text")
    stripped = text.strip()
    if not stripped:
        return ParsedChatCommand(command_label="plain_text")
    if not stripped.startswith("/"):
        return ParsedChatCommand(command_label="plain_text", normalized_text=" ".join(stripped.split()))
    parts = stripped.split(None, 1)
    command_token = parts[0]
    argument = parts[1].strip() if len(parts) > 1 else ""
    command = command_token.split("@", 1)[0].lower()
    normalized_text = " ".join(stripped.split())
    if command in SUPPORTED_COMMANDS:
        return ParsedChatCommand(command_label=command, argument=argument, normalized_text=normalized_text)
    return ParsedChatCommand(command_label="parse_failure", normalized_text=normalized_text, usage_hint=usage_hint_for_prefix(command))