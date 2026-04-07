"""Structured execution request and result contracts for capability-driven actions."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .capability_models import (
    CapabilityAccessKind,
    CapabilityConfirmationSensitivity,
    CapabilityLocality,
    CapabilityOfflineSafety,
    CapabilityTelegramExposure,
)
from .confirmation_models import ConfirmationContextSnapshot
from .models import Mode, Policy, ProviderType, ReadinessState
from .scope_models import ExecutionScope

ExecutionSource = Literal["telegram", "desktop"]
ExecutionOutcome = Literal[
    "success",
    "blocked",
    "confirmation_required",
    "denied",
    "expired",
    "unavailable",
    "degraded",
    "failed",
    "timed_out",
    "invalid_request",
    "out_of_scope",
]


@dataclass(frozen=True)
class ProviderExecutionSnapshot:
    active_provider: ProviderType
    selected_provider: ProviderType
    active_provider_state: str
    active_provider_message: str
    active_provider_model: str
    offline_provider_state: str
    offline_provider_message: str
    offline_provider_model: str
    online_provider_state: str
    online_provider_message: str
    online_provider_model: str


@dataclass(frozen=True)
class CapabilityExecutionRequest:
    request_id: str
    capability_id: str
    source: ExecutionSource
    user_id: str
    chat_id: str
    requester_label: str
    original_command: str
    parsed_arguments: dict[str, str]
    invocation_timestamp: str
    mode_snapshot: Mode
    selected_mode_snapshot: Mode
    policy_snapshot: Policy
    provider_snapshot: ProviderExecutionSnapshot
    confirmation_context: ConfirmationContextSnapshot | None
    readiness_snapshot: ReadinessState
    scope: ExecutionScope
    metadata: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True)
class CapabilityExecutionResult:
    request: CapabilityExecutionRequest
    request_id: str
    capability_id: str
    outcome: ExecutionOutcome
    outcome_reason_code: str
    user_message: str
    internal_summary: str
    started_at: str
    finished_at: str
    duration_ms: int
    confirmation_used: bool
    provider_used: str
    mode_used: str
    degraded: bool
    retryable: bool
    access_kind: CapabilityAccessKind
    locality: CapabilityLocality
    offline_safety: CapabilityOfflineSafety
    confirmation_sensitivity: CapabilityConfirmationSensitivity
    telegram_exposure: CapabilityTelegramExposure
    trust_summary: str
    scope_summary: str
    command_label: str
    activity_state: str
    ask_status: str = ""
    hide_content_in_summary: bool = False
    telemetry: dict[str, object] = field(default_factory=dict)
