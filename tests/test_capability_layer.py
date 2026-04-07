from __future__ import annotations

import unittest

from app.controller.capability_evaluator import CapabilityEvaluator
from app.controller.capability_models import CapabilityContext
from app.controller.capability_registry import CAPABILITY_DEFINITIONS, CAPABILITY_REGISTRY
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
        for definition in CAPABILITY_DEFINITIONS:
            self.assertTrue(definition.name)
            self.assertTrue(definition.category)
            self.assertTrue(definition.description)
            self.assertIn(definition.execution_type, {"read", "query"})

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

    def test_reason_output_is_deterministic(self) -> None:
        context = self._context(readiness_state="not_ready")
        first = self.evaluator.evaluate("ask.provider_query", context)
        second = self.evaluator.evaluate("ask.provider_query", context)
        self.assertEqual(first.current_availability_state, second.current_availability_state)
        self.assertEqual(first.reason_code, second.reason_code)
        self.assertEqual(first.blocking_reason, second.blocking_reason)
        self.assertEqual(first.message, second.message)


if __name__ == "__main__":
    unittest.main()
