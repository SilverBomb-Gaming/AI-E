"""Capability definitions and evaluation models for operator-controlled actions."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple

from ..providers.base import ProviderStatus
from .models import CapabilityAvailabilityState, Mode, Policy, ProviderType, ReadinessState

CapabilityCategory = Literal["operator", "runtime", "provider"]
CapabilityExecutionType = Literal["read", "query"]
CapabilityProviderDependency = Literal["none", "ollama", "openai", "active_provider"]
CapabilityNetworkRequirement = Literal["none", "local", "remote", "conditional"]
CapabilityReadinessRequirement = Literal["none", "ready"]
CapabilityPolicySensitivity = Literal["none", "online_sensitive"]


@dataclass(frozen=True)
class CapabilityDefinition:
    capability_id: str
    name: str
    category: CapabilityCategory
    description: str
    execution_type: CapabilityExecutionType
    provider_dependency: CapabilityProviderDependency
    network_requirement: CapabilityNetworkRequirement
    readiness_requirement: CapabilityReadinessRequirement
    mode_constraints: Tuple[Mode, ...] = ()
    policy_sensitivity: CapabilityPolicySensitivity = "none"
    confirmation_requirement: bool = False


@dataclass(frozen=True)
class CapabilityContext:
    runtime_state: str
    readiness_state: ReadinessState
    mode: Mode
    selected_mode: Mode
    policy: Policy
    active_provider: ProviderType
    selected_provider: ProviderType
    health_status: str
    safety_status: str
    offline_provider_status: ProviderStatus
    online_provider_status: ProviderStatus


@dataclass(frozen=True)
class CapabilityEvaluation:
    capability_id: str
    name: str
    category: CapabilityCategory
    description: str
    execution_type: CapabilityExecutionType
    provider_dependency: CapabilityProviderDependency
    network_requirement: CapabilityNetworkRequirement
    readiness_requirement: CapabilityReadinessRequirement
    mode_constraints: Tuple[Mode, ...]
    policy_sensitivity: CapabilityPolicySensitivity
    confirmation_requirement: bool
    current_availability_state: CapabilityAvailabilityState
    blocking_reason: str
    reason_code: str
    message: str
