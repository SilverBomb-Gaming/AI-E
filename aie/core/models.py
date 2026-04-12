from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class IntentSpec:
    raw_request: str
    goal: str | None = None
    engine_target: str | None = None
    platform_target: str | None = None
    scope: str | None = None
    features: tuple[str, ...] = ()
    tone: str | None = None
    constraints: tuple[str, ...] = ()
    missing_fields: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ConstraintReport:
    supported: bool
    engine_target: str | None = None
    warnings: tuple[str, ...] = ()
    blocked_actions: tuple[str, ...] = ()
    ambiguities: tuple[str, ...] = ()
    missing_inputs: tuple[str, ...] = ()
    guardrail_notes: tuple[str, ...] = ()
    status: str = "bounded_draft_only"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ExecutionPlan:
    status: str
    summary: str
    bounded: bool
    engine_target: str | None = None
    tasks: tuple[dict[str, Any], ...] = ()
    file_operations: tuple[dict[str, Any], ...] = ()
    verification_steps: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    codex_handoff_ready: bool = False
    limitations: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
