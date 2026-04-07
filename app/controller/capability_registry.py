"""Manifest-backed capability registry and validation helpers."""
from __future__ import annotations

from .capability_models import CapabilityManifest


class CapabilityManifestError(ValueError):
    """Raised when capability manifest definitions are invalid."""


CAPABILITY_MANIFESTS: tuple[CapabilityManifest, ...] = (
    CapabilityManifest(
        capability_id="telegram.non_text",
        name="Telegram Non-Text",
        category="operator",
        short_description="Reject unsupported non-text Telegram messages.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        user_visible=False,
        include_in_capabilities_summary=False,
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="telegram.parse_failure",
        name="Telegram Parse Failure",
        category="operator",
        short_description="Return a safe correction for malformed Telegram commands.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        user_visible=False,
        include_in_capabilities_summary=False,
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="telegram.plain_text",
        name="Telegram Plain Text",
        category="operator",
        short_description="Handle generic Telegram plain text without implicit provider execution.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        user_visible=False,
        include_in_capabilities_summary=False,
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="telegram.unknown",
        name="Telegram Unknown Command",
        category="operator",
        short_description="Reject unsupported Telegram commands with a short correction.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        user_visible=False,
        include_in_capabilities_summary=False,
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="help.read",
        name="Help",
        category="operator",
        short_description="Show the supported Telegram operator commands.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="status.read",
        name="Status",
        category="runtime",
        short_description="Read runtime, health, security, readiness, and loop status.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="mode.read",
        name="Mode",
        category="operator",
        short_description="Read the selected mode, policy, provider, and remote-use gate.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="models.read",
        name="Models",
        category="provider",
        short_description="List locally available Ollama models for offline use.",
        execution_type="read",
        provider_dependency="ollama",
        network_requirement="local",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="provider_query",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="ask.provider_query",
        name="Provider Ask",
        category="provider",
        short_description="Run a provider-backed ask through the active offline or online provider path.",
        execution_type="query",
        provider_dependency="active_provider",
        network_requirement="conditional",
        requires_runtime=True,
        requires_readiness=True,
        access_kind="external_side_effect",
        locality="hybrid",
        data_scope="provider_query",
        offline_safety="optional_online",
        confirmation_sensitivity="policy_based",
        telegram_exposure="allowed",
        policy_sensitivity="online_sensitive",
        supports_timeout=True,
        supports_confirmation=True,
        default_timeout_ms=18000,
        cooldown_sensitive=True,
        scope_type="network",
        access_mode="execute",
        scope_domain_allowlist=("api.openai.com", "127.0.0.1", "localhost"),
    ),
    CapabilityManifest(
        capability_id="audit.read",
        name="Audit",
        category="operator",
        short_description="Summarize recent capability executions from the in-memory audit log.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
    CapabilityManifest(
        capability_id="capabilities.read",
        name="Capabilities",
        category="operator",
        short_description="Summarize visible capability state and trust boundaries.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        requires_runtime=False,
        requires_readiness=False,
        access_kind="read_only",
        locality="local_only",
        data_scope="internal_state",
        offline_safety="safe_offline",
        confirmation_sensitivity="never",
        telegram_exposure="allowed",
        supports_degraded_mode=True,
    ),
)

CAPABILITY_DEFINITIONS = CAPABILITY_MANIFESTS

COMMAND_CAPABILITY_MAP: dict[str, str] = {
    "/help": "help.read",
    "/status": "status.read",
    "/mode": "mode.read",
    "/models": "models.read",
    "/ask": "ask.provider_query",
    "/askd": "ask.provider_query",
    "/audit": "audit.read",
    "/capabilities": "capabilities.read",
}


def validate_capability_manifests(manifests: tuple[CapabilityManifest, ...] | list[CapabilityManifest]) -> tuple[str, ...]:
    seen_ids: set[str] = set()
    issues: list[str] = []
    for manifest in manifests:
        if not manifest.capability_id.strip():
            issues.append("Capability manifest is missing capability_id.")
        if not manifest.name.strip():
            issues.append(f"{manifest.capability_id or '<unknown>'}: name is required.")
        if not manifest.category:
            issues.append(f"{manifest.capability_id or '<unknown>'}: category is required.")
        if not manifest.short_description.strip():
            issues.append(f"{manifest.capability_id or '<unknown>'}: short_description is required.")
        if manifest.capability_id in seen_ids:
            issues.append(f"{manifest.capability_id}: duplicate capability_id.")
        seen_ids.add(manifest.capability_id)

        if manifest.default_timeout_ms < 0:
            issues.append(f"{manifest.capability_id}: default_timeout_ms cannot be negative.")
        if manifest.default_timeout_ms and not manifest.supports_timeout:
            issues.append(f"{manifest.capability_id}: default_timeout_ms requires supports_timeout.")
        if manifest.confirmation_sensitivity != "never" and not manifest.supports_confirmation:
            issues.append(f"{manifest.capability_id}: confirmation_sensitivity requires supports_confirmation.")
        if manifest.locality == "local_only" and manifest.offline_safety == "requires_online":
            issues.append(f"{manifest.capability_id}: local_only capability cannot require online execution.")
        if manifest.provider_dependency == "ollama" and manifest.offline_safety == "requires_online":
            issues.append(f"{manifest.capability_id}: Ollama-dependent capability cannot be requires_online.")
        if manifest.access_kind != "read_only" and manifest.execution_type == "read":
            issues.append(f"{manifest.capability_id}: non-read-only capability cannot use execution_type='read'.")
        if manifest.telegram_exposure == "denied" and manifest.include_in_capabilities_summary:
            issues.append(f"{manifest.capability_id}: telegram_exposure='denied' cannot be summary-visible.")
        if manifest.scope_type == "internal" and manifest.access_mode == "execute":
            issues.append(f"{manifest.capability_id}: internal scope cannot use execute access mode.")
        if manifest.scope_type == "internal" and (manifest.scope_allowed_paths or manifest.scope_domain_allowlist or manifest.scope_repo_root):
            issues.append(f"{manifest.capability_id}: internal scope cannot define filesystem, repository, or domain targets.")
        if manifest.scope_type == "filesystem" and not manifest.scope_allowed_paths:
            issues.append(f"{manifest.capability_id}: filesystem scope requires scope_allowed_paths.")
        if manifest.scope_type == "repository" and not manifest.scope_repo_root:
            issues.append(f"{manifest.capability_id}: repository scope requires scope_repo_root.")
    return tuple(issues)


def build_capability_registry(manifests: tuple[CapabilityManifest, ...] | list[CapabilityManifest]) -> dict[str, CapabilityManifest]:
    issues = validate_capability_manifests(manifests)
    if issues:
        raise CapabilityManifestError("Invalid capability manifests: " + "; ".join(issues))
    return {manifest.capability_id: manifest for manifest in manifests}


def get_capability_manifest(capability_id: str) -> CapabilityManifest:
    return CAPABILITY_REGISTRY[capability_id]


def list_summary_capabilities() -> tuple[CapabilityManifest, ...]:
    return tuple(
        manifest
        for manifest in CAPABILITY_MANIFESTS
        if manifest.user_visible and manifest.include_in_capabilities_summary
    )


CAPABILITY_REGISTRY = build_capability_registry(CAPABILITY_MANIFESTS)
