"""Unified execution contract and executor for capability-driven command handling."""
from __future__ import annotations

from datetime import datetime
import secrets
from typing import TYPE_CHECKING, Protocol

from ..providers.base import ProviderReply
from .capability_models import CapabilityContext, CapabilityEvaluation
from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation
from .execution_models import CapabilityExecutionRequest, CapabilityExecutionResult, ProviderExecutionSnapshot
from .telegram_service import TelegramInboundMessage

if TYPE_CHECKING:
    from .app_service import ControllerService
    from .models import ControllerSnapshot


class ParsedCommandLike(Protocol):
    command_label: str
    argument: str
    normalized_text: str
    usage_hint: str


class CapabilityExecutor:
    """Execute operator-console capabilities through a structured request/result contract."""

    def __init__(self, service: ControllerService) -> None:
        self._service = service

    def execute_telegram(
        self,
        *,
        update: TelegramInboundMessage,
        parsed_command: ParsedCommandLike,
        snapshot: ControllerSnapshot,
        batch_busy: bool = False,
    ) -> CapabilityExecutionResult:
        command = parsed_command.command_label

        if command == "non_text":
            request = self._build_request(
                capability_id="telegram.non_text",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="non_text",
                parsed_arguments={},
                metadata={"argument_summary": "non-text message"},
            )
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="non_text_message",
                user_message=f"{self._service._operator_console_label()} supports plain text Telegram messages only.",
                internal_summary="Rejected non-text Telegram message.",
                retryable=False,
                command_label="non_text",
                activity_state="processing_command",
            )

        if command == "parse_failure":
            request = self._build_request(
                capability_id="telegram.parse_failure",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command=parsed_command.normalized_text or "parse_failure",
                parsed_arguments={"usage_hint": parsed_command.usage_hint},
                metadata={"argument_summary": parsed_command.normalized_text or "malformed command"},
            )
            usage_hint = parsed_command.usage_hint or "Use /help to see supported commands."
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="parse_failure",
                user_message="\n".join(("Couldn't parse that command.", f"Next: {usage_hint}")),
                internal_summary=f"Malformed Telegram command rejected: {parsed_command.normalized_text or 'unknown command'}.",
                retryable=False,
                command_label="parse_failure",
                activity_state="processing_command",
            )

        if command == "plain_text":
            request = self._build_request(
                capability_id="telegram.plain_text",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command=parsed_command.normalized_text or "plain_text",
                parsed_arguments={"text": parsed_command.normalized_text},
                metadata={"argument_summary": "plain text message"},
            )
            if snapshot.runtime_state != "running":
                return self._result(
                    request,
                    outcome="blocked",
                    reason_code="runtime_not_running",
                    user_message="OpenClaw runtime is not available. Start the runtime in the operator console and try again.",
                    internal_summary="Plain text message blocked because runtime is not running.",
                    retryable=True,
                    command_label="plain_text",
                    activity_state="processing_command",
                )
            if snapshot.readiness_state == "not_ready":
                return self._result(
                    request,
                    outcome="blocked",
                    reason_code="readiness_not_ready",
                    user_message="Operator console is not ready. Resolve blocking health or security issues in the operator console and try again.",
                    internal_summary="Plain text message blocked because readiness is not ready.",
                    retryable=True,
                    command_label="plain_text",
                    activity_state="processing_command",
                )
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="plain_text_not_supported",
                user_message="\n".join(
                    (
                        self._service._operator_console_label(),
                        "Use /help to see supported commands.",
                        "Plain text is not treated as /ask automatically.",
                    )
                ),
                internal_summary="Plain text message returned command guidance.",
                retryable=False,
                command_label="plain_text",
                activity_state="processing_command",
            )

        if command == "/start":
            request, _, _ = self._prepare_capability_request(
                capability_id="help.read",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/start",
                parsed_arguments={},
            )
            return self._result(
                request,
                outcome="success",
                reason_code="ok",
                user_message="\n".join(
                    (
                        f"{self._service._operator_console_label()} is connected.",
                        f"Readiness: {self._service._readiness_label(snapshot.readiness_state)}",
                        "Use /help to see supported commands.",
                    )
                ),
                internal_summary="/start returned operator-console connection status.",
                retryable=False,
                command_label="/start",
                activity_state="processing_command",
            )

        if command == "/help":
            return self._execute_help(update=update, snapshot=snapshot)
        if command == "/status":
            return self._execute_status(update=update, snapshot=snapshot)
        if command == "/mode":
            return self._execute_mode(update=update, snapshot=snapshot)
        if command == "/models":
            return self._execute_models(update=update, snapshot=snapshot)
        if command == "/capabilities":
            return self._execute_capabilities(update=update, snapshot=snapshot)
        if command == "/ask":
            return self._execute_provider_query(
                update=update,
                snapshot=snapshot,
                command_label="/ask",
                prompt=parsed_command.argument,
                response_style="concise",
                batch_busy=batch_busy,
            )
        if command == "/askd":
            return self._execute_provider_query(
                update=update,
                snapshot=snapshot,
                command_label="/askd",
                prompt=parsed_command.argument,
                response_style="detailed",
                batch_busy=batch_busy,
            )
        if command == "/confirm":
            return self._execute_confirm(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/deny":
            return self._execute_deny(update=update, snapshot=snapshot, argument=parsed_command.argument)

        request = self._build_request(
            capability_id="telegram.unknown",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=parsed_command.normalized_text or command,
            parsed_arguments={},
            metadata={"argument_summary": parsed_command.normalized_text or command},
        )
        return self._result(
            request,
            outcome="invalid_request",
            reason_code="unknown_command",
            user_message="\n".join(("Couldn't parse that command.", "Next: Use /help to see supported commands.")),
            internal_summary=f"Unknown Telegram command rejected: {command}.",
            retryable=False,
            command_label="parse_failure",
            activity_state="processing_command",
        )

    def _execute_help(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _ = self._prepare_capability_request(
            capability_id="help.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/help",
            parsed_arguments={},
        )
        reply = self._service._build_help_reply().reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="help.read returned the supported Telegram command list.",
            retryable=False,
            command_label="/help",
            activity_state="processing_command",
        )

    def _execute_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _ = self._prepare_capability_request(
            capability_id="status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/status",
            parsed_arguments={},
        )
        reply = self._service._build_status_reply(snapshot).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="status.read returned runtime, health, and readiness state.",
            retryable=False,
            command_label="/status",
            activity_state="processing_command",
        )

    def _execute_mode(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _ = self._prepare_capability_request(
            capability_id="mode.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/mode",
            parsed_arguments={},
        )
        reply = self._service._build_mode_reply(snapshot).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="mode.read returned mode, policy, and remote-use gate state.",
            retryable=False,
            command_label="/mode",
            activity_state="processing_command",
        )

    def _execute_models(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, evaluation, context = self._prepare_capability_request(
            capability_id="models.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/models",
            parsed_arguments={},
        )
        reply = self._service._build_models_reply(evaluation, context).reply
        outcome = "success"
        degraded = False
        retryable = False
        if evaluation.current_availability_state == "degraded":
            outcome = "degraded"
            degraded = True
            retryable = evaluation.reason_code in {"ollama_unavailable", "no_local_models"}
        elif evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
            retryable = True
        return self._result(
            request,
            outcome=outcome,
            reason_code=evaluation.reason_code,
            user_message=reply,
            internal_summary=f"models.read completed with {outcome} state ({evaluation.reason_code}).",
            retryable=retryable,
            degraded=degraded,
            command_label="/models",
            activity_state="processing_command",
            provider_used="ollama",
            mode_used="offline",
        )

    def _execute_capabilities(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _ = self._prepare_capability_request(
            capability_id="capabilities.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/capabilities",
            parsed_arguments={},
        )
        reply = self._service._build_capabilities_reply(snapshot).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="capabilities.read returned the current capability gate summary.",
            retryable=False,
            command_label="/capabilities",
            activity_state="processing_command",
        )

    def _execute_provider_query(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        command_label: str,
        prompt: str,
        response_style: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        prompt = " ".join(prompt.split())
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"prompt": prompt, "response_style": response_style},
            metadata={
                "argument_summary": f"{command_label} [prompt hidden]",
                "response_style": response_style,
            },
        )

        if batch_busy or self._service._is_provider_chat_busy(update.chat_id):
            return self._ask_blocked_result(
                request,
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before sending another ask.",
                reason_code="provider_request_in_flight",
                activity_state="processing_command",
            )

        if not prompt:
            usage = "/askd <prompt>" if command_label == "/askd" else "/ask <prompt>"
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_prompt",
                user_message="\n".join(
                    (
                        "Couldn't run that ask.",
                        "Reason: No prompt was provided.",
                        f"Next: Try {usage}.",
                    )
                ),
                internal_summary=f"{command_label} rejected because no prompt was provided.",
                retryable=False,
                command_label=command_label,
                activity_state="processing_command",
                ask_status=f"{command_label} invalid: missing prompt.",
                hide_content_in_summary=True,
            )

        rate_limited, wait_seconds = self._service._provider_ask_is_rate_limited(update.chat_id)
        if rate_limited:
            return self._ask_blocked_result(
                request,
                reason=f"Provider ask rate limit is active for this chat. Wait about {wait_seconds:.1f}s.",
                next_step="Wait a moment, then resend your ask command.",
                reason_code="provider_rate_limited",
                activity_state="processing_command",
            )

        evaluation, context = self._service._evaluate_command_capability(command_label, snapshot)
        if evaluation is None or context is None:
            return self._ask_blocked_result(
                request,
                reason="Capability evaluation is unavailable.",
                next_step="Run /status from Telegram or the operator console, then try again.",
                reason_code="capability_evaluation_unavailable",
                activity_state="processing_command",
            )
        request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"prompt": prompt, "response_style": response_style},
            context=context,
            metadata={
                "argument_summary": f"{command_label} [prompt hidden]",
                "response_style": response_style,
            },
        )

        if evaluation.current_availability_state == "confirmation_required":
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=prompt,
                response_style=response_style,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._result_from_capability_block(
                request=request,
                evaluation=evaluation,
                command_label=command_label,
            )

        execution_mode = snapshot.mode
        if snapshot.selected_mode == "online" and snapshot.mode != "online":
            execution_mode = "online"
        if execution_mode == "offline":
            return self._run_offline_provider_query(
                request=request,
                context=context,
                chat_id=update.chat_id,
                prompt=prompt,
                response_style=response_style,
                command_label=command_label,
            )
        return self._run_online_provider_query(
            request=request,
            context=context,
            chat_id=update.chat_id,
            prompt=prompt,
            response_style=response_style,
            command_label=command_label,
            confirmation_used=False,
        )

    def _execute_confirm(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        confirmation_id = self._service._normalize_confirmation_id(argument)
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/confirm",
            parsed_arguments={"confirmation_id": confirmation_id},
            metadata={"argument_summary": f"/confirm {confirmation_id}" if confirmation_id else "/confirm <missing>"},
        )
        if not confirmation_id:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_confirmation_id",
                user_message="Use /confirm <id> to approve a pending action.",
                internal_summary="/confirm rejected because no confirmation id was provided.",
                retryable=False,
                command_label="/confirm",
                activity_state="processing_command",
            )

        outcome, confirmation = self._service._confirmation_store.approve(confirmation_id, chat_id=update.chat_id)
        if outcome != "approved" or confirmation is None:
            return self._confirmation_state_result(
                request=request,
                command_label="/confirm",
                confirmation_id=confirmation_id,
                outcome=outcome,
                confirmation=confirmation,
            )

        request = self._build_request(
            capability_id=confirmation.capability_id,
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "response_style": confirmation.response_style,
            },
            confirmation_context=confirmation.evaluation_context,
            metadata={
                "argument_summary": f"/confirm {confirmation.confirmation_id}",
                "response_style": confirmation.response_style,
            },
        )
        return self._execute_confirmed_capability(request=request, confirmation=confirmation, snapshot=snapshot, chat_id=update.chat_id)

    def _execute_deny(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        confirmation_id = self._service._normalize_confirmation_id(argument)
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/deny",
            parsed_arguments={"confirmation_id": confirmation_id},
            metadata={"argument_summary": f"/deny {confirmation_id}" if confirmation_id else "/deny <missing>"},
        )
        if not confirmation_id:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_confirmation_id",
                user_message="Use /deny <id> to reject a pending action.",
                internal_summary="/deny rejected because no confirmation id was provided.",
                retryable=False,
                command_label="/deny",
                activity_state="processing_command",
            )
        outcome, confirmation = self._service._confirmation_store.reject(confirmation_id, chat_id=update.chat_id)
        return self._confirmation_state_result(
            request=request,
            command_label="/deny",
            confirmation_id=confirmation_id,
            outcome=outcome,
            confirmation=confirmation,
        )

    def _execute_confirmed_capability(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        if confirmation.capability_id != "ask.provider_query":
            message = f"Confirmation {confirmation.confirmation_id} cannot run because the capability is no longer supported."
            self._service._last_confirmation_result = message
            return self._result(
                request,
                outcome="failed",
                reason_code="unsupported_confirmation_capability",
                user_message="\n".join(
                    (
                        f"Confirmation {confirmation.confirmation_id} could not run.",
                        "Reason: The capability is no longer supported for confirmation execution.",
                        "Next: Send the original command again after checking the operator console.",
                    )
                ),
                internal_summary=message,
                retryable=False,
                command_label="/confirm",
                activity_state="provider_failed",
                confirmation_used=True,
            )
        return self._execute_confirmed_provider_query(
            request=request,
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
        )

    def _execute_confirmed_provider_query(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        if self._service._is_provider_chat_busy(chat_id):
            return self._confirmation_result(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                outcome="blocked",
                reason_code="provider_request_in_flight",
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before confirming another action.",
                retryable=True,
            )
        if confirmation.evaluation_context.selected_mode == "online" and snapshot.selected_mode != "online":
            return self._confirmation_result(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                outcome="blocked",
                reason_code="selected_mode_changed",
                reason="Selected mode changed after this confirmation was created.",
                next_step="Re-select Online Mode, resend the original command, and confirm the new request.",
                retryable=True,
            )

        evaluation, context = self._service._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=confirmation.requester_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "response_style": confirmation.response_style,
            },
            context=context,
            confirmation_context=confirmation.evaluation_context,
            metadata={
                "argument_summary": f"/confirm {confirmation.confirmation_id}",
                "response_style": confirmation.response_style,
            },
        )
        if evaluation.current_availability_state != "allowed":
            return self._blocked_confirmation_from_evaluation(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                evaluation=evaluation,
            )

        use_online_provider = confirmation.evaluation_context.selected_mode == "online" or snapshot.mode == "online"
        if use_online_provider:
            return self._run_online_provider_query(
                request=request,
                context=context,
                chat_id=chat_id,
                prompt=confirmation.prompt_text,
                response_style=confirmation.response_style,
                command_label="/confirm",
                confirmation_used=True,
                confirmation_id=confirmation.confirmation_id,
            )
        return self._run_offline_provider_query(
            request=request,
            context=context,
            chat_id=chat_id,
            prompt=confirmation.prompt_text,
            response_style=confirmation.response_style,
            command_label="/confirm",
            confirmation_used=True,
            confirmation_id=confirmation.confirmation_id,
        )

    def _run_offline_provider_query(
        self,
        *,
        request: CapabilityExecutionRequest,
        context: CapabilityContext,
        chat_id: str,
        prompt: str,
        response_style: str,
        command_label: str,
        confirmation_used: bool = False,
        confirmation_id: str = "",
    ) -> CapabilityExecutionResult:
        provider_status = context.offline_provider_status
        provider_name = "Ollama"
        mode_label = "Offline"
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on {command_label} via {provider_name}.",
            activity=True,
            last_command=command_label,
            last_ask_status=self._progress_ask_status(command_label, confirmation_id),
        )
        self._service._mark_provider_ask_started(chat_id)
        result = self._service._run_provider_request(
            provider="ollama",
            chat_id=chat_id,
            func=lambda: self._service._provider_adapters["ollama"].ask(  # type: ignore[call-arg]
                runtime_status=self._service._runtime_manager.get_status(),
                base_url=self._service._config.ollama_base_url,
                preferred_model=self._service._config.preferred_ollama_model,
                prompt=prompt,
                response_style=response_style,
            ),
        )
        if result.state == "timeout":
            return self._provider_timeout_result(
                request=request,
                provider_name=provider_name,
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._provider_failure_result(
                request=request,
                provider_name=provider_name,
                reason=result.error_message or "Provider request failed before a reply was returned.",
                next_step="Check Ollama and try again.",
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        reply = result.reply
        if not reply.ok:
            return self._provider_failure_result(
                request=request,
                provider_name=provider_name,
                reason=reply.message,
                next_step="Check Ollama and rerun /models or provider validation.",
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        model = reply.model or provider_status.model or provider_name
        ask_status = self._completed_ask_status(command_label, provider_name, model, confirmation_id)
        internal_summary = ask_status
        if confirmation_id:
            self._service._last_confirmation_result = f"Confirmation {confirmation_id} approved and completed via {provider_name}."
            internal_summary = self._service._last_confirmation_result
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._provider_success_message(
                reply_text=reply.text,
                provider_key="ollama",
                provider_model=model,
                mode_label=mode_label,
                response_style=response_style,
                confirmation_id=confirmation_id,
            ),
            internal_summary=internal_summary,
            retryable=False,
            command_label=command_label,
            activity_state="waiting_on_provider",
            ask_status=ask_status,
            hide_content_in_summary=True,
            provider_used="ollama",
            mode_used="offline",
            confirmation_used=confirmation_used,
            telemetry={"provider_model": model},
        )

    def _run_online_provider_query(
        self,
        *,
        request: CapabilityExecutionRequest,
        context: CapabilityContext,
        chat_id: str,
        prompt: str,
        response_style: str,
        command_label: str,
        confirmation_used: bool,
        confirmation_id: str = "",
    ) -> CapabilityExecutionResult:
        provider_status = context.online_provider_status
        provider_name = "OpenAI"
        mode_label = "Online"
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on {command_label} via {provider_name}.",
            activity=True,
            last_command=command_label,
            last_ask_status=self._progress_ask_status(command_label, confirmation_id),
        )
        self._service._mark_provider_ask_started(chat_id)
        result = self._service._run_provider_request(
            provider="openai",
            chat_id=chat_id,
            func=lambda: self._service._provider_adapters["openai"].ask(  # type: ignore[call-arg]
                secret_store=self._service._secret_store,
                secret_id=self._service._config.openai_secret_id,
                transient_secret="",
                prompt=prompt,
                response_style=response_style,
            ),
        )
        if result.state == "timeout":
            return self._provider_timeout_result(
                request=request,
                provider_name=provider_name,
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._provider_failure_result(
                request=request,
                provider_name=provider_name,
                reason=result.error_message or "Provider request failed before a reply was returned.",
                next_step="Check the online provider configuration and try again.",
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        reply = result.reply
        if not reply.ok:
            return self._provider_failure_result(
                request=request,
                provider_name=provider_name,
                reason=reply.message,
                next_step="Check the online provider configuration and try again.",
                command_label=command_label,
                confirmation_used=confirmation_used,
                confirmation_id=confirmation_id,
            )
        model = reply.model or provider_status.model or provider_name
        ask_status = self._completed_ask_status(command_label, provider_name, model, confirmation_id)
        internal_summary = ask_status
        if confirmation_id:
            self._service._last_confirmation_result = f"Confirmation {confirmation_id} approved and completed via {provider_name}."
            internal_summary = self._service._last_confirmation_result
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._provider_success_message(
                reply_text=reply.text,
                provider_key="openai",
                provider_model=model,
                mode_label=mode_label,
                response_style=response_style,
                confirmation_id=confirmation_id,
            ),
            internal_summary=internal_summary,
            retryable=False,
            command_label=command_label,
            activity_state="waiting_on_provider",
            ask_status=ask_status,
            hide_content_in_summary=True,
            provider_used="openai",
            mode_used="online",
            confirmation_used=confirmation_used,
            telemetry={"provider_model": model},
        )

    def _result_from_capability_block(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        command_label: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "runtime_not_running": "Start the runtime in the operator console and try again.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before asking again.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console.",
            "policy_always_offline": "Switch to Offline Mode or change policy before retrying the remote ask.",
            "online_confirmation_required": "Approve the pending remote request with /confirm <id> after /ask returns a confirmation prompt.",
        }
        reason = evaluation.blocking_reason or evaluation.message
        next_step = next_step_map.get(evaluation.reason_code, "Check the operator console configuration and try again.")
        outcome = "blocked"
        retryable = True
        degraded = False
        if evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
        elif evaluation.current_availability_state == "degraded":
            outcome = "degraded"
            degraded = True
        return self._ask_blocked_result(
            request,
            reason=reason,
            next_step=next_step,
            reason_code=evaluation.reason_code,
            activity_state="provider_failed" if outcome in {"unavailable", "degraded"} else "processing_command",
            outcome=outcome,
            retryable=retryable,
            degraded=degraded,
        )

    def _ask_blocked_result(
        self,
        request: CapabilityExecutionRequest,
        *,
        reason: str,
        next_step: str,
        reason_code: str,
        activity_state: str,
        outcome: str = "blocked",
        retryable: bool = True,
        degraded: bool = False,
    ) -> CapabilityExecutionResult:
        command_label = request.original_command
        title = "Can't run /askd right now." if command_label == "/askd" else "Can't run /ask right now."
        ask_status = f"{command_label} {outcome}: {reason}"
        self._service._update_telegram_loop_status(
            state="running",
            activity_state=activity_state,
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=ask_status,
        )
        return self._result(
            request,
            outcome=outcome,
            reason_code=reason_code,
            user_message="\n".join((title, f"Reason: {reason}", f"Next: {next_step}")),
            internal_summary=ask_status,
            retryable=retryable,
            degraded=degraded,
            command_label=command_label,
            activity_state=activity_state,
            ask_status=ask_status,
            hide_content_in_summary=True,
        )

    def _confirmation_required_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        context: CapabilityContext,
        snapshot: ControllerSnapshot,
        prompt: str,
        response_style: str,
        chat_id: str,
        requester_label: str,
    ) -> CapabilityExecutionResult:
        confirmation = self._service._confirmation_store.create(
            capability_id=evaluation.capability_id,
            original_command=request.original_command,
            argument_summary=f"{request.original_command} [prompt hidden]",
            prompt_text=prompt,
            response_style=response_style,
            chat_id=chat_id,
            requester_label=requester_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
        )
        expires_in = self._service._confirmation_seconds_remaining(confirmation)
        ask_status = f"{request.original_command} awaiting confirmation {confirmation.confirmation_id}."
        self._service._last_confirmation_requested = f"{confirmation.confirmation_id} pending for {evaluation.capability_id} ({request.original_command})."
        self._service._last_confirmation_result = f"{confirmation.confirmation_id} pending approval."
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=f"Confirmation {confirmation.confirmation_id} created for {evaluation.capability_id}.",
            activity=True,
            last_command=request.original_command,
            last_ask_status=ask_status,
        )
        return self._result(
            request,
            outcome="confirmation_required",
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    "Action requires confirmation.",
                    f"Action: {request.original_command} (prompt hidden)",
                    f"Capability: {evaluation.capability_id}",
                    f"Reason: {self._service._confirmation_reason_message(evaluation.reason_code)}",
                    f"ID: {confirmation.confirmation_id} (expires in about {expires_in}s)",
                    f"Reply with: /confirm {confirmation.confirmation_id} or /deny {confirmation.confirmation_id}",
                )
            ),
            internal_summary=f"Confirmation {confirmation.confirmation_id} created for {evaluation.capability_id}.",
            retryable=False,
            command_label=request.original_command,
            activity_state="processing_command",
            ask_status=ask_status,
            hide_content_in_summary=True,
            mode_used=request.selected_mode_snapshot,
            provider_used=request.provider_snapshot.selected_provider,
            telemetry={"confirmation_id": confirmation.confirmation_id},
        )

    def _confirmation_state_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        command_label: str,
        confirmation_id: str,
        outcome: str,
        confirmation: PendingConfirmation | None,
    ) -> CapabilityExecutionResult:
        if outcome in {"not_found", "wrong_chat"}:
            message = f"No pending confirmation matches {confirmation_id} for this chat."
            self._service._last_confirmation_result = message
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="confirmation_not_found" if outcome == "not_found" else "confirmation_wrong_chat",
                user_message="\n".join((message, "Next: Send the original command again if you still want to run it.")),
                internal_summary=message,
                retryable=False,
                command_label=command_label,
                activity_state="processing_command",
            )
        if outcome == "expired" or (confirmation is not None and confirmation.current_state == "expired"):
            return self._confirmation_result(
                request=request,
                confirmation_id=confirmation_id,
                outcome="expired",
                reason_code="confirmation_expired",
                reason="This confirmation is no longer valid.",
                next_step="Send the original command again to request a new confirmation.",
                retryable=False,
            )
        if outcome == "rejected":
            message = f"Confirmation {confirmation_id} denied. Request not executed."
            self._service._last_confirmation_result = message
            return self._result(
                request,
                outcome="denied",
                reason_code="confirmation_denied",
                user_message=message,
                internal_summary=message,
                retryable=False,
                command_label=command_label,
                activity_state="processing_command",
            )
        if outcome == "already_used" and confirmation is not None:
            if confirmation.current_state == "approved":
                return self._confirmation_result(
                    request=request,
                    confirmation_id=confirmation_id,
                    outcome="invalid_request",
                    reason_code="confirmation_already_used",
                    reason="This confirmation has already been consumed.",
                    next_step="Send the original command again if you need a new request.",
                    retryable=False,
                )
            if confirmation.current_state == "rejected":
                return self._confirmation_result(
                    request=request,
                    confirmation_id=confirmation_id,
                    outcome="invalid_request",
                    reason_code="confirmation_already_denied",
                    reason="This confirmation has already been rejected.",
                    next_step="Send the original command again if you want a fresh confirmation prompt.",
                    retryable=False,
                )
        return self._confirmation_result(
            request=request,
            confirmation_id=confirmation_id,
            outcome="failed",
            reason_code="confirmation_invalid_state",
            reason="The confirmation state is no longer valid.",
            next_step="Send the original command again if you still want to run it.",
            retryable=False,
        )

    def _blocked_confirmation_from_evaluation(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation_id: str,
        evaluation: CapabilityEvaluation,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "runtime_not_running": "Start the runtime in the operator console and resend the original command.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console, then resend the original command.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before retrying the original command.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console before retrying the original command.",
            "policy_always_offline": "Switch to Offline Mode or resend the original command after changing policy in the operator console.",
            "online_confirmation_required": "Resend the original command to request a fresh confirmation.",
        }
        outcome = "blocked"
        if evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
        elif evaluation.current_availability_state == "degraded":
            outcome = "degraded"
        return self._confirmation_result(
            request=request,
            confirmation_id=confirmation_id,
            outcome=outcome,
            reason_code=evaluation.reason_code,
            reason=evaluation.blocking_reason or evaluation.message,
            next_step=next_step_map.get(evaluation.reason_code, "Check the operator console configuration and resend the original command."),
            retryable=True,
            degraded=outcome == "degraded",
        )

    def _confirmation_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation_id: str,
        outcome: str,
        reason_code: str,
        reason: str,
        next_step: str,
        retryable: bool,
        degraded: bool = False,
    ) -> CapabilityExecutionResult:
        state_label_map = {
            "blocked": "could not run",
            "unavailable": "could not run",
            "degraded": "completed in degraded mode",
            "expired": "expired",
            "invalid_request": "was already used",
            "failed": "could not be processed",
            "timed_out": "timed out",
        }
        state_label = state_label_map.get(outcome, "could not run")
        summary = f"Confirmation {confirmation_id} {state_label}."
        self._service._last_confirmation_result = summary
        return self._result(
            request,
            outcome=outcome,
            reason_code=reason_code,
            user_message="\n".join((summary, f"Reason: {reason}", f"Next: {next_step}")),
            internal_summary=summary,
            retryable=retryable,
            degraded=degraded,
            command_label=request.original_command,
            activity_state="processing_command",
            confirmation_used=True,
        )

    def _provider_timeout_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        provider_name: str,
        command_label: str,
        confirmation_used: bool,
        confirmation_id: str,
    ) -> CapabilityExecutionResult:
        reason = f"{provider_name} did not finish before the timeout."
        ask_status = self._timeout_ask_status(command_label, provider_name, confirmation_id)
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="timed_out",
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=ask_status,
        )
        if confirmation_id:
            self._service._last_confirmation_result = f"Confirmation {confirmation_id} timed out via {provider_name}."
        return self._result(
            request,
            outcome="timed_out",
            reason_code="provider_timeout",
            user_message="\n".join(
                (
                    f"Confirmation {confirmation_id} timed out." if confirmation_id else "Provider request timed out.",
                    f"Reason: {reason}",
                    "Next: Send the original command again if you still want to run it." if confirmation_id else "Next: Wait a moment, then try again.",
                )
            ),
            internal_summary=self._service._last_confirmation_result if confirmation_id else ask_status,
            retryable=True,
            command_label=command_label,
            activity_state="timed_out",
            ask_status=ask_status,
            hide_content_in_summary=True,
            provider_used=request.provider_snapshot.selected_provider,
            mode_used=request.selected_mode_snapshot if request.selected_mode_snapshot == "online" else request.mode_snapshot,
            confirmation_used=confirmation_used,
        )

    def _provider_failure_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        provider_name: str,
        reason: str,
        next_step: str,
        command_label: str,
        confirmation_used: bool,
        confirmation_id: str,
    ) -> CapabilityExecutionResult:
        summary = f"Confirmation {confirmation_id} could not run." if confirmation_id else f"{command_label} failed via {provider_name}."
        if confirmation_id:
            self._service._last_confirmation_result = summary
            user_message = "\n".join((summary, f"Reason: {reason}", f"Next: {next_step}"))
            reason_code = "provider_failure_after_confirmation"
        else:
            title = "Can't run /askd right now." if command_label == "/askd" else "Can't run /ask right now."
            user_message = "\n".join((title, f"Reason: {reason}", f"Next: {next_step}"))
            reason_code = "provider_execution_failed"
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="provider_failed",
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=summary,
        )
        return self._result(
            request,
            outcome="failed",
            reason_code=reason_code,
            user_message=user_message,
            internal_summary=summary,
            retryable=True,
            command_label=command_label,
            activity_state="provider_failed",
            ask_status=summary,
            hide_content_in_summary=True,
            provider_used=request.provider_snapshot.selected_provider,
            mode_used=request.selected_mode_snapshot if request.selected_mode_snapshot == "online" else request.mode_snapshot,
            confirmation_used=confirmation_used,
        )

    def _provider_success_message(
        self,
        *,
        reply_text: str,
        provider_key: str,
        provider_model: str,
        mode_label: str,
        response_style: str,
        confirmation_id: str,
    ) -> str:
        formatted = self._service._format_ask_success(
            reply_text,
            provider_label=self._service._provider_label(provider_key, provider_model),  # type: ignore[arg-type]
            mode_label=mode_label,
            response_style=response_style,
        )
        if confirmation_id:
            return "\n".join((f"Confirmation {confirmation_id} approved.", formatted))
        return formatted

    def _prepare_capability_request(
        self,
        *,
        capability_id: str,
        snapshot: ControllerSnapshot,
        chat_id: str,
        requester_label: str,
        original_command: str,
        parsed_arguments: dict[str, str],
        confirmation_granted: bool = False,
        confirmation_context: ConfirmationContextSnapshot | None = None,
        metadata: dict[str, object] | None = None,
    ) -> tuple[CapabilityExecutionRequest, CapabilityEvaluation, CapabilityContext]:
        evaluation, context = self._service._evaluate_capability_id(
            capability_id,
            snapshot,
            remember=True,
            confirmation_granted=confirmation_granted,
        )
        request = self._build_request(
            capability_id=capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=requester_label,
            original_command=original_command,
            parsed_arguments=parsed_arguments,
            context=context,
            confirmation_context=confirmation_context,
            metadata=metadata,
        )
        return request, evaluation, context

    def _build_request(
        self,
        *,
        capability_id: str,
        snapshot: ControllerSnapshot,
        chat_id: str,
        requester_label: str,
        original_command: str,
        parsed_arguments: dict[str, str],
        context: CapabilityContext | None = None,
        confirmation_context: ConfirmationContextSnapshot | None = None,
        metadata: dict[str, object] | None = None,
    ) -> CapabilityExecutionRequest:
        provider_snapshot = self._provider_snapshot(snapshot, context=context)
        return CapabilityExecutionRequest(
            request_id=self._generate_request_id(),
            capability_id=capability_id,
            source="telegram",
            user_id=chat_id,
            chat_id=chat_id,
            requester_label=requester_label,
            original_command=original_command,
            parsed_arguments=dict(parsed_arguments),
            invocation_timestamp=self._service._now_iso(),
            mode_snapshot=snapshot.mode,
            selected_mode_snapshot=snapshot.selected_mode,
            policy_snapshot=snapshot.policy,
            provider_snapshot=provider_snapshot,
            confirmation_context=confirmation_context,
            readiness_snapshot=snapshot.readiness_state,
            metadata=dict(metadata or {}),
        )

    def _provider_snapshot(
        self,
        snapshot: ControllerSnapshot,
        *,
        context: CapabilityContext | None,
    ) -> ProviderExecutionSnapshot:
        if context is not None:
            offline_status = context.offline_provider_status
            online_status = context.online_provider_status
        else:
            offline_status = self._service._provider_status_cache.get("ollama") or self._service._default_provider_status("ollama")
            online_status = self._service._provider_status_cache.get("openai") or self._service._default_provider_status("openai")
        active_status = offline_status if snapshot.active_provider == "ollama" else online_status
        return ProviderExecutionSnapshot(
            active_provider=snapshot.active_provider,
            selected_provider=snapshot.selected_provider,
            active_provider_state=active_status.validation_state,
            active_provider_message=active_status.message,
            active_provider_model=active_status.model,
            offline_provider_state=offline_status.validation_state,
            offline_provider_message=offline_status.message,
            offline_provider_model=offline_status.model,
            online_provider_state=online_status.validation_state,
            online_provider_message=online_status.message,
            online_provider_model=online_status.model,
        )

    def _result(
        self,
        request: CapabilityExecutionRequest,
        *,
        outcome: str,
        reason_code: str,
        user_message: str,
        internal_summary: str,
        retryable: bool,
        command_label: str,
        activity_state: str,
        degraded: bool = False,
        provider_used: str = "",
        mode_used: str = "",
        confirmation_used: bool = False,
        ask_status: str = "",
        hide_content_in_summary: bool = False,
        telemetry: dict[str, object] | None = None,
    ) -> CapabilityExecutionResult:
        finished_at = self._service._now_iso()
        duration_ms = max(0, int((datetime.fromisoformat(finished_at) - datetime.fromisoformat(request.invocation_timestamp)).total_seconds() * 1000))
        summary = self._service._summarize_text(internal_summary, limit=180)
        return CapabilityExecutionResult(
            request=request,
            request_id=request.request_id,
            capability_id=request.capability_id,
            outcome=outcome,  # type: ignore[arg-type]
            outcome_reason_code=reason_code,
            user_message=user_message,
            internal_summary=summary,
            started_at=request.invocation_timestamp,
            finished_at=finished_at,
            duration_ms=duration_ms,
            confirmation_used=confirmation_used,
            provider_used=provider_used,
            mode_used=mode_used or request.mode_snapshot,
            degraded=degraded,
            retryable=retryable,
            command_label=command_label,
            activity_state=activity_state,
            ask_status=ask_status,
            hide_content_in_summary=hide_content_in_summary,
            telemetry=dict(telemetry or {}),
        )

    def _progress_ask_status(self, command_label: str, confirmation_id: str) -> str:
        if confirmation_id:
            return f"Confirmation {confirmation_id} in progress."
        return f"{command_label} in progress."

    def _completed_ask_status(self, command_label: str, provider_name: str, model: str, confirmation_id: str) -> str:
        if confirmation_id:
            return f"Confirmation {confirmation_id} completed via {provider_name} / {model}."
        return f"{command_label} completed via {provider_name} / {model}."

    def _timeout_ask_status(self, command_label: str, provider_name: str, confirmation_id: str) -> str:
        if confirmation_id:
            return f"Confirmation {confirmation_id} timed out via {provider_name}."
        return f"{command_label} timed out via {provider_name}."

    def _confirmation_context_snapshot(
        self,
        snapshot: ControllerSnapshot,
        context: CapabilityContext,
    ) -> ConfirmationContextSnapshot:
        selected_online = snapshot.selected_mode == "online"
        provider_status = context.online_provider_status if selected_online else context.offline_provider_status
        return ConfirmationContextSnapshot(
            mode=snapshot.mode,
            selected_mode=snapshot.selected_mode,
            policy=snapshot.policy,
            active_provider=snapshot.active_provider,
            selected_provider=snapshot.selected_provider,
            readiness_state=snapshot.readiness_state,
            provider_state=provider_status.validation_state,
            provider_message=provider_status.message,
        )

    @staticmethod
    def _generate_request_id() -> str:
        return f"REQ-{secrets.token_hex(4).upper()}"
