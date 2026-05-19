from dataclasses import dataclass
import unittest

from app.providers import ProviderReply, ProviderStatus
from app.controller.workflow_scope import WorkflowScopeAnalyzer
from app.runtime.agent_router import RuntimeAgentRouter
from app.runtime.models import OllamaInstallation, OpenClawInstallation, RuntimeStatus


@dataclass
class FakeConfig:
    current_mode: str = "offline"
    preferred_ollama_model: str = "local-model"
    ollama_base_url: str = "http://127.0.0.1:11434"
    openai_secret_id: str = "openai/default"


@dataclass
class StaleConfig:
    current_mode: str = "offline"
    preferred_ollama_model: str = "stale-model"
    ollama_base_url: str = "http://127.0.0.1:11434"
    openai_secret_id: str = "openai/default"


class FakeRuntimeManager:
    def __init__(self, status: RuntimeStatus) -> None:
        self.status = status

    def get_status(self) -> RuntimeStatus:
        return self.status


class ReadyOllamaAdapter:
    last_prompt = ""

    def validate(self, **kwargs):
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama ready.",
            is_local=True,
            model="local-model",
        )

    def ask(self, **kwargs):
        prompt = str(kwargs.get("prompt") or "")
        self.last_prompt = prompt
        assert "AI-E governance envelope" in prompt
        assert "Mutation allowed: False" in prompt
        return ProviderReply(
            provider="ollama",
            ok=True,
            text="Runtime-generated answer with approval-aware next steps.",
            message="ok",
            model="local-model",
        )


class ModelSensitiveOllamaAdapter:
    last_preferred_model = ""

    def validate(self, **kwargs):
        preferred_model = str(kwargs.get("preferred_model") or "")
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=preferred_model == "validated-model",
            validation_state="valid" if preferred_model == "validated-model" else "invalid",
            ready=preferred_model == "validated-model",
            message="Ollama ready." if preferred_model == "validated-model" else "Stale model unavailable.",
            is_local=True,
            model=preferred_model,
        )

    def ask(self, **kwargs):
        self.last_preferred_model = str(kwargs.get("preferred_model") or "")
        if self.last_preferred_model != "validated-model":
            return ProviderReply(provider="ollama", ok=False, text="", message="Stale model unavailable.", model=self.last_preferred_model)
        return ProviderReply(
            provider="ollama",
            ok=True,
            text="Validated model answered.",
            message="ok",
            model="validated-model",
        )


class FailingReadyOllamaAdapter:
    def validate(self, **kwargs):
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama ready.",
            is_local=True,
            model="validated-model",
        )

    def ask(self, **kwargs):
        return ProviderReply(provider="ollama", ok=False, text="", message="Generation failed.", model="validated-model")


class AuthorityClaimingOllamaAdapter(ReadyOllamaAdapter):
    def __init__(self, text: str) -> None:
        self.text = text

    def ask(self, **kwargs):
        prompt = str(kwargs.get("prompt") or "")
        self.last_prompt = prompt
        return ProviderReply(
            provider="ollama",
            ok=True,
            text=self.text,
            message="ok",
            model="local-model",
        )


class UnreadyOllamaAdapter:
    def validate(self, **kwargs):
        return ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=False,
            available=False,
            validation_state="invalid",
            ready=False,
            message="Ollama unavailable.",
            is_local=True,
        )

    def ask(self, **kwargs):
        return ProviderReply(provider="ollama", ok=False, text="", message="Ollama unavailable.")


class RuntimeAgentRouterTests(unittest.TestCase):
    def test_routes_prompt_to_ready_local_runtime_agent_with_truth_wrap(self) -> None:
        adapter = ReadyOllamaAdapter()
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(
                RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))
            ),
            provider_adapters={"ollama": adapter},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        scope = WorkflowScopeAnalyzer().analyze("Help me inspect my gameplay loop safely.")
        reply = router.route_prompt("Help me inspect my gameplay loop safely.", workflow_scope=scope)

        self.assertTrue(reply.routed)
        self.assertEqual(reply.agent_id, "ollama")
        self.assertIn("Runtime-generated answer", reply.response_text)
        self.assertIn("Runtime Agent Routed", reply.truth_line)
        self.assertIn("Scope: inspection", reply.truth_line)
        self.assertIn("Workflow scope analysis has already run inside AI-E", adapter.last_prompt)
        self.assertEqual(reply.mutation_status, "Mutation Not Applied")
        self.assertEqual(reply.validation_status, "Validation Not Run")

    def test_mutation_prompt_is_routed_as_approval_required_planning(self) -> None:
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(
                RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))
            ),
            provider_adapters={"ollama": ReadyOllamaAdapter()},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        scope = WorkflowScopeAnalyzer().analyze("Patch the movement script and run tests.")
        reply = router.route_prompt("Patch the movement script and run tests.", workflow_scope=scope)

        self.assertTrue(reply.routed)
        self.assertIn("Scope: execution_request", reply.truth_line)
        self.assertIn("Approval Required Before Action", reply.truth_line)
        self.assertEqual(reply.approval_state, "Approval Required Before Action")

    def test_read_only_runtime_response_cannot_contradict_approval_truth(self) -> None:
        adapter = AuthorityClaimingOllamaAdapter(
            "I can help inspect the gameplay loop safely. Approval is required before execution. No files were changed."
        )
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))),
            provider_adapters={"ollama": adapter},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        scope = WorkflowScopeAnalyzer().analyze("Help me inspect my current BABYLON gameplay loop safely.")
        reply = router.route_prompt("Help me inspect my current BABYLON gameplay loop safely.", workflow_scope=scope)

        self.assertTrue(reply.routed)
        self.assertIn("Runtime Agent Routed", reply.truth_line)
        self.assertIn("Approval Not Required", reply.truth_line)
        self.assertIn("No Approval Requested", reply.truth_line)
        self.assertIn("I can help inspect", reply.response_text)
        self.assertNotIn("Approval is required", reply.response_text)
        self.assertNotIn("files were changed", reply.response_text.lower())
        self.assertIn("AI-E governance", reply.response_text)
        self.assertIn("Mutation Not Applied", reply.response_text)

    def test_mutation_request_truth_controls_approval_and_blocks_execution_claims(self) -> None:
        adapter = AuthorityClaimingOllamaAdapter(
            "I can outline the zombie health tuning. I executed the change and validation passed."
        )
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))),
            provider_adapters={"ollama": adapter},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        scope = WorkflowScopeAnalyzer().analyze("Increase zombie health after round 3.")
        reply = router.route_prompt("Increase zombie health after round 3.", workflow_scope=scope)

        self.assertTrue(reply.routed)
        self.assertIn("Scope: mutation_request", reply.truth_line)
        self.assertIn("Risk: mutation_requested", reply.truth_line)
        self.assertIn("Approval Required", reply.truth_line)
        self.assertIn("Mutation Not Applied", reply.truth_line)
        self.assertIn("Validation Not Run", reply.truth_line)
        self.assertIn("I can outline", reply.response_text)
        self.assertNotIn("executed", reply.response_text.lower())
        self.assertNotIn("validation passed", reply.response_text.lower())

    def test_validation_claim_guard_keeps_validation_state_evidence_backed(self) -> None:
        adapter = AuthorityClaimingOllamaAdapter(
            "I validated the gameplay loop and tests passed. I can explain what evidence would be needed next."
        )
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))),
            provider_adapters={"ollama": adapter},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        scope = WorkflowScopeAnalyzer().analyze("Did you validate the gameplay loop?")
        reply = router.route_prompt("Did you validate the gameplay loop?", workflow_scope=scope)

        self.assertTrue(reply.routed)
        self.assertIn("Validation Not Run", reply.truth_line)
        self.assertIn("Validation Not Run", reply.response_text)
        self.assertNotIn("I validated", reply.response_text)
        self.assertNotIn("tests passed", reply.response_text.lower())

    def test_validated_provider_model_overrides_stale_config_for_routing(self) -> None:
        adapter = ModelSensitiveOllamaAdapter()
        validated_status = ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama ready.",
            is_local=True,
            model="validated-model",
        )
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))),
            provider_adapters={"ollama": adapter},
            get_config=StaleConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
            get_provider_status=lambda provider: validated_status if provider == "ollama" else None,
        )

        reply = router.route_prompt("Help me inspect my current BABYLON gameplay loop safely.")

        self.assertTrue(reply.routed)
        self.assertEqual(adapter.last_preferred_model, "validated-model")
        self.assertEqual(reply.agent_label, "Ollama / validated-model")
        self.assertNotIn("No conversational runtime agent is ready", reply.response_text)

    def test_generation_failure_after_validation_is_not_reported_as_readiness_absence(self) -> None:
        validated_status = ProviderStatus(
            provider="ollama",
            display_name="Ollama",
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message="Ollama ready.",
            is_local=True,
            model="validated-model",
        )
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(RuntimeStatus(ollama=OllamaInstallation(installed=True, path="ollama"))),
            provider_adapters={"ollama": FailingReadyOllamaAdapter()},
            get_config=StaleConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
            get_provider_status=lambda provider: validated_status if provider == "ollama" else None,
        )

        reply = router.route_prompt("Help me inspect my current BABYLON gameplay loop safely.")

        self.assertFalse(reply.routed)
        self.assertEqual(reply.route_state, "runtime_agent_request_failed")
        self.assertIn("Runtime agent request failed", reply.response_text)
        self.assertNotIn("No conversational runtime agent is ready", reply.response_text)
        self.assertIn("Runtime Agent Request Failed", reply.truth_line)

    def test_reports_unrouted_state_when_no_conversational_agent_is_ready(self) -> None:
        router = RuntimeAgentRouter(
            runtime_manager=FakeRuntimeManager(
                RuntimeStatus(openclaw=OpenClawInstallation(installed=True, entrypoint_path="C:/openclaw.mjs"))
            ),
            provider_adapters={"ollama": UnreadyOllamaAdapter()},
            get_config=FakeConfig,
            get_secret_store=lambda: object(),
            provider_timeout_seconds=lambda provider: 1.0,
        )

        reply = router.route_prompt("What can AI-E help with?")

        self.assertFalse(reply.routed)
        self.assertEqual(reply.agent_id, "none")
        self.assertIn("No conversational runtime agent is ready", reply.response_text)
        self.assertIn("OpenClaw", reply.response_text)
        self.assertIn("Runtime Agent Not Routed", reply.truth_line)


if __name__ == "__main__":
    unittest.main()