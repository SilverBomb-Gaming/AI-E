"""Capability manifest and evaluation models for operator-controlled actions."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple

from ..providers.base import ProviderStatus
from .models import CapabilityAvailabilityState, Mode, Policy, ProviderType, ReadinessState
from .scope_models import ScopeAccessMode, ScopeType

CapabilityCategory = Literal["operator", "runtime", "provider", "repository", "filesystem", "web", "intent", "planning"]
CapabilityExecutionType = Literal["read", "query"]
CapabilityProviderDependency = Literal["none", "ollama", "openai", "active_provider"]
CapabilityNetworkRequirement = Literal["none", "local", "remote", "conditional"]
CapabilityPolicySensitivity = Literal["none", "online_sensitive"]
CapabilityInvocationSource = Literal["telegram", "desktop"]
CapabilityAccessKind = Literal["read_only", "mutating", "external_side_effect"]
CapabilityLocality = Literal["local_only", "networked", "hybrid"]
CapabilityDataScope = Literal["internal_state", "provider_query", "file_system", "repository", "web", "other"]
CapabilityOfflineSafety = Literal["safe_offline", "requires_online", "optional_online"]
CapabilityConfirmationSensitivity = Literal["never", "policy_based", "always"]
CapabilityTelegramExposure = Literal["allowed", "limited", "denied"]


@dataclass(frozen=True)
class CapabilityManifest:
    capability_id: str
    name: str
    category: CapabilityCategory
    short_description: str
    execution_type: CapabilityExecutionType
    provider_dependency: CapabilityProviderDependency
    network_requirement: CapabilityNetworkRequirement
    requires_runtime: bool
    requires_readiness: bool
    access_kind: CapabilityAccessKind
    locality: CapabilityLocality
    data_scope: CapabilityDataScope
    offline_safety: CapabilityOfflineSafety
    confirmation_sensitivity: CapabilityConfirmationSensitivity
    telegram_exposure: CapabilityTelegramExposure
    mode_constraints: Tuple[Mode, ...] = ()
    policy_sensitivity: CapabilityPolicySensitivity = "none"
    supports_timeout: bool = False
    supports_confirmation: bool = False
    supports_degraded_mode: bool = False
    default_timeout_ms: int = 0
    cooldown_sensitive: bool = False
    user_visible: bool = True
    include_in_capabilities_summary: bool = True
    scope_type: ScopeType = "internal"
    access_mode: ScopeAccessMode = "read"
    scope_allowed_paths: Tuple[str, ...] = ()
    scope_domain_allowlist: Tuple[str, ...] = ()
    scope_repo_root: str = ""
    scope_uses_configured_root: bool = False
    scope_uses_configured_paths: bool = False
    scope_uses_configured_domains: bool = False

    @property
    def description(self) -> str:
        return self.short_description

    @property
    def confirmation_requirement(self) -> bool:
        return self.confirmation_sensitivity != "never"


CapabilityDefinition = CapabilityManifest


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
    repo_root: str = ""
    repo_root_valid: bool = False
    repo_message: str = ""
    file_allowed_roots: Tuple[str, ...] = ()
    file_scope_valid: bool = False
    file_message: str = ""
    web_allowed_domains: Tuple[str, ...] = ()
    web_scope_valid: bool = False
    web_message: str = ""
    network_readiness_state: ReadinessState = "ready"
    network_readiness_message: str = ""


@dataclass(frozen=True)
class CapabilityEvaluation:
    capability_id: str
    name: str
    category: CapabilityCategory
    short_description: str
    execution_type: CapabilityExecutionType
    provider_dependency: CapabilityProviderDependency
    network_requirement: CapabilityNetworkRequirement
    requires_runtime: bool
    requires_readiness: bool
    mode_constraints: Tuple[Mode, ...]
    policy_sensitivity: CapabilityPolicySensitivity
    access_kind: CapabilityAccessKind
    locality: CapabilityLocality
    data_scope: CapabilityDataScope
    offline_safety: CapabilityOfflineSafety
    confirmation_sensitivity: CapabilityConfirmationSensitivity
    telegram_exposure: CapabilityTelegramExposure
    supports_timeout: bool
    supports_confirmation: bool
    supports_degraded_mode: bool
    default_timeout_ms: int
    cooldown_sensitive: bool
    user_visible: bool
    include_in_capabilities_summary: bool
    scope_type: ScopeType
    access_mode: ScopeAccessMode
    invocation_source: CapabilityInvocationSource
    current_availability_state: CapabilityAvailabilityState
    blocking_reason: str
    reason_code: str
    message: str

    @property
    def description(self) -> str:
        return self.short_description

    @property
    def confirmation_requirement(self) -> bool:
        return self.confirmation_sensitivity != "never"
