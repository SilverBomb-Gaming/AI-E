"""Confirmation state models for one-shot capability escalation."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from .models import Mode, Policy, ProviderType, ReadinessState


ConfirmationState = Literal["pending", "approved", "rejected", "expired"]


@dataclass(frozen=True)
class ConfirmationContextSnapshot:
    mode: Mode
    selected_mode: Mode
    policy: Policy
    active_provider: ProviderType
    selected_provider: ProviderType
    readiness_state: ReadinessState
    provider_state: str
    provider_message: str


@dataclass(frozen=True)
class PendingConfirmation:
    confirmation_id: str
    capability_id: str
    original_command: str
    argument_summary: str
    prompt_text: str
    response_style: str
    timestamp_created: str
    expires_at: str
    current_state: ConfirmationState
    chat_id: str
    requester_label: str
    evaluation_context: ConfirmationContextSnapshot
    metadata: dict[str, str] = field(default_factory=dict)
