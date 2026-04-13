"""Audit record models for capability executions."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AuditRecord:
    audit_id: str
    request_id: str
    capability_id: str
    timestamp_start: str
    timestamp_end: str
    outcome: str
    outcome_reason: str
    user_id: str
    chat_id: str
    confirmation_used: bool
    scope_summary: str
    provider_used: str
    duration_ms: int
    action_summary: str
    exit_code: int | None = None
    output_summary: str = ""
