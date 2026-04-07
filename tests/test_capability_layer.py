from __future__ import annotations

import unittest

from app.controller.capability_evaluator import CapabilityEvaluator
from app.controller.capability_models import CapabilityContext, CapabilityManifest
from app.controller.capability_registry import (
    CAPABILITY_DEFINITIONS,
    CAPABILITY_REGISTRY,
    CapabilityManifestError,
    build_capability_registry,
    validate_capability_manifests,
)
from app.providers.base import ProviderStatus


class CapabilityLayerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.evaluator = CapabilityEvaluator()

    def _provider_status(
        self,
        provider: str,
        *,
        ready: bool,
        available: bool,
        configured: bool = True,
        message: str = "Provider ready.",
        model: str = "",
        available_models: tuple[str, ...] = (),
    ) -> ProviderStatus:
        return ProviderStatus(
            provider=provider,  # type: ignore[arg-type]
            display_name="Ollama" if provider == "ollama" else "OpenAI",
            configured=configured,
            available=available,
            validation_state="valid" if ready else "invalid",
            ready=ready,
            message=message,
            is_local=provider == "ollama",
            model=model,
            available_models=available_models,
        )

    def _context(
        self,
        *,
        mode: str = "offline",
        selected_mode: str = "offline",
        policy: str = "ask_before_online",
        runtime_state: str = "running",
        readiness_state: str = "ready",
        offline_provider_status: ProviderStatus | None = None,
        online_provider_status: ProviderStatus | None = None,
    ) -> CapabilityContext:
        return CapabilityContext(
            runtime_state=runtime_state,
            readiness_state=readiness_state,  # type: ignore[arg-type]
            mode=mode,  # type: ignore[arg-type]
            selected_mode=selected_mode,  # type: ignore[arg-type]
            policy=policy,  # type: ignore[arg-type]
            active_provider="ollama" if mode == "offline" else "openai",  # type: ignore[arg-type]
            selected_provider="ollama" if selected_mode == "offline" else "openai",  # type: ignore[arg-type]
            health_status="ok",
            safety_status="ok",
            offline_provider_status=offline_provider_status
            or self._provider_status(
                "ollama",
                ready=True,
                available=True,
                message="Ollama is ready.",
                model="llama3.1:latest",
                available_models=("llama3.1:latest",),
            ),
            online_provider_status=online_provider_status
            or self._provider_status(
                "openai",
                ready=True,
                available=True,
                message="OpenAI is ready.",
            ),
        )

    def test_registry_integrity_and_expected_capabilities_exist(self) -> None:
        ids = [definition.capability_id for definition in CAPABILITY_DEFINITIONS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn("status.read", CAPABILITY_REGISTRY)
        self.assertIn("mode.read", CAPABILITY_REGISTRY)
        self.assertIn("models.read", CAPABILITY_REGISTRY)
        self.assertIn("ask.provider_query", CAPABILITY_REGISTRY)
        self.assertIn("audit.read", CAPABILITY_REGISTRY)
        self.assertIn("capabilities.read", CAPABILITY_REGISTRY)
        for definition in CAPABILITY_DEFINITIONS:
            self.assertTrue(definition.name)
            self.assertTrue(definition.category)
            self.assertTrue(definition.description)
            self.assertIn(definition.execution_type, {"read", "query"})
            self.assertTrue(definition.access_kind)
            self.assertTrue(definition.locality)
            self.assertTrue(definition.offline_safety)
        self.assertEqual(CAPABILITY_REGISTRY["status.read"].scope_type, "internal")
        self.assertEqual(CAPABILITY_REGISTRY["ask.provider_query"].scope_type, "network")

    def test_invalid_manifest_combinations_are_reported_clearly(self) -> None:
        invalid = CapabilityManifest(
            capability_id="bad.capability",
            name="Bad Capability",
            category="operator",
            short_description="Invalid manifest.",
            execution_type="read",
            provider_dependency="ollama",
            network_requirement="none",
            requires_runtime=False,
            requires_readiness=False,
            access_kind="external_side_effect",
            locality="local_only",
            data_scope="provider_query",
            offline_safety="requires_online",
            confirmation_sensitivity="policy_based",
            telegram_exposure="denied",
            supports_confirmation=False,
            include_in_capabilities_summary=True,
        )
        issues = validate_capability_manifests([invalid])
        self.assertTrue(any("requires supports_confirmation" in issue for issue in issues))
        self.assertTrue(any("local_only capability cannot require online" in issue for issue in issues))
        self.assertTrue(any("cannot use execution_type='read'" in issue for issue in issues))
        self.assertTrue(any("cannot be summary-visible" in issue for issue in issues))
        with self.assertRaises(CapabilityManifestError):
            build_capability_registry([invalid])

    def test_status_read_allowed_in_healthy_normal_state(self) -> None:
        evaluation = self.evaluator.evaluate("status.read", self._context())
        self.assertEqual(evaluation.current_availability_state, "allowed")
        self.assertEqual(evaluation.reason_code, "allowed")

    def test_models_read_degraded_when_ollama_unavailable(self) -> None:
        evaluation = self.evaluator.evaluate(
            "models.read",
            self._context(
                offline_provider_status=self._provider_status(
                    "ollama",
                    ready=False,
                    available=False,
                    message="Ollama service is unavailable.",
                )
            ),
        )
        self.assertEqual(evaluation.current_availability_state, "degraded")
        self.assertEqual(evaluation.reason_code, "ollama_unavailable")
        self.assertIn("Ollama service is unavailable", evaluation.blocking_reason)

    def test_ask_provider_query_allowed_in_offline_mode_with_valid_provider(self) -> None:
        evaluation = self.evaluator.evaluate("ask.provider_query", self._context())
        self.assertEqual(evaluation.current_availability_state, "allowed")
        self.assertEqual(evaluation.reason_code, "allowed")
        self.assertIn("Offline provider query", evaluation.message)

    def test_ask_provider_query_blocked_when_readiness_is_not_ready(self) -> None:
        evaluation = self.evaluator.evaluate("ask.provider_query", self._context(readiness_state="not_ready"))
        self.assertEqual(evaluation.current_availability_state, "blocked")
        self.assertEqual(evaluation.reason_code, "readiness_not_ready")
        self.assertEqual(evaluation.blocking_reason, "Readiness is not ready.")

    def test_ask_provider_query_unavailable_when_provider_invalid(self) -> None:
        evaluation = self.evaluator.evaluate(
            "ask.provider_query",
            self._context(
                offline_provider_status=self._provider_status(
                    "ollama",
                    ready=False,
                    available=False,
                    message="Ollama service is unavailable.",
                )
            ),
        )
        self.assertEqual(evaluation.current_availability_state, "unavailable")
        self.assertEqual(evaluation.reason_code, "offline_provider_unavailable")

    def test_ask_provider_query_blocked_by_online_sensitive_policy(self) -> None:
        evaluation = self.evaluator.evaluate(
            "ask.provider_query",
            self._context(
                mode="online",
                selected_mode="online",
                policy="always_offline",
            ),
        )
        self.assertEqual(evaluation.current_availability_state, "blocked")
        self.assertEqual(evaluation.reason_code, "policy_always_offline")

    def test_ask_provider_query_becomes_confirmation_required_when_online_is_selected_but_not_active(self) -> None:
        evaluation = self.evaluator.evaluate(
            "ask.provider_query",
            self._context(
                mode="offline",
                selected_mode="online",
                policy="ask_before_online",
            ),
        )
        self.assertEqual(evaluation.current_availability_state, "confirmation_required")
        self.assertEqual(evaluation.reason_code, "online_confirmation_required")

    def test_confirmation_granted_allows_one_online_query_when_provider_is_ready(self) -> None:
        evaluation = self.evaluator.evaluate(
            "ask.provider_query",
            self._context(
                mode="offline",
                selected_mode="online",
                policy="ask_before_online",
            ),
            confirmation_granted=True,
        )
        self.assertEqual(evaluation.current_availability_state, "allowed")
        self.assertEqual(evaluation.reason_code, "allowed")
        self.assertIn("approved for one confirmed request", evaluation.message)

    def test_reason_output_is_deterministic(self) -> None:
        context = self._context(readiness_state="not_ready")
        first = self.evaluator.evaluate("ask.provider_query", context)
        second = self.evaluator.evaluate("ask.provider_query", context)
        self.assertEqual(first.current_availability_state, second.current_availability_state)
        self.assertEqual(first.reason_code, second.reason_code)
        self.assertEqual(first.blocking_reason, second.blocking_reason)
        self.assertEqual(first.message, second.message)

    def test_telegram_exposure_denied_is_enforced(self) -> None:
        manifest = CapabilityManifest(
            capability_id="test.denied",
            name="Denied Test",
            category="operator",
            short_description="Denied on Telegram.",
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
            telegram_exposure="denied",
            user_visible=False,
            include_in_capabilities_summary=False,
        )
        evaluator = CapabilityEvaluator(build_capability_registry([manifest]))
        telegram_evaluation = evaluator.evaluate("test.denied", self._context(), source="telegram")
        desktop_evaluation = evaluator.evaluate("test.denied", self._context(), source="desktop")
        self.assertEqual(telegram_evaluation.current_availability_state, "blocked")
        self.assertEqual(telegram_evaluation.reason_code, "telegram_exposure_denied")
        self.assertEqual(desktop_evaluation.current_availability_state, "allowed")
        self.assertEqual(desktop_evaluation.reason_code, "allowed")

    def test_telegram_exposure_limited_is_reported_as_degraded(self) -> None:
        manifest = CapabilityManifest(
            capability_id="test.limited",
            name="Limited Test",
            category="operator",
            short_description="Limited on Telegram.",
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
            telegram_exposure="limited",
            user_visible=False,
            include_in_capabilities_summary=False,
        )
        evaluator = CapabilityEvaluator(build_capability_registry([manifest]))
        evaluation = evaluator.evaluate("test.limited", self._context(), source="telegram")
        self.assertEqual(evaluation.current_availability_state, "degraded")
        self.assertEqual(evaluation.reason_code, "telegram_exposure_limited")


if __name__ == "__main__":
    unittest.main()


