"""Capability evaluation for deterministic, manifest-driven command gating."""
from __future__ import annotations

from pathlib import Path

from .capability_models import (
    CapabilityContext,
    CapabilityEvaluation,
    CapabilityInvocationSource,
    CapabilityManifest,
)
from .capability_registry import CAPABILITY_REGISTRY


class CapabilityEvaluator:
    """Evaluate whether a capability is currently allowed, blocked, or degraded."""

    def __init__(self, registry: dict[str, CapabilityManifest] | None = None) -> None:
        self._registry = registry or CAPABILITY_REGISTRY

    def list_capabilities(self) -> tuple[CapabilityManifest, ...]:
        return tuple(self._registry.values())

    def get_manifest(self, capability_id: str) -> CapabilityManifest:
        if capability_id not in self._registry:
            raise KeyError(f"Unknown capability: {capability_id}")
        return self._registry[capability_id]

    def evaluate(
        self,
        capability_id: str,
        context: CapabilityContext,
        *,
        source: CapabilityInvocationSource = "telegram",
        confirmation_granted: bool = False,
    ) -> CapabilityEvaluation:
        manifest = self.get_manifest(capability_id)

        exposure_result = self._evaluate_source_exposure(manifest, source=source)
        if exposure_result is not None:
            return exposure_result

        if manifest.requires_runtime and not context.runtime_active:
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="runtime_not_active",
                blocking_reason="Runtime is not active.",
                message=f"{manifest.name} is blocked until local execution is enabled.",
            )

        if (
            manifest.requires_readiness
            and context.readiness_state == "not_ready"
            and capability_id not in {"ask.provider_query", "web.fetch.read"}
            and not manifest.supports_degraded_mode
        ):
            if not context.runtime_active:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="blocked",
                    reason_code="runtime_not_active",
                    blocking_reason="Runtime is not active.",
                    message=f"{manifest.name} is blocked until local execution is enabled.",
                )
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="readiness_not_ready",
                blocking_reason="Readiness is not ready.",
                message=f"{manifest.name} is blocked until readiness is restored.",
            )

        if capability_id in {
            "help.read",
            "nodes.read",
            "node.view.read",
            "node.select.query",
            "node.clear.query",
            "status.read",
            "action.last.read",
            "chat.orchestrate.read",
            "intent.translate.read",
            "intent.refine.read",
            "intent.view.read",
            "intent.clear.read",
            "build.plan.read",
            "build.step.read",
            "build.step.approve.query",
            "build.status.read",
            "build.step.reset.read",
            "build.bundle.propose.read",
            "build.bundle.approve.query",
            "build.bundle.status.read",
            "build.bundle.cancel.query",
            "build.bundle.reset.query",
            "build.bootstrap.propose.read",
            "build.bootstrap.view.read",
            "build.bootstrap.reset.query",
            "build.feature.status.read",
            "build.feature.apply.query",
            "build.plan.view.read",
            "build.plan.clear.read",
            "mode.read",
            "audit.read",
            "capabilities.read",
            "context.read",
            "context.clear",
            "workflow.read",
            "workflow.cancel",
            "runtime.activate.query",
        }:
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message=f"{manifest.name} is available.",
            )

        if capability_id == "models.read":
            ollama_status = context.offline_provider_status
            if not ollama_status.available:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="degraded",
                    reason_code="ollama_unavailable",
                    blocking_reason=ollama_status.message or "Ollama is unavailable.",
                    message=f"Local model discovery is limited: {ollama_status.message or 'Ollama is unavailable.'}",
                )
            if not ollama_status.available_models:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="degraded",
                    reason_code="no_local_models",
                    blocking_reason="No local Ollama models are available yet.",
                    message="No local Ollama models are available yet.",
                )
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message="Local model discovery is available via Ollama.",
            )

        if capability_id == "repo.status.read":
            if not context.repo_root_valid:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="unavailable",
                    reason_code="repo_root_invalid",
                    blocking_reason=context.repo_message or "Repository root is not configured.",
                    message=context.repo_message or "Repository root is not configured.",
                )
            repo_name = Path(context.repo_root).name or context.repo_root
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message=f"Repository insight is available for {repo_name}.",
            )

        if capability_id == "file.read":
            if not context.file_scope_valid:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="unavailable",
                    reason_code="file_scope_invalid",
                    blocking_reason=context.file_message or "No allowed file directories are configured.",
                    message=context.file_message or "No allowed file directories are configured.",
                )
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message="Scoped file preview is available inside the configured allowed roots.",
            )

        if capability_id in {"file.create.write", "file.patch.write", "file.write.replace"}:
            if not context.file_scope_valid:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="unavailable",
                    reason_code="file_scope_invalid",
                    blocking_reason=context.file_message or "No allowed file directories are configured.",
                    message=context.file_message or "No allowed file directories are configured.",
                )
            if source == "telegram" and not confirmation_granted:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="confirmation_required",
                    reason_code="operator_confirmation_required",
                    blocking_reason="Explicit operator confirmation is required for file mutation.",
                    message="File mutation requires explicit one-shot operator confirmation.",
                )
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message="Scoped file mutation is available inside the configured allowed roots.",
            )

        if capability_id in {"shell.command.run", "test.command.run"}:
            if not context.repo_root_valid:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="unavailable",
                    reason_code="repo_root_invalid",
                    blocking_reason=context.repo_message or "Repository root is not configured.",
                    message=context.repo_message or "Repository root is not configured.",
                )
            if source == "telegram" and not confirmation_granted:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="confirmation_required",
                    reason_code="operator_confirmation_required",
                    blocking_reason="Explicit operator confirmation is required for bounded local execution.",
                    message="Bounded local execution requires explicit one-shot operator confirmation.",
                )
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message="Bounded repository execution is available inside the configured repository root.",
            )

        if capability_id == "web.fetch.read":
            return self._evaluate_web_fetch(
                manifest,
                context,
                source=source,
                confirmation_granted=confirmation_granted,
            )

        if capability_id == "ask.provider_query":
            return self._evaluate_provider_query(
                manifest,
                context,
                source=source,
                confirmation_granted=confirmation_granted,
            )

        return self._result(
            manifest,
            source=source,
            availability_state="allowed",
            reason_code="allowed",
            blocking_reason="",
            message=f"{manifest.name} is available.",
        )

    def _evaluate_source_exposure(
        self,
        manifest: CapabilityManifest,
        *,
        source: CapabilityInvocationSource,
    ) -> CapabilityEvaluation | None:
        if source != "telegram":
            return None
        if manifest.telegram_exposure == "denied":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="telegram_exposure_denied",
                blocking_reason="This capability is not exposed to Telegram.",
                message=f"{manifest.name} is not available from Telegram.",
            )
        if manifest.telegram_exposure == "limited":
            return self._result(
                manifest,
                source=source,
                availability_state="degraded",
                reason_code="telegram_exposure_limited",
                blocking_reason="Telegram only exposes a limited form of this capability.",
                message=f"{manifest.name} is available in a limited Telegram-safe form.",
            )
        return None

    def _evaluate_provider_query(
        self,
        manifest: CapabilityManifest,
        context: CapabilityContext,
        *,
        source: CapabilityInvocationSource,
        confirmation_granted: bool,
    ) -> CapabilityEvaluation:
        if context.selected_mode == "online" and context.mode != "online":
            return self._evaluate_selected_online_query(
                manifest,
                context,
                source=source,
                confirmation_granted=confirmation_granted,
            )

        if context.mode == "offline":
            offline_status = context.offline_provider_status
            if not offline_status.ready:
                return self._result(
                    manifest,
                    source=source,
                    availability_state="unavailable",
                    reason_code="offline_provider_unavailable",
                    blocking_reason=offline_status.message or "Ollama is unavailable.",
                    message=f"Offline provider query is unavailable: {offline_status.message or 'Ollama is unavailable.'}",
                )
            if context.network_readiness_state == "not_ready":
                return self._result(
                    manifest,
                    source=source,
                    availability_state="blocked",
                    reason_code="readiness_not_ready",
                    blocking_reason="Readiness is not ready.",
                    message="Provider queries are blocked until readiness is restored.",
                )
            model_suffix = f" / {offline_status.model}" if offline_status.model else ""
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message=f"Offline provider query is available via Ollama{model_suffix}.",
            )

        if context.policy == "always_offline":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="policy_always_offline",
                blocking_reason="Always Offline policy is active.",
                message="Always Offline policy blocks remote provider queries.",
            )

        online_status = context.online_provider_status
        if not online_status.ready:
            return self._result(
                manifest,
                source=source,
                availability_state="unavailable",
                reason_code="online_provider_unavailable",
                blocking_reason=online_status.message or "OpenAI is unavailable.",
                message=f"Online provider query is unavailable: {online_status.message or 'OpenAI is unavailable.'}",
            )
        if context.network_readiness_state == "not_ready":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="readiness_not_ready",
                blocking_reason="Readiness is not ready.",
                message="Provider queries are blocked until readiness is restored.",
            )

        if manifest.confirmation_sensitivity == "always" and not confirmation_granted:
            return self._result(
                manifest,
                source=source,
                availability_state="confirmation_required",
                reason_code="capability_confirmation_required",
                blocking_reason="This capability always requires explicit confirmation.",
                message="This capability requires explicit confirmation before it can run.",
            )

        return self._result(
            manifest,
            source=source,
            availability_state="allowed",
            reason_code="allowed",
            blocking_reason="",
            message="Online provider query is available via OpenAI.",
        )

    def _evaluate_web_fetch(
        self,
        manifest: CapabilityManifest,
        context: CapabilityContext,
        *,
        source: CapabilityInvocationSource,
        confirmation_granted: bool,
    ) -> CapabilityEvaluation:
        if not context.web_scope_valid:
            return self._result(
                manifest,
                source=source,
                availability_state="unavailable",
                reason_code="web_scope_invalid",
                blocking_reason=context.web_message or "No allowed web domains are configured.",
                message=context.web_message or "No allowed web domains are configured.",
            )

        if context.policy == "always_offline":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="policy_always_offline",
                blocking_reason="Always Offline policy is active.",
                message="Always Offline policy blocks web fetch requests.",
            )

        if context.network_readiness_state == "not_ready":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="readiness_not_ready",
                blocking_reason="Readiness is not ready.",
                message="Web fetch is blocked until readiness is restored.",
            )

        if context.mode == "online":
            return self._result(
                manifest,
                source=source,
                availability_state="allowed",
                reason_code="allowed",
                blocking_reason="",
                message="Web fetch is available in Online Mode.",
            )

        if manifest.confirmation_sensitivity == "always" and not confirmation_granted:
            return self._result(
                manifest,
                source=source,
                availability_state="confirmation_required",
                reason_code="capability_confirmation_required",
                blocking_reason="This capability always requires explicit confirmation.",
                message="This capability requires explicit confirmation before it can run.",
            )

        if context.policy == "ask_before_online" and not confirmation_granted:
            return self._result(
                manifest,
                source=source,
                availability_state="confirmation_required",
                reason_code="online_confirmation_required",
                blocking_reason="Online access requires one-shot confirmation under the current policy.",
                message="Web fetch requires one-shot confirmation before it can use the network.",
            )

        return self._result(
            manifest,
            source=source,
            availability_state="allowed",
            reason_code="allowed",
            blocking_reason="",
            message="Web fetch is available for allowlisted domains.",
        )

    def _evaluate_selected_online_query(
        self,
        manifest: CapabilityManifest,
        context: CapabilityContext,
        *,
        source: CapabilityInvocationSource,
        confirmation_granted: bool,
    ) -> CapabilityEvaluation:
        if context.policy == "always_offline":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="policy_always_offline",
                blocking_reason="Always Offline policy is active.",
                message="Always Offline policy blocks remote provider queries.",
            )

        online_status = context.online_provider_status
        if not online_status.ready:
            return self._result(
                manifest,
                source=source,
                availability_state="unavailable",
                reason_code="online_provider_unavailable",
                blocking_reason=online_status.message or "OpenAI is unavailable.",
                message=f"Online provider query is unavailable: {online_status.message or 'OpenAI is unavailable.'}",
            )
        if context.network_readiness_state == "not_ready":
            return self._result(
                manifest,
                source=source,
                availability_state="blocked",
                reason_code="readiness_not_ready",
                blocking_reason="Readiness is not ready.",
                message="Provider queries are blocked until readiness is restored.",
            )

        if manifest.confirmation_sensitivity == "always" and not confirmation_granted:
            return self._result(
                manifest,
                source=source,
                availability_state="confirmation_required",
                reason_code="capability_confirmation_required",
                blocking_reason="This capability always requires explicit confirmation.",
                message="This capability requires explicit confirmation before it can run.",
            )

        if context.policy == "ask_before_online" and manifest.confirmation_sensitivity == "policy_based" and not confirmation_granted:
            return self._result(
                manifest,
                source=source,
                availability_state="confirmation_required",
                reason_code="online_confirmation_required",
                blocking_reason="Online Mode is selected but not activated yet. Confirm it in the desktop app.",
                message="Online provider queries require explicit online confirmation in the desktop app.",
            )

        message = "Online provider query is approved for one confirmed request." if confirmation_granted else "Online provider query is available via OpenAI."
        return self._result(
            manifest,
            source=source,
            availability_state="allowed",
            reason_code="allowed",
            blocking_reason="",
            message=message,
        )

    def _result(
        self,
        manifest: CapabilityManifest,
        *,
        source: CapabilityInvocationSource,
        availability_state: str,
        reason_code: str,
        blocking_reason: str,
        message: str,
    ) -> CapabilityEvaluation:
        return CapabilityEvaluation(
            capability_id=manifest.capability_id,
            name=manifest.name,
            category=manifest.category,
            short_description=manifest.short_description,
            execution_type=manifest.execution_type,
            provider_dependency=manifest.provider_dependency,
            network_requirement=manifest.network_requirement,
            requires_runtime=manifest.requires_runtime,
            requires_readiness=manifest.requires_readiness,
            mode_constraints=manifest.mode_constraints,
            policy_sensitivity=manifest.policy_sensitivity,
            access_kind=manifest.access_kind,
            locality=manifest.locality,
            data_scope=manifest.data_scope,
            offline_safety=manifest.offline_safety,
            confirmation_sensitivity=manifest.confirmation_sensitivity,
            telegram_exposure=manifest.telegram_exposure,
            supports_timeout=manifest.supports_timeout,
            supports_confirmation=manifest.supports_confirmation,
            supports_degraded_mode=manifest.supports_degraded_mode,
            default_timeout_ms=manifest.default_timeout_ms,
            cooldown_sensitive=manifest.cooldown_sensitive,
            user_visible=manifest.user_visible,
            include_in_capabilities_summary=manifest.include_in_capabilities_summary,
            scope_type=manifest.scope_type,
            access_mode=manifest.access_mode,
            invocation_source=source,
            current_availability_state=availability_state,  # type: ignore[arg-type]
            blocking_reason=blocking_reason,
            reason_code=reason_code,
            message=message,
        )
