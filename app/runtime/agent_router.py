"""Governed routing for conversation prompts into runtime agents."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal, Protocol

from ..providers import ProviderReply, ProviderStatus


RuntimeAgentKind = Literal["openclaw", "ollama", "openai", "none"]


@dataclass(frozen=True)
class RuntimeAgentHandshake:
    agent_id: RuntimeAgentKind
    display_name: str
    available: bool
    online: bool
    capability_state: str
    status_message: str


@dataclass(frozen=True)
class RuntimePromptEnvelope:
    user_prompt: str
    intent_class: str
    workflow_scope_line: str = "Scope: conversation | Risk: none | Approval Not Required | Boundary: read_only_runtime_response"
    workflow_runtime_instruction: str = "Workflow scope analysis unavailable. Treat this as read-only conversation."
    mutation_allowed: bool = False
    execution_allowed: bool = False
    approval_required_for_action: bool = True


@dataclass(frozen=True)
class RuntimeAgentReply:
    agent_id: RuntimeAgentKind
    agent_label: str
    routed: bool
    route_state: str
    response_text: str
    truth_line: str
    mutation_status: str = "Mutation Not Applied"
    validation_status: str = "Validation Not Run"
    approval_state: str = "No Approval Requested"
    audit_visibility: str = "Runtime route visible in conversation"


class RuntimeManagerLike(Protocol):
    def get_status(self) -> object:
        raise NotImplementedError


class RuntimeAgentRouter:
    """Routes natural prompts to real agents while preserving AI-E governance."""

    def __init__(
        self,
        *,
        runtime_manager: RuntimeManagerLike,
        provider_adapters: dict[str, object],
        get_config: Callable[[], object],
        get_secret_store: Callable[[], object],
        provider_timeout_seconds: Callable[[str], float],
    ) -> None:
        self._runtime_manager = runtime_manager
        self._provider_adapters = provider_adapters
        self._get_config = get_config
        self._get_secret_store = get_secret_store
        self._provider_timeout_seconds = provider_timeout_seconds

    def handshakes(self) -> tuple[RuntimeAgentHandshake, ...]:
        config = self._get_config()
        status = self._runtime_manager.get_status()
        openclaw = getattr(status, "openclaw", None)
        ollama_status = self._validate_ollama(config, status)
        openai_status = self._validate_openai(config)
        runtime_state = str(getattr(status, "runtime_state", "stopped"))

        return (
            RuntimeAgentHandshake(
                agent_id="openclaw",
                display_name="OpenClaw",
                available=bool(getattr(openclaw, "installed", False)),
                online=runtime_state == "running",
                capability_state="gateway_running" if runtime_state == "running" else "detected" if bool(getattr(openclaw, "installed", False)) else "unavailable",
                status_message=str(getattr(openclaw, "detail", "") or getattr(status, "status_message", "OpenClaw status unknown.")),
            ),
            self._provider_handshake("ollama", "Ollama", ollama_status),
            self._provider_handshake("openai", "OpenAI", openai_status),
        )

    def route_prompt(self, prompt: str, *, workflow_scope: object | None = None) -> RuntimeAgentReply:
        intent_class = str(getattr(workflow_scope, "intent_class", self._classify_intent(prompt)))
        envelope = RuntimePromptEnvelope(
            user_prompt=" ".join(prompt.split()),
            intent_class=intent_class,
            workflow_scope_line=str(getattr(workflow_scope, "truth_scope_line", RuntimePromptEnvelope.workflow_scope_line)),
            workflow_runtime_instruction=str(
                workflow_scope.runtime_instruction() if workflow_scope is not None and hasattr(workflow_scope, "runtime_instruction") else RuntimePromptEnvelope.workflow_runtime_instruction
            ),
            mutation_allowed=bool(getattr(workflow_scope, "mutation_allowed", False)),
            execution_allowed=bool(getattr(workflow_scope, "runtime_execution_allowed", False)),
            approval_required_for_action=bool(getattr(workflow_scope, "approval_required", True)),
        )
        if not envelope.user_prompt:
            return self._unrouted_reply("No prompt was provided.")

        config = self._get_config()
        mode = str(getattr(config, "current_mode", "offline"))
        if mode == "online":
            reply = self._ask_openai(config, envelope)
            if reply is not None:
                return reply
        else:
            reply = self._ask_ollama(config, envelope)
            if reply is not None:
                return reply

        handshakes = self.handshakes()
        available = ", ".join(item.display_name for item in handshakes if item.available) or "no runtime agents"
        return self._unrouted_reply(
            "No conversational runtime agent is ready yet. "
            f"Detected: {available}. Start or validate a runtime agent, then resend the prompt."
        )

    def _ask_ollama(self, config: object, envelope: RuntimePromptEnvelope) -> RuntimeAgentReply | None:
        adapter = self._provider_adapters.get("ollama")
        if adapter is None or not hasattr(adapter, "ask"):
            return None
        response = adapter.ask(  # type: ignore[attr-defined]
            runtime_status=self._runtime_manager.get_status(),
            base_url=str(getattr(config, "ollama_base_url", "http://127.0.0.1:11434")),
            preferred_model=str(getattr(config, "preferred_ollama_model", "")),
            prompt=self._runtime_prompt(envelope),
            response_style="concise",
            timeout_seconds=self._provider_timeout_seconds("ollama"),
        )
        if not isinstance(response, ProviderReply) or not response.ok:
            return None
        model = response.model or "local model"
        return self._routed_reply("ollama", f"Ollama / {model}", response.text, envelope)

    def _ask_openai(self, config: object, envelope: RuntimePromptEnvelope) -> RuntimeAgentReply | None:
        adapter = self._provider_adapters.get("openai")
        if adapter is None or not hasattr(adapter, "ask"):
            return None
        response = adapter.ask(  # type: ignore[attr-defined]
            secret_store=self._get_secret_store(),
            secret_id=str(getattr(config, "openai_secret_id", "openai/default")),
            transient_secret="",
            prompt=self._runtime_prompt(envelope),
            response_style="concise",
        )
        if not isinstance(response, ProviderReply) or not response.ok:
            return None
        model = response.model or "OpenAI"
        return self._routed_reply("openai", f"OpenAI / {model}", response.text, envelope)

    def _validate_ollama(self, config: object, status: object) -> ProviderStatus | None:
        adapter = self._provider_adapters.get("ollama")
        if adapter is None or not hasattr(adapter, "validate"):
            return None
        try:
            result = adapter.validate(  # type: ignore[attr-defined]
                runtime_status=status,
                base_url=str(getattr(config, "ollama_base_url", "http://127.0.0.1:11434")),
                preferred_model=str(getattr(config, "preferred_ollama_model", "")),
            )
        except Exception:  # noqa: BLE001
            return None
        return result if isinstance(result, ProviderStatus) else None

    def _validate_openai(self, config: object) -> ProviderStatus | None:
        adapter = self._provider_adapters.get("openai")
        if adapter is None or not hasattr(adapter, "validate"):
            return None
        try:
            result = adapter.validate(  # type: ignore[attr-defined]
                secret_store=self._get_secret_store(),
                secret_id=str(getattr(config, "openai_secret_id", "openai/default")),
                transient_secret="",
            )
        except Exception:  # noqa: BLE001
            return None
        return result if isinstance(result, ProviderStatus) else None

    @staticmethod
    def _provider_handshake(agent_id: RuntimeAgentKind, display_name: str, status: ProviderStatus | None) -> RuntimeAgentHandshake:
        if status is None:
            return RuntimeAgentHandshake(agent_id, display_name, False, False, "unavailable", f"{display_name} adapter unavailable.")
        return RuntimeAgentHandshake(
            agent_id=agent_id,
            display_name=display_name,
            available=status.available,
            online=status.ready,
            capability_state="ready" if status.ready else status.validation_state,
            status_message=status.message,
        )

    @staticmethod
    def _classify_intent(prompt: str) -> str:
        normalized = prompt.lower()
        if any(term in normalized for term in ("change", "fix", "patch", "write", "delete", "create")):
            return "mutation_or_plan_request"
        if any(term in normalized for term in ("inspect", "review", "why", "explain", "analyze")):
            return "inspection_or_explanation"
        return "conversation"

    @staticmethod
    def _runtime_prompt(envelope: RuntimePromptEnvelope) -> str:
        return (
            "AI-E governance envelope: answer the user's prompt as the selected runtime agent. "
            "Do not claim file mutation, validation, playtest, deployment, or command execution. "
            "If action is needed, describe the next bounded step and say approval is required before execution. "
            f"{envelope.workflow_runtime_instruction} "
            f"Intent class: {envelope.intent_class}. "
            f"Mutation allowed: {envelope.mutation_allowed}. Execution allowed: {envelope.execution_allowed}.\n\n"
            f"User prompt: {envelope.user_prompt}"
        )

    @staticmethod
    def _routed_reply(agent_id: RuntimeAgentKind, agent_label: str, response_text: str, envelope: RuntimePromptEnvelope) -> RuntimeAgentReply:
        approval_state = "Approval Required Before Action" if envelope.approval_required_for_action else "No Approval Requested"
        return RuntimeAgentReply(
            agent_id=agent_id,
            agent_label=agent_label,
            routed=True,
            route_state="runtime_agent_response",
            response_text=response_text,
            truth_line=f"Runtime Agent Routed | {envelope.workflow_scope_line} | Mutation Not Applied | Validation Not Run | {approval_state} | Audit Visible",
            approval_state=approval_state,
        )

    @staticmethod
    def _unrouted_reply(message: str) -> RuntimeAgentReply:
        return RuntimeAgentReply(
            agent_id="none",
            agent_label="No runtime agent",
            routed=False,
            route_state="runtime_agent_unavailable",
            response_text=message,
            truth_line="Runtime Agent Not Routed | Mutation Not Applied | Validation Not Run | Approval Not Requested | Audit Visible",
        )