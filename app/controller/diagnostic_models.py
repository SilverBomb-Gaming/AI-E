"""Structured models for health and security diagnostics."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple


CheckType = Literal["health", "security"]
DiagnosticStatus = Literal["pass", "warn", "fail"]
DiagnosticSeverity = Literal["info", "warning", "error"]
OverallStatus = Literal["ok", "degraded", "blocked", "unknown"]


@dataclass(frozen=True)
class DiagnosticItem:
    check_type: CheckType
    status: DiagnosticStatus
    severity: DiagnosticSeverity
    code: str
    message: str
    recommended_action: str


@dataclass(frozen=True)
class DiagnosticReport:
    check_type: CheckType
    overall_status: OverallStatus
    overall_severity: DiagnosticSeverity
    ran_at: str
    summary: str
    items: Tuple[DiagnosticItem, ...]
