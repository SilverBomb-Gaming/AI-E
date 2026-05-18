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