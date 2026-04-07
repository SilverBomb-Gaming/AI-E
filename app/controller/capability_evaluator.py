"""Capability evaluation for deterministic command gating."""
from __future__ import annotations

from .capability_models import CapabilityContext, CapabilityEvaluation
from .capability_registry import CAPABILITY_REGISTRY


class CapabilityEvaluator:
    """Evaluate whether a capability is currently allowed, blocked, or degraded."""

    def __init__(self, registry: dict[str, object] | None = None) -> None:
        self._registry = registry or CAPABILITY_REGISTRY

    def list_capabilities(self) -> tuple[object, ...]:
        return tuple(self._registry.values())

    def evaluate(self, capability_id: str, context: CapabilityContext) -> CapabilityEvaluation:
        if capability_id not in self._registry:
            raise KeyError(f"Unknown capability: {capability_id}")
        definition = self._registry[capability_id]
        availability_state = "allowed"
        blocking_reason = ""
        reason_code = "allowed"
        message = f"{definition.name} is available."

        if capability_id in {"help.read", "status.read", "mode.read", "capabilities.read"}:
            message = f"{definition.name} is available."
        elif capability_id == "models.read":
            ollama_status = context.offline_provider_status
            if not ollama_status.available:
                availability_state = "degraded"
                blocking_reason = ollama_status.message or "Ollama is unavailable."
                reason_code = "ollama_unavailable"
                message = f"Local model discovery is limited: {blocking_reason}"
            elif not ollama_status.available_models:
                availability_state = "degraded"
                blocking_reason = "No local Ollama models are available yet."
                reason_code = "no_local_models"
                message = blocking_reason
            else:
                message = "Local model discovery is available via Ollama."
        elif capability_id == "ask.provider_query":
            if context.runtime_state != "running":
                availability_state = "blocked"
                blocking_reason = "Runtime is not running."
                reason_code = "runtime_not_running"
                message = "Provider queries require a running OpenClaw runtime."
            elif context.mode == "offline":
                ollama_status = context.offline_provider_status
                if not ollama_status.ready:
                    availability_state = "unavailable"
                    blocking_reason = ollama_status.message or "Ollama is unavailable."
                    reason_code = "offline_provider_unavailable"
                    message = f"Offline provider query is unavailable: {blocking_reason}"
                elif context.readiness_state == "not_ready":
                    availability_state = "blocked"
                    blocking_reason = "Readiness is not ready."
                    reason_code = "readiness_not_ready"
                    message = "Provider queries are blocked until readiness is restored."
                else:
                    model_suffix = f" / {ollama_status.model}" if ollama_status.model else ""
                    message = f"Offline provider query is available via Ollama{model_suffix}."
            else:
                if context.policy == "always_offline":
                    availability_state = "blocked"
                    blocking_reason = "Always Offline policy is active."
                    reason_code = "policy_always_offline"
                    message = "Always Offline policy blocks remote provider queries."
                elif context.selected_mode == "online" and context.mode != "online":
                    availability_state = "confirmation_required"
                    blocking_reason = "Online Mode is selected but not activated yet. Confirm it in the desktop app."
                    reason_code = "online_confirmation_required"
                    message = "Online provider queries require explicit online confirmation in the desktop app."
                elif not context.online_provider_status.ready:
                    availability_state = "unavailable"
                    blocking_reason = context.online_provider_status.message or "OpenAI is unavailable."
                    reason_code = "online_provider_unavailable"
                    message = f"Online provider query is unavailable: {blocking_reason}"
                elif context.readiness_state == "not_ready":
                    availability_state = "blocked"
                    blocking_reason = "Readiness is not ready."
                    reason_code = "readiness_not_ready"
                    message = "Provider queries are blocked until readiness is restored."
                else:
                    message = "Online provider query is available via OpenAI."
        else:
            availability_state = "unavailable"
            blocking_reason = "Capability is not registered for evaluation."
            reason_code = "capability_not_registered"
            message = blocking_reason

        return CapabilityEvaluation(
            capability_id=definition.capability_id,
            name=definition.name,
            category=definition.category,
            description=definition.description,
            execution_type=definition.execution_type,
            provider_dependency=definition.provider_dependency,
            network_requirement=definition.network_requirement,
            readiness_requirement=definition.readiness_requirement,
            mode_constraints=definition.mode_constraints,
            policy_sensitivity=definition.policy_sensitivity,
            confirmation_requirement=definition.confirmation_requirement,
            current_availability_state=availability_state,  # type: ignore[arg-type]
            blocking_reason=blocking_reason,
            reason_code=reason_code,
            message=message,
        )
