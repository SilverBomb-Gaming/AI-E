"""Temporary, explicit context buffer models for safe context reuse."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .scope_models import ScopeType


ContextContentKind = Literal["repo_summary", "file_preview", "web_preview"]
ContextSizeClass = Literal["small", "truncated", "large", "summary"]
ContextFreshnessState = Literal["active", "stale", "expired"]


@dataclass(frozen=True)
class BufferedContext:
    context_id: str
    source_capability_id: str
    source_command: str
    created_at: str
    expires_at: str
    scope_type: ScopeType
    source_summary: str
    content_kind: ContextContentKind
    content_preview: str
    normalized_content: str
    size_class: ContextSizeClass
    truncated: bool
    trust_summary: str
    user_id: str
    chat_id: str
    originating_request_id: str

    @property
    def summary_label(self) -> str:
        return f"{self.context_id} {self.source_capability_id} {self.source_summary}".strip()

    @property
    def source_type_label(self) -> str:
        return {
            "repo_summary": "repo",
            "file_preview": "file",
            "web_preview": "web",
        }.get(self.content_kind, self.content_kind)
