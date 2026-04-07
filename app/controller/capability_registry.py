"""Central capability catalog for the Windows OpenClaw operator console."""
from __future__ import annotations

from .capability_models import CapabilityDefinition


CAPABILITY_DEFINITIONS = (
    CapabilityDefinition(
        capability_id="help.read",
        name="Help Read",
        category="operator",
        description="Read the supported Telegram command set.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        readiness_requirement="none",
    ),
    CapabilityDefinition(
        capability_id="status.read",
        name="Status Read",
        category="runtime",
        description="Read runtime, health, security, and readiness state.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        readiness_requirement="none",
    ),
    CapabilityDefinition(
        capability_id="mode.read",
        name="Mode Read",
        category="operator",
        description="Read the currently selected mode, provider, and policy gate.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        readiness_requirement="none",
    ),
    CapabilityDefinition(
        capability_id="models.read",
        name="Models Read",
        category="provider",
        description="Inspect locally available Ollama models.",
        execution_type="read",
        provider_dependency="ollama",
        network_requirement="local",
        readiness_requirement="none",
    ),
    CapabilityDefinition(
        capability_id="ask.provider_query",
        name="Provider Query",
        category="provider",
        description="Run an explicit provider-backed Telegram ask command.",
        execution_type="query",
        provider_dependency="active_provider",
        network_requirement="conditional",
        readiness_requirement="ready",
        mode_constraints=("offline", "online"),
        policy_sensitivity="online_sensitive",
        confirmation_requirement=True,
    ),
    CapabilityDefinition(
        capability_id="capabilities.read",
        name="Capabilities Read",
        category="operator",
        description="Inspect current capability availability and gating state.",
        execution_type="read",
        provider_dependency="none",
        network_requirement="none",
        readiness_requirement="none",
    ),
)

CAPABILITY_REGISTRY = {definition.capability_id: definition for definition in CAPABILITY_DEFINITIONS}

COMMAND_CAPABILITY_MAP = {
    "/help": "help.read",
    "/status": "status.read",
    "/mode": "mode.read",
    "/models": "models.read",
    "/ask": "ask.provider_query",
    "/askd": "ask.provider_query",
    "/capabilities": "capabilities.read",
}
