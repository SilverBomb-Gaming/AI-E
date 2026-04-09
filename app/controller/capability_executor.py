"""Unified execution contract and executor for capability-driven command handling."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import secrets
from typing import TYPE_CHECKING, Protocol

from ..providers.base import ProviderReply
from .capability_models import CapabilityContext, CapabilityEvaluation
from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation
from .context_models import BufferedContext
from .execution_models import CapabilityExecutionRequest, CapabilityExecutionResult, ProviderExecutionSnapshot
from .execution_models import LocalCommandExecutionRequest
from .execution_runner import ExecutionRunnerError
from .node_router import NodeRoutingError
from .file_mutator import (
    FileCreateWriteRequest,
    FileMutatorError,
    FilePatchMutationRequest,
    FileWriteReplaceRequest,
    parse_create_command,
    parse_patch_command,
    parse_write_command,
    summarize_create_request,
    summarize_patch_request,
    summarize_write_request,
)
from .file_reader import FileReaderError
from .project_bootstrap_models import ProjectBootstrapExecutionRecord
from .repo_inspector import RepoInspectorError
from .scope_models import ExecutionScope
from .telegram_service import TelegramInboundMessage
from .web_fetcher import WebFetchError

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
            scope_failure = self._scope_failure_result(request, command_label="non_text")
            if scope_failure is not None:
                return scope_failure
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
            scope_failure = self._scope_failure_result(request, command_label="parse_failure")
            if scope_failure is not None:
                return scope_failure
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
            scope_failure = self._scope_failure_result(request, command_label="plain_text")
            if scope_failure is not None:
                return scope_failure
            if not snapshot.runtime_active:
                return self._result(
                    request,
                    outcome="blocked",
                    reason_code="runtime_not_active",
                    user_message="Runtime is not active. Use /startruntime to enable execution first.",
                    internal_summary="Plain text message blocked because runtime activation is disabled.",
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
            request, _, _, scope_failure = self._prepare_capability_request(
                capability_id="help.read",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/start",
                parsed_arguments={},
            )
            if scope_failure is not None:
                return scope_failure
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
        if command == "/startruntime":
            return self._execute_start_runtime(update=update, snapshot=snapshot)
        if command == "/nodes":
            return self._execute_nodes(update=update, snapshot=snapshot)
        if command == "/nodeview":
            return self._execute_node_view(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/nodeselect":
            return self._execute_node_select(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/nodeclear":
            return self._execute_node_clear(update=update, snapshot=snapshot)
        if command == "/status":
            return self._execute_status(update=update, snapshot=snapshot)
        if command == "/lastaction":
            return self._execute_last_action(update=update, snapshot=snapshot)
        if command == "/chat":
            return self._execute_chat(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/translate":
            return self._execute_translate(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/refine":
            return self._execute_refine(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/translateview":
            return self._execute_translate_view(update=update, snapshot=snapshot)
        if command == "/translateclear":
            return self._execute_translate_clear(update=update, snapshot=snapshot)
        if command == "/planbuild":
            return self._execute_plan_build(update=update, snapshot=snapshot)
        if command == "/planstep":
            return self._execute_plan_step(update=update, snapshot=snapshot)
        if command == "/planstepbundle":
            return self._execute_plan_step_bundle(update=update, snapshot=snapshot)
        if command == "/planapprove":
            return self._execute_plan_approve(update=update, snapshot=snapshot)
        if command == "/bundleapprove":
            return self._execute_bundle_approve(update=update, snapshot=snapshot)
        if command == "/planstatus":
            return self._execute_plan_status(update=update, snapshot=snapshot)
        if command == "/bundlestatus":
            return self._execute_bundle_status(update=update, snapshot=snapshot)
        if command == "/planresetstep":
            return self._execute_plan_reset_step(update=update, snapshot=snapshot)
        if command == "/bundlecancel":
            return self._execute_bundle_cancel(update=update, snapshot=snapshot)
        if command == "/planview":
            return self._execute_plan_view(update=update, snapshot=snapshot)
        if command == "/planclear":
            return self._execute_plan_clear(update=update, snapshot=snapshot)
        if command == "/bootstrapproject":
            return self._execute_bootstrap_project(update=update, snapshot=snapshot)
        if command == "/bootstrapview":
            return self._execute_bootstrap_view(update=update, snapshot=snapshot)
        if command == "/bootstrapapprove":
            return self._execute_bootstrap_approve(update=update, snapshot=snapshot)
        if command == "/bootstrapreset":
            return self._execute_bootstrap_reset(update=update, snapshot=snapshot)
        if command == "/bundlereset":
            return self._execute_bundle_reset(update=update, snapshot=snapshot)
        if command == "/mode":
            return self._execute_mode(update=update, snapshot=snapshot)
        if command == "/models":
            return self._execute_models(update=update, snapshot=snapshot)
        if command == "/repo":
            return self._execute_repo_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/explainrepo":
            return self._execute_repo_explain(update=update, snapshot=snapshot, argument=parsed_command.argument, batch_busy=batch_busy)
        if command == "/file":
            return self._execute_file_read(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/createfile":
            return self._execute_file_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/patchfile":
            return self._execute_file_patch(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/writefile":
            return self._execute_file_replace(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/run":
            return self._execute_run_command(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/test":
            return self._execute_test_command(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/explainfile":
            return self._execute_file_explain(update=update, snapshot=snapshot, argument=parsed_command.argument, batch_busy=batch_busy)
        if command == "/web":
            return self._execute_web_fetch(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/summarizeweb":
            return self._execute_web_summarize(update=update, snapshot=snapshot, argument=parsed_command.argument, batch_busy=batch_busy)
        if command == "/workflows":
            return self._execute_workflows(update=update, snapshot=snapshot)
        if command == "/workflowstatus":
            return self._execute_workflow_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/cancelworkflow":
            return self._execute_cancel_workflow(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/contexts":
            return self._execute_contexts(update=update, snapshot=snapshot)
        if command == "/clearcontext":
            return self._execute_clear_context(update=update, snapshot=snapshot)
        if command == "/audit":
            return self._execute_audit(update=update, snapshot=snapshot, argument=parsed_command.argument)
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
        if command == "/asklast":
            return self._execute_provider_query_with_latest_context(
                update=update,
                snapshot=snapshot,
                prompt=parsed_command.argument,
                batch_busy=batch_busy,
            )
        if command == "/askctx":
            return self._execute_provider_query_with_selected_context(
                update=update,
                snapshot=snapshot,
                argument=parsed_command.argument,
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
        scope_failure = self._scope_failure_result(request, command_label="parse_failure")
        if scope_failure is not None:
            return scope_failure
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
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="help.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/help",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
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

    def _execute_start_runtime(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="runtime.activate.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/startruntime",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        already_active, activated_snapshot = self._service.activate_runtime_control_plane()
        node_id = self._service.resolve_execution_node().node.node_id
        if already_active:
            reply = "\n".join(
                (
                    "Runtime already active",
                    "",
                    f"Node: {node_id}",
                )
            )
            summary = "runtime.activate.query acknowledged existing local execution activation."
        else:
            reply = "\n".join(
                (
                    "Runtime started",
                    "",
                    f"Node: {node_id}",
                    "Execution enabled",
                    "",
                    "Capabilities unlocked:",
                    "- repo.read",
                    "- file.write",
                    "- run",
                    "- test",
                )
            )
            summary = "runtime.activate.query enabled local execution for the operator console."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=summary,
            retryable=False,
            command_label="/startruntime",
            activity_state="processing_command",
            telemetry={
                "runtime_active": True,
                "runtime_already_active": already_active,
                "runtime_node_id": node_id,
                "readiness_state": activated_snapshot.readiness_state,
            },
        )

    def _execute_nodes(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="nodes.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/nodes",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        current = self._service.resolve_execution_node()
        nodes = self._service.list_registered_nodes()
        reply = self._service._node_formatter.format_list(nodes=nodes, current=current)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="nodes.read returned registered execution nodes.",
            retryable=False,
            command_label="/nodes",
            activity_state="processing_command",
            telemetry={
                "registered_node_count": len(nodes),
                "target_node_id": current.node.node_id,
                "target_node_summary": f"{current.node.display_name} ({current.source})",
            },
        )

    def _execute_node_view(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        node_id = argument.strip().lower()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="node.view.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/nodeview",
            parsed_arguments={"node_id": node_id},
        )
        if scope_failure is not None:
            return scope_failure
        if not node_id:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_node_id",
                user_message="Couldn't view that node.\nReason: No node id was provided.\nNext: Use /nodeview <id>.",
                internal_summary="node.view.read rejected because no node id was provided.",
                retryable=False,
                command_label="/nodeview",
                activity_state="processing_command",
            )
        node = self._service.get_registered_node(node_id)
        if node is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="node_not_found",
                user_message=f"Couldn't view that node.\nReason: No registered node matches {node_id}.\nNext: Use /nodes to inspect available ids.",
                internal_summary=f"node.view.read rejected unknown node id: {node_id}.",
                retryable=False,
                command_label="/nodeview",
                activity_state="processing_command",
            )
        current = self._service.resolve_execution_node()
        reply = self._service._node_formatter.format_detail(node=node, current=current)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"node.view.read returned {node.node_id}.",
            retryable=False,
            command_label="/nodeview",
            activity_state="processing_command",
            telemetry={
                "target_node_id": node.node_id,
                "target_node_name": node.display_name,
                "target_node_type": node.node_type,
                "target_node_summary": f"{node.display_name} ({node.node_id})",
            },
        )

    def _execute_node_select(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        node_id = argument.strip().lower()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="node.select.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/nodeselect",
            parsed_arguments={"node_id": node_id},
        )
        if scope_failure is not None:
            return scope_failure
        if not node_id:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_node_id",
                user_message="Couldn't select that node.\nReason: No node id was provided.\nNext: Use /nodeselect <id>.",
                internal_summary="node.select.query rejected because no node id was provided.",
                retryable=False,
                command_label="/nodeselect",
                activity_state="processing_command",
            )
        resolution = self._service.select_execution_node(node_id)
        if resolution is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="node_not_found",
                user_message=f"Couldn't select that node.\nReason: No registered node matches {node_id}.\nNext: Use /nodes to inspect available ids.",
                internal_summary=f"node.select.query rejected unknown node id: {node_id}.",
                retryable=False,
                command_label="/nodeselect",
                activity_state="processing_command",
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Selected node: {resolution.node.node_id} | {resolution.node.display_name} | {resolution.node.node_type} | {resolution.node.status}",
            internal_summary=f"node.select.query selected {resolution.node.node_id}.",
            retryable=False,
            command_label="/nodeselect",
            activity_state="processing_command",
            telemetry={
                "target_node_id": resolution.node.node_id,
                "target_node_name": resolution.node.display_name,
                "target_node_type": resolution.node.node_type,
                "target_node_summary": f"{resolution.node.display_name} ({resolution.source})",
            },
        )

    def _execute_node_clear(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="node.clear.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/nodeclear",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        resolution = self._service.clear_execution_node()
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Node selection cleared. Active node: {resolution.node.node_id} | {resolution.node.display_name} | {resolution.node.node_type} | {resolution.node.status}",
            internal_summary="node.clear.query restored the default execution node.",
            retryable=False,
            command_label="/nodeclear",
            activity_state="processing_command",
            telemetry={
                "target_node_id": resolution.node.node_id,
                "target_node_name": resolution.node.display_name,
                "target_node_type": resolution.node.node_type,
                "target_node_summary": f"{resolution.node.display_name} ({resolution.source})",
            },
        )

    def _execute_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/status",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
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

    def _execute_last_action(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="action.last.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/lastaction",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        reply = self._service._build_last_action_reply(chat_id=update.chat_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="action.last.read returned the latest operator loop action summary.",
            retryable=False,
            command_label="/lastaction",
            activity_state="processing_command",
        )

    def _execute_translate(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="intent.translate.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/translate",
            parsed_arguments={"request": argument},
            metadata={"argument_summary": "/translate [idea hidden]"},
        )
        if scope_failure is not None:
            return scope_failure
        prompt = " ".join(argument.split())
        if not prompt:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_translation_request",
                user_message="Couldn't translate that request.\nReason: No product idea or request was provided.\nNext: Use /translate <idea or request>.",
                internal_summary="/translate rejected because no request text was provided.",
                retryable=False,
                command_label="/translate",
                activity_state="processing_command",
            )
        archived_session = None
        active_session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if active_session is not None:
            archived_session = self._service._intent_translator.archive_session(active_session, timestamp=self._service._now_iso())
            self._service._intent_store.archive_active(chat_id=update.chat_id, archived_session=archived_session)
        self._invalidate_bundle_for_plan_change(chat_id=update.chat_id, reason="translation_restarted")
        self._service._build_plan_store.clear_active(chat_id=update.chat_id)
        self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
        session = self._service._intent_translator.start_session(
            prompt,
            translation_session_id=self._generate_translation_session_id(),
            timestamp=self._service._now_iso(),
        )
        self._service._intent_store.set_active(chat_id=update.chat_id, session=session)
        summary = self._service._intent_formatter.format_translation_session(session, heading="Translation draft")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=summary,
            internal_summary=(
                f"intent.translate.read created session {session.translation_session_id} for a {session.current_spec.request_type} intent with "
                f"{len(session.open_questions)} open question(s)."
            ),
            retryable=False,
            command_label="/translate",
            activity_state="processing_command",
            telemetry={
                "translation_session": session.to_payload(),
                "intent_spec": session.current_spec.to_payload(),
                "execution_brief": session.current_spec.execution_brief,
                "execution_handoff": session.latest_handoff,
                "clarification_questions": list(session.current_spec.clarification_questions),
                "open_question_count": len(session.open_questions),
                "assumption_count": len(session.assumptions),
                "resolved_field_count": len(session.resolved_fields),
                "archived_previous_session_id": archived_session.translation_session_id if archived_session is not None else "",
            },
        )

    def _execute_chat(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="chat.orchestrate.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chat",
            parsed_arguments={"message": argument},
            metadata={"argument_summary": "/chat [message hidden]"},
        )
        if scope_failure is not None:
            return scope_failure
        prompt = " ".join(argument.split())
        if not prompt:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_chat_message",
                user_message="Couldn't route that chat request.\nReason: No conversational message was provided.\nNext: Use /chat <message>.",
                internal_summary="chat.orchestrate.read rejected because no /chat message was provided.",
                retryable=False,
                command_label="/chat",
                activity_state="processing_command",
            )
        session = self._service._intent_store.get_active(chat_id=update.chat_id)
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        bridge_state = self._service._plan_bridge_store.get_active(chat_id=update.chat_id)
        bundle_state = self._service._autonomy_bundle_store.get_active(chat_id=update.chat_id)
        orchestration_context = self._service._chat_orchestrator.build_context(
            snapshot=snapshot,
            session=session,
            plan=plan,
            bridge_state=bridge_state,
            bundle_state=bundle_state,
        )
        orchestration = self._service._chat_orchestrator.orchestrate(
            prompt,
            orchestration_id=self._generate_chat_orchestration_id(),
            chat_id=update.chat_id,
            context=orchestration_context,
        )
        if orchestration.detected_mode in {"unknown", "approve_step_request", "approve_bundle_request"}:
            lines = [orchestration.user_visible_summary]
            lines.extend(orchestration.follow_up_questions)
            return self._result(
                request,
                outcome="success",
                reason_code=(
                    "needs_clarification"
                    if orchestration.detected_mode == "unknown"
                    else "explicit_approval_required"
                ),
                user_message="\n".join(lines),
                internal_summary=(
                    f"chat.orchestrate.read classified /chat as {orchestration.detected_mode} and held the explicit approval boundary."
                ),
                retryable=False,
                command_label="/chat",
                activity_state="processing_command",
                telemetry={
                    "orchestration_context": orchestration_context.to_payload(),
                    "orchestration_result": orchestration.to_payload(),
                },
            )
        inner_result = self._dispatch_chat_routed_action(
            update=update,
            snapshot=snapshot,
            routed_action=orchestration.routed_action,
            message=prompt,
        )
        return self._result(
            request,
            outcome=inner_result.outcome,
            reason_code=inner_result.outcome_reason_code,
            user_message=inner_result.user_message,
            internal_summary=(
                f"chat.orchestrate.read routed /chat to {orchestration.routed_action} ({orchestration.detected_mode}); "
                f"inner outcome={inner_result.outcome}."
            ),
            retryable=inner_result.retryable,
            command_label="/chat",
            activity_state="processing_command",
            degraded=inner_result.degraded,
            provider_used=inner_result.provider_used,
            mode_used=inner_result.mode_used,
            confirmation_used=inner_result.confirmation_used,
            telemetry={
                "orchestration_context": orchestration_context.to_payload(),
                "orchestration_result": orchestration.to_payload(),
                "routed_capability_id": inner_result.capability_id,
                "routed_command_label": orchestration.routed_action,
                "inner_result": {
                    "capability_id": inner_result.capability_id,
                    "outcome": inner_result.outcome,
                    "reason_code": inner_result.outcome_reason_code,
                    "summary": inner_result.internal_summary,
                },
                "routed_telemetry": dict(inner_result.telemetry),
            },
        )

    def _execute_refine(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="intent.refine.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/refine",
            parsed_arguments={"clarification": argument},
            metadata={"argument_summary": "/refine [clarification hidden]"},
        )
        if scope_failure is not None:
            return scope_failure
        clarification = " ".join(argument.split())
        if not clarification:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_refinement_request",
                user_message="Couldn't refine that draft.\nReason: No clarification was provided.\nNext: Use /refine <clarification>.",
                internal_summary="/refine rejected because no clarification text was provided.",
                retryable=False,
                command_label="/refine",
                activity_state="processing_command",
            )
        active_session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if active_session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_translation_session",
                user_message="Couldn't refine that draft.\nReason: No active translation draft exists.\nNext: Use /translate <idea or request> first.",
                internal_summary="/refine rejected because there is no active translation draft.",
                retryable=False,
                command_label="/refine",
                activity_state="processing_command",
            )
        session = self._service._intent_translator.refine_session(
            active_session,
            clarification,
            timestamp=self._service._now_iso(),
        )
        self._service._intent_store.set_active(chat_id=update.chat_id, session=session)
        self._invalidate_bundle_for_plan_change(chat_id=update.chat_id, reason="translation_refined")
        self._service._build_plan_store.clear_active(chat_id=update.chat_id)
        self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
        summary = self._service._intent_formatter.format_translation_session(session, heading="Translation refined")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=summary,
            internal_summary=(
                f"intent.refine.read updated session {session.translation_session_id}; "
                f"{len(session.open_questions)} open question(s) remain."
            ),
            retryable=False,
            command_label="/refine",
            activity_state="processing_command",
            telemetry={
                "translation_session": session.to_payload(),
                "intent_spec": session.current_spec.to_payload(),
                "execution_brief": session.current_spec.execution_brief,
                "execution_handoff": session.latest_handoff,
                "clarification_questions": list(session.current_spec.clarification_questions),
                "open_question_count": len(session.open_questions),
                "assumption_count": len(session.assumptions),
                "resolved_field_count": len(session.resolved_fields),
            },
        )

    def _execute_translate_view(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="intent.view.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/translateview",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if session is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_translation_session",
                user_message=self._service._intent_formatter.format_no_active_session(),
                internal_summary="intent.view.read found no active translation draft.",
                retryable=False,
                command_label="/translateview",
                activity_state="processing_command",
                telemetry={"translation_session": None},
            )
        reply = self._service._intent_formatter.format_translation_session(session, heading="Translation view")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"intent.view.read returned session {session.translation_session_id} in state {session.state}.",
            retryable=False,
            command_label="/translateview",
            activity_state="processing_command",
            telemetry={
                "translation_session": session.to_payload(),
                "intent_spec": session.current_spec.to_payload(),
                "execution_handoff": session.latest_handoff,
            },
        )

    def _execute_translate_clear(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="intent.clear.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/translateclear",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        active_session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if active_session is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_translation_session",
                user_message=self._service._intent_formatter.format_clear_reply(None),
                internal_summary="intent.clear.read found no active translation draft to archive.",
                retryable=False,
                command_label="/translateclear",
                activity_state="processing_command",
                telemetry={"translation_session": None},
            )
        self._invalidate_bundle_for_plan_change(chat_id=update.chat_id, reason="translation_cleared")
        self._service._build_plan_store.clear_active(chat_id=update.chat_id)
        self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
        archived_session = self._service._intent_translator.archive_session(active_session, timestamp=self._service._now_iso())
        self._service._intent_store.archive_active(chat_id=update.chat_id, archived_session=archived_session)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._intent_formatter.format_clear_reply(archived_session),
            internal_summary=f"intent.clear.read archived session {archived_session.translation_session_id}.",
            retryable=False,
            command_label="/translateclear",
            activity_state="processing_command",
            telemetry={"translation_session": archived_session.to_payload()},
        )

    @staticmethod
    def _generate_translation_session_id() -> str:
        return f"TR-{secrets.token_hex(3).upper()}"

    @staticmethod
    def _generate_chat_orchestration_id() -> str:
        return f"CH-{secrets.token_hex(3).upper()}"

    def _execute_plan_build(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.plan.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planbuild",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_translation_session",
                user_message="Couldn't plan that build.\nReason: No active translation draft exists.\nNext: Use /translate <idea or request> first.",
                internal_summary="/planbuild rejected because there is no active translation draft.",
                retryable=False,
                command_label="/planbuild",
                activity_state="processing_command",
            )
        plan = self._service._build_planner.build_plan(session, plan_id=self._generate_build_plan_id())
        self._invalidate_bundle_for_plan_change(chat_id=update.chat_id, reason="plan_rebuilt")
        self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
        self._service._build_plan_store.set_active(chat_id=update.chat_id, plan=plan)
        reply = self._service._build_plan_formatter.format_build_plan(plan, heading="Build plan")
        return self._result(
            request,
            outcome="success",
            reason_code="ok" if plan.state == "ready" else "planning_blocked",
            user_message=reply,
            internal_summary=(
                f"build.plan.read created plan {plan.plan_id} from session {session.translation_session_id} with "
                f"{len(plan.blockers)} blocker(s)."
            ),
            retryable=False,
            command_label="/planbuild",
            activity_state="processing_command",
            telemetry={
                "translation_session": session.to_payload(),
                "intent_spec": session.current_spec.to_payload(),
                "build_plan": plan.to_payload(),
                "plan_state": plan.state,
                "plan_phase_count": len(plan.phases),
                "plan_blocker_count": len(plan.blockers),
                "operator_handoff": plan.operator_handoff,
            },
        )

    def _execute_plan_view(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.plan.view.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planview",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_build_plan",
                user_message=self._service._build_plan_formatter.format_no_active_plan(),
                internal_summary="build.plan.view.read found no active build plan.",
                retryable=False,
                command_label="/planview",
                activity_state="processing_command",
                telemetry={"build_plan": None},
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_plan_formatter.format_build_plan(plan, heading="Build plan view"),
            internal_summary=f"build.plan.view.read returned plan {plan.plan_id} in state {plan.state}.",
            retryable=False,
            command_label="/planview",
            activity_state="processing_command",
            telemetry={"build_plan": plan.to_payload()},
        )

    def _execute_bootstrap_project(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bootstrap.propose.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bootstrapproject",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service._intent_store.get_active(chat_id=update.chat_id)
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_translation_session",
                user_message="Couldn't bootstrap that project.\nReason: No active translation draft exists.\nNext: Use /translate <idea or request> first.",
                internal_summary="build.bootstrap.propose.read rejected because there is no active translation draft.",
                retryable=False,
                command_label="/bootstrapproject",
                activity_state="processing_command",
            )
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_build_plan",
                user_message="Couldn't bootstrap that project.\nReason: No active build plan exists.\nNext: Use /planbuild after /translate or /refine.",
                internal_summary="build.bootstrap.propose.read rejected because there is no active build plan.",
                retryable=False,
                command_label="/bootstrapproject",
                activity_state="processing_command",
            )
        repo_root, repo_root_valid, _, _ = self._service._repo_configuration_state()
        try:
            proposal = self._service._project_bootstrap_planner.build_proposal(
                session,
                plan,
                bootstrap_id=self._generate_bootstrap_id(),
                created_at=self._service._now_iso(),
                repo_root=repo_root if repo_root_valid else "",
            )
        except Exception as exc:
            code = getattr(exc, "code", "bootstrap_planning_failed")
            message = getattr(exc, "message", "Bootstrap planning failed unexpectedly.")
            return self._result(
                request,
                outcome="invalid_request",
                reason_code=code,
                user_message=f"Couldn't bootstrap that project.\nReason: {message}\nNext: Refine the request or choose a supported phase-1 project type.",
                internal_summary=f"build.bootstrap.propose.read failed: {code}.",
                retryable=False,
                command_label="/bootstrapproject",
                activity_state="processing_command",
            )
        self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=proposal)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._project_bootstrap_formatter.format_proposal(proposal, heading="Bootstrap proposal ready"),
            internal_summary=(
                f"build.bootstrap.propose.read created bootstrap {proposal.bootstrap_id} for plan {proposal.plan_id} "
                f"with {len(proposal.files)} file(s)."
            ),
            retryable=False,
            command_label="/bootstrapproject",
            activity_state="processing_command",
            telemetry={
                "translation_session": session.to_payload(),
                "build_plan": plan.to_payload(),
                "bootstrap_id": proposal.bootstrap_id,
                "bootstrap_type": proposal.project_type,
                "bootstrap_file_count": len(proposal.files),
                "bootstrap_follow_up": " | ".join(proposal.follow_up_commands[:2]),
                "bootstrap_summary": proposal.summary,
                "bootstrap_proposal": proposal.to_payload(),
            },
        )

    def _execute_bootstrap_view(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bootstrap.view.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bootstrapview",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        proposal = self._service._project_bootstrap_store.get_active(chat_id=update.chat_id)
        if proposal is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_bootstrap_proposal",
                user_message=self._service._project_bootstrap_formatter.format_no_active_proposal(),
                internal_summary="build.bootstrap.view.read found no active bootstrap proposal.",
                retryable=False,
                command_label="/bootstrapview",
                activity_state="processing_command",
                telemetry={"bootstrap_proposal": None},
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._project_bootstrap_formatter.format_proposal(proposal, heading="Bootstrap proposal ready"),
            internal_summary=f"build.bootstrap.view.read returned bootstrap {proposal.bootstrap_id} in state {proposal.state}.",
            retryable=False,
            command_label="/bootstrapview",
            activity_state="processing_command",
            telemetry={
                "bootstrap_id": proposal.bootstrap_id,
                "bootstrap_type": proposal.project_type,
                "bootstrap_file_count": len(proposal.files),
                "bootstrap_summary": proposal.summary,
                "bootstrap_proposal": proposal.to_payload(),
            },
        )

    def _execute_plan_step(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.step.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planstep",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_build_plan",
                user_message=self._service._plan_bridge_formatter.format_no_active_plan(),
                internal_summary="build.step.read rejected because there is no active build plan.",
                retryable=False,
                command_label="/planstep",
                activity_state="processing_command",
                telemetry={"build_plan": None, "plan_bridge_state": None},
            )
        if plan.state == "blocked":
            state = self._service._plan_bridge.ensure_state(
                plan,
                self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
            )
            self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="planning_blocked",
                user_message=self._service._plan_bridge_formatter.format_blocked_plan(plan),
                internal_summary=f"build.step.read rejected because plan {plan.plan_id} is blocked.",
                retryable=True,
                command_label="/planstep",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": state.to_payload()},
            )
        state = self._service._plan_bridge.propose_next_step(
            plan,
            self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
            proposal_id=self._generate_plan_step_proposal_id(),
        )
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
        proposal = state.execution_proposal
        if proposal is None:
            return self._result(
                request,
                outcome="success",
                reason_code="plan_completed",
                user_message=self._service._plan_bridge_formatter.format_completed_plan(plan),
                internal_summary=f"build.step.read found no remaining task groups for plan {plan.plan_id}.",
                retryable=False,
                command_label="/planstep",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": state.to_payload(), "execution_proposal": None},
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._plan_bridge_formatter.format_proposal(plan, state, proposal),
            internal_summary=f"build.step.read proposed {proposal.proposal_id} for task group {proposal.task_group_id} in plan {plan.plan_id}.",
            retryable=False,
            command_label="/planstep",
            activity_state="processing_command",
            telemetry={
                "build_plan": plan.to_payload(),
                "plan_bridge_state": state.to_payload(),
                "execution_proposal": proposal.to_payload(),
            },
        )

    def _execute_plan_step_bundle(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bundle.propose.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planstepbundle",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_build_plan",
                user_message=self._service._autonomy_bundle_formatter.format_no_active_plan(),
                internal_summary="build.bundle.propose.read rejected because there is no active build plan.",
                retryable=False,
                command_label="/planstepbundle",
                activity_state="processing_command",
                telemetry={"build_plan": None, "plan_bridge_state": None, "bundle_state": None, "bundle_proposal": None},
            )
        bridge_state = self._service._plan_bridge.ensure_state(
            plan,
            self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
        )
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=bridge_state)
        if plan.state == "blocked":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="planning_blocked",
                user_message=self._service._autonomy_bundle_formatter.format_blocked_plan(),
                internal_summary=f"build.bundle.propose.read rejected because plan {plan.plan_id} is blocked.",
                retryable=True,
                command_label="/planstepbundle",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": bridge_state.to_payload(), "bundle_state": None, "bundle_proposal": None},
            )
        bundle_state = self._service._autonomy_bundle_store.get_active(chat_id=update.chat_id)
        if bridge_state.execution_proposal is not None and bridge_state.current_step_state in {"proposed", "approved", "executing"}:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="active_plan_step_conflict",
                user_message=self._service._autonomy_bundle_formatter.format_active_conflict(),
                internal_summary=f"build.bundle.propose.read rejected because plan {plan.plan_id} already has an active step proposal.",
                retryable=False,
                command_label="/planstepbundle",
                activity_state="processing_command",
                telemetry={
                    "build_plan": plan.to_payload(),
                    "plan_bridge_state": bridge_state.to_payload(),
                    "bundle_state": bundle_state.to_payload() if bundle_state is not None else None,
                    "bundle_proposal": bundle_state.proposal.to_payload() if bundle_state is not None else None,
                },
            )
        if bundle_state is not None and not self._service._autonomy_bundle.is_terminal(bundle_state):
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="active_bundle_conflict",
                user_message=self._service._autonomy_bundle_formatter.format_active_conflict(),
                internal_summary=f"build.bundle.propose.read rejected because bundle {bundle_state.bundle_id} is still active.",
                retryable=False,
                command_label="/planstepbundle",
                activity_state="processing_command",
                telemetry={
                    "build_plan": plan.to_payload(),
                    "plan_bridge_state": bridge_state.to_payload(),
                    "bundle_state": bundle_state.to_payload(),
                    "bundle_proposal": bundle_state.proposal.to_payload(),
                },
            )
        proposal = self._service._autonomy_bundle.build_proposal(
            plan,
            bridge_state,
            bundle_id=self._generate_bundle_id(),
        )
        if proposal is None:
            return self._result(
                request,
                outcome="success",
                reason_code="plan_completed",
                user_message=self._service._plan_bridge_formatter.format_completed_plan(plan),
                internal_summary=f"build.bundle.propose.read found no remaining dependency-valid task groups for plan {plan.plan_id}.",
                retryable=False,
                command_label="/planstepbundle",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": bridge_state.to_payload(), "bundle_state": None, "bundle_proposal": None},
            )
        proposed_state = self._service._autonomy_bundle.proposed_run_state(proposal, timestamp=self._service._now_iso())
        self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=proposed_state)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._autonomy_bundle_formatter.format_proposal(proposal),
            internal_summary=f"build.bundle.propose.read proposed bundle {proposal.bundle_id} with {len(proposal.selected_steps)} step(s) for plan {plan.plan_id}.",
            retryable=False,
            command_label="/planstepbundle",
            activity_state="processing_command",
            telemetry={
                "build_plan": plan.to_payload(),
                "plan_bridge_state": bridge_state.to_payload(),
                "bundle_state": proposed_state.to_payload(),
                "bundle_proposal": proposal.to_payload(),
            },
        )

    def _execute_plan_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planstatus",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_build_plan",
                user_message=self._service._build_plan_formatter.format_no_active_plan(),
                internal_summary="build.status.read found no active build plan.",
                retryable=False,
                command_label="/planstatus",
                activity_state="processing_command",
                telemetry={"build_plan": None, "plan_bridge_state": None},
            )
        state = self._service._plan_bridge.ensure_state(
            plan,
            self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
        )
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._plan_bridge_formatter.format_status(plan, state),
            internal_summary=f"build.status.read returned bridge status for plan {plan.plan_id}.",
            retryable=False,
            command_label="/planstatus",
            activity_state="processing_command",
            telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": state.to_payload()},
        )

    def _execute_bundle_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bundle.status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bundlestatus",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        state = self._service._autonomy_bundle_store.get_active(chat_id=update.chat_id)
        if state is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_bundle",
                user_message=self._service._autonomy_bundle_formatter.format_no_active_bundle(),
                internal_summary="build.bundle.status.read found no active bundle.",
                retryable=False,
                command_label="/bundlestatus",
                activity_state="processing_command",
                telemetry={"bundle_state": None},
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._autonomy_bundle_formatter.format_status(state),
            internal_summary=f"build.bundle.status.read returned bundle {state.bundle_id} in state {state.state}.",
            retryable=False,
            command_label="/bundlestatus",
            activity_state="processing_command",
            telemetry={"bundle_state": state.to_payload(), "bundle_proposal": state.proposal.to_payload()},
        )

    def _execute_plan_reset_step(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.step.reset.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planresetstep",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        state = self._service._plan_bridge_store.get_active(chat_id=update.chat_id)
        had_state = state is not None
        had_proposal = state is not None and state.execution_proposal is not None
        if plan is None or state is None:
            if state is not None:
                self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_plan_step",
                user_message=self._service._plan_bridge_formatter.format_reset_reply(had_state, had_proposal),
                internal_summary="build.step.reset.read found no active plan proposal to reset.",
                retryable=False,
                command_label="/planresetstep",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload() if plan is not None else None, "plan_bridge_state": None},
            )
        state = self._service._plan_bridge.reset_current_step(plan, state)
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._plan_bridge_formatter.format_reset_reply(had_state, had_proposal),
            internal_summary=f"build.step.reset.read reset the active proposal for plan {plan.plan_id}.",
            retryable=False,
            command_label="/planresetstep",
            activity_state="processing_command",
            telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": state.to_payload()},
        )

    def _execute_plan_approve(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.step.approve.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planapprove",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_build_plan",
                user_message="Couldn't approve that plan step.\nReason: No active build plan exists.\nNext: Use /planbuild after /translate or /refine.",
                internal_summary="build.step.approve.query rejected because there is no active build plan.",
                retryable=False,
                command_label="/planapprove",
                activity_state="processing_command",
                telemetry={"build_plan": None, "plan_bridge_state": None, "execution_proposal": None},
            )
        state = self._service._plan_bridge.ensure_state(
            plan,
            self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
        )
        proposal = state.execution_proposal
        if proposal is None or state.current_step_state not in {"proposed", "approved", "executing"}:
            self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_plan_step",
                user_message=self._service._plan_bridge_formatter.format_no_active_proposal(),
                internal_summary=f"build.step.approve.query rejected because plan {plan.plan_id} has no active proposal.",
                retryable=False,
                command_label="/planapprove",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload(), "plan_bridge_state": state.to_payload(), "execution_proposal": None},
            )
        state = self._service._plan_bridge.mark_approved(state)
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=state)
        executed_state = self._service._plan_bridge.mark_executing(state)
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=executed_state)
        inner_result = self._dispatch_plan_proposal(
            update=update,
            snapshot=snapshot,
            request=request,
            proposal=proposal,
        )
        updated_state = self._service._plan_bridge.apply_execution_result(plan, executed_state, inner_result)
        self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=updated_state)
        return self._result(
            request,
            outcome=inner_result.outcome,
            reason_code=inner_result.outcome_reason_code,
            user_message=self._service._plan_bridge_formatter.format_approval_result(
                proposal,
                inner_result.capability_id,
                inner_result.outcome,
                inner_result.internal_summary,
            ),
            internal_summary=(
                f"build.step.approve.query executed {proposal.command_label} for task group {proposal.task_group_id}; "
                f"inner outcome={inner_result.outcome}."
            ),
            retryable=inner_result.retryable,
            command_label="/planapprove",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "build_plan": plan.to_payload(),
                "plan_bridge_state": updated_state.to_payload(),
                "execution_proposal": proposal.to_payload(),
                "executed_capability_id": inner_result.capability_id,
                "executed_command_label": proposal.command_label,
                "executed_command_argument": proposal.command_argument,
                "executed_outcome": inner_result.outcome,
                "executed_reason_code": inner_result.outcome_reason_code,
                "inner_result": {
                    "capability_id": inner_result.capability_id,
                    "outcome": inner_result.outcome,
                    "reason_code": inner_result.outcome_reason_code,
                    "summary": inner_result.internal_summary,
                },
            },
        )

    def _execute_bundle_approve(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bundle.approve.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bundleapprove",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        state = self._service._autonomy_bundle_store.get_active(chat_id=update.chat_id)
        if state is None or state.state != "proposed":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_proposed_bundle",
                user_message=self._service._autonomy_bundle_formatter.format_no_proposed_bundle(),
                internal_summary="build.bundle.approve.query rejected because there is no proposed bundle.",
                retryable=False,
                command_label="/bundleapprove",
                activity_state="processing_command",
                telemetry={"bundle_state": state.to_payload() if state is not None else None},
            )
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if plan is None or plan.plan_id != state.plan_id:
            invalidated = self._service._autonomy_bundle.mark_invalidated(
                state,
                reason="plan_changed",
                timestamp=self._service._now_iso(),
            )
            self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=invalidated)
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="bundle_invalidated",
                user_message=self._service._autonomy_bundle_formatter.format_result(invalidated),
                internal_summary="build.bundle.approve.query rejected because the approved plan changed before bundle execution started.",
                retryable=False,
                command_label="/bundleapprove",
                activity_state="processing_command",
                telemetry={"build_plan": plan.to_payload() if plan is not None else None, "bundle_state": invalidated.to_payload()},
            )
        bundle_state = self._service._autonomy_bundle.mark_approved(state, timestamp=self._service._now_iso())
        bundle_state = self._service._autonomy_bundle.mark_running(bundle_state, timestamp=self._service._now_iso())
        self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=bundle_state)
        bridge_state = self._service._plan_bridge.ensure_state(
            plan,
            self._service._plan_bridge_store.get_active(chat_id=update.chat_id),
        )
        for step in bundle_state.proposal.selected_steps:
            current_plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
            if current_plan is None or current_plan.plan_id != plan.plan_id:
                bundle_state = self._service._autonomy_bundle.mark_invalidated(
                    bundle_state,
                    reason="plan_changed",
                    timestamp=self._service._now_iso(),
                )
                self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=bundle_state)
                return self._result(
                    request,
                    outcome="failed",
                    reason_code="bundle_invalidated",
                    user_message=self._service._autonomy_bundle_formatter.format_result(bundle_state),
                    internal_summary=f"build.bundle.approve.query invalidated bundle {bundle_state.bundle_id} because the active plan changed during execution.",
                    retryable=False,
                    command_label="/bundleapprove",
                    activity_state="processing_command",
                    confirmation_used=True,
                    telemetry={"build_plan": None, "bundle_state": bundle_state.to_payload()},
                )
            bundle_state = self._service._autonomy_bundle.mark_step_running(bundle_state, step, timestamp=self._service._now_iso())
            self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=bundle_state)
            bridge_state, step_proposal = self._prepare_bridge_state_for_bundle_step(plan=plan, state=bridge_state, step=step)
            self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=bridge_state)
            inner_result = self._dispatch_bundle_step(
                update=update,
                snapshot=snapshot,
                request=request,
                step=step,
            )
            bridge_state = self._service._plan_bridge.apply_execution_result(plan, bridge_state, inner_result)
            self._service._plan_bridge_store.set_active(chat_id=update.chat_id, state=bridge_state)
            bundle_state = self._service._autonomy_bundle.record_step_result(
                bundle_state,
                step,
                capability_id=inner_result.capability_id,
                outcome=inner_result.outcome,
                reason_code=inner_result.outcome_reason_code,
                summary=inner_result.internal_summary,
                timestamp=self._service._now_iso(),
            )
            self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=bundle_state)
            if inner_result.outcome != "success":
                return self._result(
                    request,
                    outcome=inner_result.outcome,
                    reason_code=inner_result.outcome_reason_code,
                    user_message=self._service._autonomy_bundle_formatter.format_result(bundle_state),
                    internal_summary=(
                        f"build.bundle.approve.query stopped bundle {bundle_state.bundle_id} on step {step.step_index}; "
                        f"inner outcome={inner_result.outcome}."
                    ),
                    retryable=inner_result.retryable,
                    command_label="/bundleapprove",
                    activity_state="processing_command",
                    confirmation_used=True,
                    telemetry={
                        "build_plan": plan.to_payload(),
                        "plan_bridge_state": bridge_state.to_payload(),
                        "bundle_state": bundle_state.to_payload(),
                        "bundle_proposal": bundle_state.proposal.to_payload(),
                        "execution_proposal": step_proposal.to_payload(),
                        "executed_capability_id": inner_result.capability_id,
                        "executed_command_label": step.command_label,
                        "executed_command_argument": step.command_argument,
                        "executed_outcome": inner_result.outcome,
                        "executed_reason_code": inner_result.outcome_reason_code,
                    },
                )
        bundle_state = self._service._autonomy_bundle.mark_completed(
            bundle_state,
            stop_reason="approved_step_budget_reached",
            timestamp=self._service._now_iso(),
        )
        self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=bundle_state)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._autonomy_bundle_formatter.format_result(bundle_state),
            internal_summary=(
                f"build.bundle.approve.query executed bundle {bundle_state.bundle_id} with "
                f"{len(bundle_state.completed_steps)} completed step(s)."
            ),
            retryable=False,
            command_label="/bundleapprove",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "build_plan": plan.to_payload(),
                "plan_bridge_state": bridge_state.to_payload(),
                "bundle_state": bundle_state.to_payload(),
                "bundle_proposal": bundle_state.proposal.to_payload(),
                "executed_capability_ids": [step_result.capability_id for step_result in bundle_state.completed_steps],
            },
        )

    def _execute_plan_clear(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.plan.clear.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/planclear",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        self._invalidate_bundle_for_plan_change(chat_id=update.chat_id, reason="plan_cleared")
        cleared_plan = self._service._build_plan_store.clear_active(chat_id=update.chat_id)
        self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        self._service._plan_bridge_store.clear_active(chat_id=update.chat_id)
        return self._result(
            request,
            outcome="success",
            reason_code="ok" if cleared_plan is not None else "no_active_build_plan",
            user_message=self._service._build_plan_formatter.format_clear_reply(cleared_plan),
            internal_summary=(
                f"build.plan.clear.read cleared plan {cleared_plan.plan_id}."
                if cleared_plan is not None
                else "build.plan.clear.read found no active build plan to clear."
            ),
            retryable=False,
            command_label="/planclear",
            activity_state="processing_command",
            telemetry={"build_plan": cleared_plan.to_payload() if cleared_plan is not None else None},
        )

    def _execute_bootstrap_approve(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, evaluation, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bootstrap.approve.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bootstrapapprove",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        if evaluation.current_availability_state != "allowed":
            next_step_map = {
                "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
                "runtime_not_active": "Use /startruntime, then retry /bootstrapapprove.",
                "runtime_not_running": "Start the runtime in the operator console and try again.",
            }
            reason = evaluation.blocking_reason or evaluation.message
            next_step = next_step_map.get(evaluation.reason_code, "Check the operator console configuration and try again.")
            outcome = "blocked"
            if evaluation.current_availability_state == "unavailable":
                outcome = "unavailable"
            elif evaluation.current_availability_state == "degraded":
                outcome = "degraded"
            return self._result(
                request,
                outcome=outcome,
                reason_code=evaluation.reason_code,
                user_message=f"Bootstrap blocked\nReason:\n- {reason}\nNext: {next_step}",
                internal_summary=f"build.bootstrap.approve.query blocked by capability evaluation ({evaluation.reason_code}).",
                retryable=True,
                command_label="/bootstrapapprove",
                activity_state="processing_command",
            )
        proposal = self._service._project_bootstrap_store.get_active(chat_id=update.chat_id)
        if proposal is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_bootstrap_proposal",
                user_message="Bootstrap blocked\nReason:\n- No active bootstrap proposal\nNext: Use /bootstrapproject first.",
                internal_summary="build.bootstrap.approve.query rejected because there is no active bootstrap proposal.",
                retryable=False,
                command_label="/bootstrapapprove",
                activity_state="processing_command",
            )
        session = self._service._intent_store.get_active(chat_id=update.chat_id)
        plan = self._service._build_plan_store.get_active(chat_id=update.chat_id)
        if session is None or plan is None or session.translation_session_id != proposal.translation_session_id or plan.plan_id != proposal.plan_id:
            self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="bootstrap_invalidated",
                user_message="Bootstrap blocked\nReason:\n- The active translation or build plan changed\nNext: Use /bootstrapproject again.",
                internal_summary="build.bootstrap.approve.query rejected because the source translation or build plan changed.",
                retryable=False,
                command_label="/bootstrapapprove",
                activity_state="processing_command",
            )
        repo_root, repo_root_valid, repo_message, _ = self._service._repo_configuration_state()
        if not repo_root_valid:
            return self._result(
                request,
                outcome="unavailable",
                reason_code="repo_root_invalid",
                user_message=f"Bootstrap blocked\nReason:\n- {repo_message}\nNext: Configure the repository root, then rerun /bootstrapapprove.",
                internal_summary="build.bootstrap.approve.query blocked because the repository root is not configured.",
                retryable=True,
                command_label="/bootstrapapprove",
                activity_state="processing_command",
                confirmation_used=True,
                telemetry={
                    "bootstrap_id": proposal.bootstrap_id,
                    "bootstrap_type": proposal.project_type,
                    "bootstrap_file_count": len(proposal.files),
                    "bootstrap_created_count": 0,
                    "bootstrap_follow_up": " | ".join(proposal.follow_up_commands[:2]),
                    "bootstrap_summary": proposal.summary,
                    "bootstrap_proposal": proposal.to_payload(),
                },
            )
        executing = proposal.with_state("executing", updated_at=self._service._now_iso(), completed_files=(), stop_reason="")
        self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=executing)
        repo_root_path = Path(repo_root).resolve()
        preflighted: list[tuple[object, object]] = []
        for file_spec in executing.files:
            confirmation = self._synthetic_bootstrap_confirmation(update=update, snapshot=snapshot, proposal=executing, file_spec=file_spec)
            parsed = parse_create_command(confirmation.prompt_text)
            mutation_request, inner_scope_failure, relative_path, _ = self._prepare_confirmed_file_create_request(
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
                relative_path=parsed.relative_path,
            )
            if isinstance(mutation_request, CapabilityExecutionResult):
                failed = executing.with_state("failed", updated_at=self._service._now_iso(), completed_files=(), stop_reason=mutation_request.outcome_reason_code)
                self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=failed)
                return self._bootstrap_failure_result(request=request, proposal=failed, relative_path=relative_path, inner_result=mutation_request)
            if inner_scope_failure is not None:
                failed = executing.with_state("failed", updated_at=self._service._now_iso(), completed_files=(), stop_reason=inner_scope_failure.outcome_reason_code)
                self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=failed)
                return self._bootstrap_failure_result(request=request, proposal=failed, relative_path=relative_path, inner_result=inner_scope_failure)
            target_path = Path(mutation_request.scope.target_path).resolve()
            try:
                target_path.relative_to(repo_root_path)
            except ValueError:
                failed = executing.with_state("failed", updated_at=self._service._now_iso(), completed_files=(), stop_reason="bootstrap_outside_repo_root")
                self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=failed)
                return self._result(
                    request,
                    outcome="out_of_scope",
                    reason_code="bootstrap_outside_repo_root",
                    user_message=(
                        "Bootstrap blocked\n"
                        "Reason:\n"
                        f"- {relative_path} resolves outside the configured repository root\n"
                        "Next: Narrow the file scope or repo root, then rerun /bootstrapapprove."
                    ),
                    internal_summary=f"build.bootstrap.approve.query blocked because {relative_path} resolved outside the configured repository root.",
                    retryable=False,
                    command_label="/bootstrapapprove",
                    activity_state="processing_command",
                    confirmation_used=True,
                    telemetry={
                        "bootstrap_id": executing.bootstrap_id,
                        "bootstrap_type": executing.project_type,
                        "bootstrap_file_count": len(executing.files),
                        "bootstrap_created_count": 0,
                        "bootstrap_follow_up": " | ".join(executing.follow_up_commands[:2]),
                        "bootstrap_summary": executing.summary,
                        "bootstrap_proposal": failed.to_payload(),
                    },
                )
            preflighted.append((file_spec, confirmation))
        completed_records: list[ProjectBootstrapExecutionRecord] = []
        current = executing
        for file_spec, confirmation in preflighted:
            inner_result = self._execute_confirmed_file_create(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
            if inner_result.outcome != "success":
                failed = current.with_state(
                    "failed",
                    updated_at=self._service._now_iso(),
                    completed_files=tuple(completed_records),
                    stop_reason=inner_result.outcome_reason_code,
                )
                self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=failed)
                return self._bootstrap_failure_result(request=request, proposal=failed, relative_path=file_spec.relative_path, inner_result=inner_result)
            completed_records.append(
                ProjectBootstrapExecutionRecord(
                    relative_path=file_spec.relative_path,
                    capability_id=inner_result.capability_id,
                    outcome=inner_result.outcome,
                    reason_code=inner_result.outcome_reason_code,
                    summary=inner_result.internal_summary,
                )
            )
            current = current.with_state(
                "executing",
                updated_at=self._service._now_iso(),
                completed_files=tuple(completed_records),
                stop_reason="",
            )
            self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=current)
        completed = current.with_state(
            "completed",
            updated_at=self._service._now_iso(),
            completed_files=tuple(completed_records),
            stop_reason="approved_bootstrap_completed",
        )
        self._service._project_bootstrap_store.set_active(chat_id=update.chat_id, proposal=completed)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._project_bootstrap_formatter.format_result(completed),
            internal_summary=(
                f"build.bootstrap.approve.query created {len(completed.completed_files)} file(s) for bootstrap {completed.bootstrap_id}."
            ),
            retryable=False,
            command_label="/bootstrapapprove",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "translation_session": session.to_payload(),
                "build_plan": plan.to_payload(),
                "bootstrap_id": completed.bootstrap_id,
                "bootstrap_type": completed.project_type,
                "bootstrap_file_count": len(completed.files),
                "bootstrap_created_count": len(completed.completed_files),
                "bootstrap_follow_up": " | ".join(completed.follow_up_commands[:2]),
                "bootstrap_summary": completed.summary,
                "bootstrap_proposal": completed.to_payload(),
                "executed_capability_ids": [record.capability_id for record in completed.completed_files],
            },
        )

    def _execute_bootstrap_reset(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bootstrap.reset.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bootstrapreset",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        cleared = self._service._project_bootstrap_store.clear_active(chat_id=update.chat_id)
        return self._result(
            request,
            outcome="success",
            reason_code="ok" if cleared is not None else "no_active_bootstrap_proposal",
            user_message=self._service._project_bootstrap_formatter.format_reset_reply(cleared),
            internal_summary=(
                f"build.bootstrap.reset.query cleared bootstrap {cleared.bootstrap_id}."
                if cleared is not None
                else "build.bootstrap.reset.query found no active bootstrap proposal to clear."
            ),
            retryable=False,
            command_label="/bootstrapreset",
            activity_state="processing_command",
            telemetry={
                "bootstrap_id": cleared.bootstrap_id if cleared is not None else "",
                "bootstrap_summary": cleared.summary if cleared is not None else "project bootstrap reset",
                "bootstrap_proposal": cleared.to_payload() if cleared is not None else None,
            },
        )

    def _execute_bundle_cancel(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bundle.cancel.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bundlecancel",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        state = self._service._autonomy_bundle_store.get_active(chat_id=update.chat_id)
        if state is None or self._service._autonomy_bundle.is_terminal(state):
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_bundle",
                user_message=self._service._autonomy_bundle_formatter.format_cancel_reply(None),
                internal_summary="build.bundle.cancel.query found no active bundle to cancel.",
                retryable=False,
                command_label="/bundlecancel",
                activity_state="processing_command",
                telemetry={"bundle_state": state.to_payload() if state is not None else None},
            )
        cancelled = self._service._autonomy_bundle.mark_cancelled(state, reason="operator_cancelled", timestamp=self._service._now_iso())
        self._service._autonomy_bundle_store.set_active(chat_id=update.chat_id, state=cancelled)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._autonomy_bundle_formatter.format_cancel_reply(cancelled),
            internal_summary=f"build.bundle.cancel.query cancelled bundle {cancelled.bundle_id}.",
            retryable=False,
            command_label="/bundlecancel",
            activity_state="processing_command",
            telemetry={"bundle_state": cancelled.to_payload(), "bundle_proposal": cancelled.proposal.to_payload()},
        )

    def _execute_bundle_reset(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.bundle.reset.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/bundlereset",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        state = self._service._autonomy_bundle_store.clear_active(chat_id=update.chat_id)
        return self._result(
            request,
            outcome="success",
            reason_code="ok" if state is not None else "no_active_bundle",
            user_message=self._service._autonomy_bundle_formatter.format_reset_reply(state),
            internal_summary=(
                f"build.bundle.reset.query cleared bundle {state.bundle_id}."
                if state is not None
                else "build.bundle.reset.query found no active bundle to clear."
            ),
            retryable=False,
            command_label="/bundlereset",
            activity_state="processing_command",
            telemetry={"bundle_state": state.to_payload() if state is not None else None},
        )

    @staticmethod
    def _generate_bootstrap_id() -> str:
        return f"BT-{secrets.token_hex(3).upper()}"

    @staticmethod
    def _generate_build_plan_id() -> str:
        return f"BP-{secrets.token_hex(3).upper()}"

    @staticmethod
    def _generate_plan_step_proposal_id() -> str:
        return f"PS-{secrets.token_hex(3).upper()}"

    @staticmethod
    def _generate_bundle_id() -> str:
        return f"BD-{secrets.token_hex(3).upper()}"

    def _dispatch_plan_proposal(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        request: CapabilityExecutionRequest,
        proposal,
    ) -> CapabilityExecutionResult:
        if proposal.target_capability_id == "repo.status.read":
            return self._execute_repo_status(update=update, snapshot=snapshot, argument=proposal.command_argument)
        if proposal.target_capability_id == "file.read":
            return self._execute_file_read(update=update, snapshot=snapshot, argument=proposal.command_argument)
        confirmation = self._synthetic_plan_confirmation(update=update, snapshot=snapshot, proposal=proposal)
        if proposal.target_capability_id == "shell.command.run":
            return self._execute_confirmed_run_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
        if proposal.target_capability_id == "test.command.run":
            return self._execute_confirmed_test_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
        return self._result(
            request,
            outcome="failed",
            reason_code="unsupported_plan_step_target",
            user_message="Plan approval failed.\nReason: The proposed step target is not supported.",
            internal_summary=f"Unsupported plan proposal target: {proposal.target_capability_id}.",
            retryable=False,
            command_label="/planapprove",
            activity_state="processing_command",
        )

    def _dispatch_chat_routed_action(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        routed_action: str,
        message: str,
    ) -> CapabilityExecutionResult:
        if routed_action == "/translate":
            return self._execute_translate(update=update, snapshot=snapshot, argument=message)
        if routed_action == "/refine":
            return self._execute_refine(update=update, snapshot=snapshot, argument=message)
        if routed_action == "/translateview":
            return self._execute_translate_view(update=update, snapshot=snapshot)
        if routed_action == "/planbuild":
            return self._execute_plan_build(update=update, snapshot=snapshot)
        if routed_action == "/planview":
            return self._execute_plan_view(update=update, snapshot=snapshot)
        if routed_action == "/planstep":
            return self._execute_plan_step(update=update, snapshot=snapshot)
        if routed_action == "/planstepbundle":
            return self._execute_plan_step_bundle(update=update, snapshot=snapshot)
        if routed_action == "/planstatus":
            return self._execute_plan_status(update=update, snapshot=snapshot)
        if routed_action == "/bundlestatus":
            return self._execute_bundle_status(update=update, snapshot=snapshot)
        if routed_action == "/lastaction":
            return self._execute_last_action(update=update, snapshot=snapshot)
        if routed_action == "/status":
            return self._execute_status(update=update, snapshot=snapshot)
        request = self._build_request(
            capability_id="chat.orchestrate.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chat",
            parsed_arguments={"message": message, "routed_action": routed_action},
        )
        return self._result(
            request,
            outcome="failed",
            reason_code="unsupported_chat_route",
            user_message="Couldn't complete that chat route.\nReason: The requested orchestration route is not supported.",
            internal_summary=f"Unsupported /chat route: {routed_action or 'empty'}.",
            retryable=False,
            command_label="/chat",
            activity_state="processing_command",
        )

    def _dispatch_bundle_step(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        request: CapabilityExecutionRequest,
        step,
    ) -> CapabilityExecutionResult:
        if step.target_capability_id == "repo.status.read":
            return self._execute_repo_status(update=update, snapshot=snapshot, argument=step.command_argument)
        if step.target_capability_id == "file.read":
            return self._execute_file_read(update=update, snapshot=snapshot, argument=step.command_argument)
        confirmation = self._synthetic_bundle_confirmation(update=update, snapshot=snapshot, step=step)
        if step.target_capability_id == "shell.command.run":
            return self._execute_confirmed_run_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
        if step.target_capability_id == "test.command.run":
            return self._execute_confirmed_test_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
        return self._result(
            request,
            outcome="failed",
            reason_code="unsupported_bundle_step_target",
            user_message="Bundle approval failed.\nReason: The proposed bundle step target is not supported.",
            internal_summary=f"Unsupported bundle step target: {step.target_capability_id}.",
            retryable=False,
            command_label="/bundleapprove",
            activity_state="processing_command",
        )

    def _synthetic_plan_confirmation(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, proposal) -> PendingConfirmation:
        _, context = self._service._evaluate_capability_id(
            proposal.target_capability_id,
            snapshot,
            remember=False,
            confirmation_granted=True,
        )
        now = self._service._now_iso()
        return PendingConfirmation(
            confirmation_id=proposal.proposal_id,
            capability_id=proposal.target_capability_id,
            original_command=proposal.command_label,
            argument_summary=proposal.suggested_entry_command,
            prompt_text=proposal.command_argument,
            response_style="concise",
            timestamp_created=now,
            expires_at=now,
            current_state="approved",
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
            metadata={
                "execution_command_summary": proposal.suggested_entry_command,
                "execution_action_summary": proposal.title,
                "plan_id": proposal.plan_id,
                "task_group_id": proposal.task_group_id,
            },
        )

    def _synthetic_bundle_confirmation(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, step) -> PendingConfirmation:
        _, context = self._service._evaluate_capability_id(
            step.target_capability_id,
            snapshot,
            remember=False,
            confirmation_granted=True,
        )
        now = self._service._now_iso()
        return PendingConfirmation(
            confirmation_id=f"{step.plan_id}-{step.task_group_id}-{step.step_index}",
            capability_id=step.target_capability_id,
            original_command=step.command_label,
            argument_summary=step.suggested_entry_command,
            prompt_text=step.command_argument,
            response_style="concise",
            timestamp_created=now,
            expires_at=now,
            current_state="approved",
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
            metadata={
                "execution_command_summary": step.suggested_entry_command,
                "execution_action_summary": step.title,
                "plan_id": step.plan_id,
                "task_group_id": step.task_group_id,
                "bundle_step_index": step.step_index,
            },
        )

    def _synthetic_bootstrap_confirmation(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, proposal, file_spec) -> PendingConfirmation:
        _, context = self._service._evaluate_capability_id(
            "file.create.write",
            snapshot,
            remember=False,
            confirmation_granted=True,
        )
        now = self._service._now_iso()
        confirmation_seed = secrets.token_hex(2).upper()
        return PendingConfirmation(
            confirmation_id=f"{proposal.bootstrap_id}-{confirmation_seed}",
            capability_id="file.create.write",
            original_command="/bootstrapapprove",
            argument_summary=file_spec.relative_path,
            prompt_text=file_spec.to_create_command_argument(),
            response_style="concise",
            timestamp_created=now,
            expires_at=now,
            current_state="approved",
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
            metadata={
                "execution_command_summary": file_spec.relative_path,
                "execution_action_summary": f"bootstrap create {file_spec.relative_path}",
                "bootstrap_id": proposal.bootstrap_id,
                "bootstrap_type": proposal.project_type,
            },
        )

    def _bootstrap_failure_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        proposal,
        relative_path: str,
        inner_result: CapabilityExecutionResult,
    ) -> CapabilityExecutionResult:
        reason = str(inner_result.telemetry.get("file_status") or inner_result.internal_summary or "Bootstrap file creation failed.")
        next_step = self._bootstrap_next_step(inner_result.outcome_reason_code)
        return self._result(
            request,
            outcome=inner_result.outcome,
            reason_code=inner_result.outcome_reason_code,
            user_message="\n".join(
                (
                    "Bootstrap blocked",
                    "Reason:",
                    f"- {(relative_path or 'unknown')}: {reason}",
                    f"Next: {next_step}",
                )
            ),
            internal_summary=(
                f"build.bootstrap.approve.query stopped bootstrap {proposal.bootstrap_id} at {relative_path or 'unknown'}; "
                f"inner outcome={inner_result.outcome}."
            ),
            retryable=inner_result.retryable,
            command_label="/bootstrapapprove",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "bootstrap_id": proposal.bootstrap_id,
                "bootstrap_type": proposal.project_type,
                "bootstrap_file_count": len(proposal.files),
                "bootstrap_created_count": len(proposal.completed_files),
                "bootstrap_follow_up": " | ".join(proposal.follow_up_commands[:2]),
                "bootstrap_summary": proposal.summary,
                "bootstrap_proposal": proposal.to_payload(),
                "display_path": relative_path,
            },
        )

    @staticmethod
    def _bootstrap_next_step(reason_code: str) -> str:
        next_step_map = {
            "repo_root_invalid": "Configure the repository root, then rerun /bootstrapapprove.",
            "file_scope_ambiguous": "Narrow the allowed file roots before trying the bootstrap again.",
            "file_already_exists": "Reset the proposal or choose a clean target before approving again.",
            "target_path_not_allowed": "Use a target path inside the configured repo and allowed roots only.",
            "bootstrap_outside_repo_root": "Align the repo root and file scope before rerunning /bootstrapapprove.",
        }
        return next_step_map.get(reason_code, "Inspect the blocking file path, then rerun /bootstrapproject or /bootstrapapprove explicitly.")

    def _prepare_bridge_state_for_bundle_step(self, *, plan, state, step):
        state = self._service._plan_bridge.ensure_state(plan, state)
        phase, task_group = self._find_plan_task_group(plan, phase_id=step.phase_id, task_group_id=step.task_group_id)
        progress_map = {item.task_group_id: item for item in state.task_group_progress}
        progress = progress_map[step.task_group_id]
        proposal = self._service._plan_bridge.build_task_group_proposal(
            plan,
            phase=phase,
            task_group=task_group,
            previous_status=progress.status,
            proposal_id=f"{step.plan_id}-{step.task_group_id}-EXEC",
        )
        entries = [
            type(item)(
                phase_id=item.phase_id,
                task_group_id=item.task_group_id,
                task_group_name=item.task_group_name,
                status="in_progress" if item.task_group_id == step.task_group_id else item.status,
                execution_proposal=proposal if item.task_group_id == step.task_group_id else item.execution_proposal,
                last_result_summary=item.last_result_summary,
                last_result_state=item.last_result_state,
            )
            for item in state.task_group_progress
        ]
        return (
            type(state)(
                active_plan_id=state.active_plan_id,
                current_phase_id=step.phase_id,
                current_task_group_id=step.task_group_id,
                current_step_state="executing",
                execution_proposal=proposal,
                task_group_progress=tuple(entries),
                last_result_summary=state.last_result_summary,
                last_result_state=state.last_result_state,
            ),
            proposal,
        )

    @staticmethod
    def _find_plan_task_group(plan, *, phase_id: str, task_group_id: str):
        for phase in plan.phases:
            if phase.phase_id != phase_id:
                continue
            for task_group in phase.task_groups:
                if task_group.task_group_id == task_group_id:
                    return phase, task_group
        raise ValueError(f"Unknown plan task group: {phase_id}/{task_group_id}")

    def _invalidate_bundle_for_plan_change(self, *, chat_id: str, reason: str):
        state = self._service._autonomy_bundle_store.get_active(chat_id=chat_id)
        if state is None or self._service._autonomy_bundle.is_terminal(state):
            return state
        invalidated = self._service._autonomy_bundle.mark_invalidated(
            state,
            reason=reason,
            timestamp=self._service._now_iso(),
        )
        self._service._autonomy_bundle_store.set_active(chat_id=chat_id, state=invalidated)
        return invalidated

    def _execute_mode(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="mode.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/mode",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
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
        request, evaluation, context, scope_failure = self._prepare_capability_request(
            capability_id="models.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/models",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
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

    def _execute_repo_status(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        normalized_argument = " ".join(argument.split()).lower()
        evaluation, context = self._service._evaluate_capability_id(
            "repo.status.read",
            snapshot,
            remember=True,
        )
        request = self._build_request(
            capability_id="repo.status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/repo",
            parsed_arguments={"view": normalized_argument},
            context=context,
            metadata={"argument_summary": "/repo" if not normalized_argument else f"/repo {normalized_argument}"},
        )
        if normalized_argument not in {"", "status"}:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="invalid_repo_command",
                user_message="Couldn't parse that repo command.\nNext: Use /repo or /repo status.",
                internal_summary="/repo rejected because the argument was invalid.",
                retryable=False,
                command_label="/repo",
                activity_state="processing_command",
            )
        if evaluation.current_availability_state != "allowed":
            outcome = "blocked"
            retryable = True
            if evaluation.current_availability_state == "unavailable":
                outcome = "unavailable"
            elif evaluation.current_availability_state == "degraded":
                outcome = "degraded"
            return self._result(
                request,
                outcome=outcome,
                reason_code=evaluation.reason_code,
                user_message="\n".join(
                    (
                        "Can't run /repo right now.",
                        f"Reason: {evaluation.blocking_reason or evaluation.message}",
                        "Next: Check the configured repository path and current readiness in the operator console.",
                    )
                ),
                internal_summary=f"repo.status.read blocked: {evaluation.reason_code}.",
                retryable=retryable,
                degraded=outcome == "degraded",
                command_label="/repo",
                activity_state="processing_command",
            )
        scope_failure = self._scope_failure_result(request, command_label="/repo")
        if scope_failure is not None:
            return scope_failure
        try:
            inspection = self._service.inspect_repo_status()
        except RepoInspectorError as exc:
            return self._repo_error_result(request=request, error=exc)
        reply = self._service._build_repo_reply(inspection).reply
        context_entry = self._service.create_context_buffer(
            source_capability_id="repo.status.read",
            source_command="/repo",
            scope_type=request.scope.scope_type,
            source_summary=f"{inspection.repo_name} {inspection.branch} {inspection.status_label}",
            content_kind="repo_summary",
            normalized_content=reply,
            content_preview=inspection.audit_summary,
            size_class="summary",
            chat_id=update.chat_id,
            user_id=update.chat_id,
            request_id=request.request_id,
        )
        reply = "\n".join((reply, self._service._context_ready_note(context_entry)))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"repo.status.read returned {inspection.audit_summary}.",
            retryable=False,
            command_label="/repo",
            activity_state="processing_command",
            telemetry={
                "repo_root": inspection.repo_root,
                "repo_name": inspection.repo_name,
                "repo_branch": inspection.branch,
                "repo_status_label": inspection.status_label,
                "repo_changed_count": inspection.changed_count,
                "repo_checked_at": inspection.inspected_at,
                "repo_summary": inspection.audit_summary,
                "context_created_id": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
            },
        )

    def _execute_file_read(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        relative_path, target_path, allowed_roots, resolve_code, resolve_message = self._service.resolve_file_request(argument)
        evaluation, context = self._service._evaluate_capability_id(
            "file.read",
            snapshot,
            remember=True,
        )
        scope = ExecutionScope(
            scope_type="filesystem",
            access_mode="read",
            allowed_paths=allowed_roots,
            target_path=target_path,
        )
        request = self._build_request(
            capability_id="file.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/file",
            parsed_arguments={"relative_path": relative_path},
            context=context,
            metadata={"argument_summary": f"/file {relative_path or '[missing]'}"},
            scope_override=scope,
        )
        if resolve_code == "missing_file_path":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_file_path",
                user_message="Couldn't parse that file command.\nNext: Use /file <relative_path>.",
                internal_summary="/file rejected because no relative path was provided.",
                retryable=False,
                command_label="/file",
                activity_state="processing_command",
            )
        if resolve_code == "absolute_path_not_allowed":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="absolute_path_not_allowed",
                user_message="Couldn't parse that file command.\nNext: Use /file <relative_path> inside the allowed directories.",
                internal_summary="/file rejected because an absolute path was provided.",
                retryable=False,
                command_label="/file",
                activity_state="processing_command",
            )
        if evaluation.current_availability_state != "allowed":
            outcome = "blocked"
            retryable = True
            if evaluation.current_availability_state == "unavailable":
                outcome = "unavailable"
            elif evaluation.current_availability_state == "degraded":
                outcome = "degraded"
            return self._result(
                request,
                outcome=outcome,
                reason_code=evaluation.reason_code,
                user_message="\n".join(
                    (
                        "Can't run /file right now.",
                        f"Reason: {evaluation.blocking_reason or evaluation.message}",
                        "Next: Check readiness and the configured allowed file roots in the operator console.",
                    )
                ),
                internal_summary=f"file.read blocked: {evaluation.reason_code}.",
                retryable=retryable,
                degraded=outcome == "degraded",
                command_label="/file",
                activity_state="processing_command",
            )
        if resolve_code == "target_path_not_allowed":
            return self._file_error_result(
                request=request,
                error=FileReaderError(resolve_code, resolve_message),
                relative_path=relative_path,
            )
        scope_failure = self._scope_failure_result(request, command_label="/file")
        if scope_failure is not None:
            return scope_failure
        if resolve_code != "file_target_ready":
            return self._file_error_result(
                request=request,
                error=FileReaderError(resolve_code, resolve_message),
                relative_path=relative_path,
            )
        try:
            preview = self._service.read_file_preview(relative_path)
        except FileReaderError as exc:
            return self._file_error_result(request=request, error=exc, relative_path=relative_path)
        reply = self._service._build_file_reply(preview).reply
        context_entry = self._service.create_context_buffer(
            source_capability_id="file.read",
            source_command="/file",
            scope_type=request.scope.scope_type,
            source_summary=preview.display_path,
            content_kind="file_preview",
            normalized_content=reply,
            content_preview=preview.display_path,
            size_class=preview.size_category,
            chat_id=update.chat_id,
            user_id=update.chat_id,
            request_id=request.request_id,
        )
        reply = "\n".join((reply, self._service._context_ready_note(context_entry)))
        if preview.oversized:
            file_status = "Large file preview truncated."
        elif preview.truncated:
            file_status = "Preview truncated."
        else:
            file_status = "Preview ready."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"file.read returned {preview.display_path} ({preview.size_label}).",
            retryable=False,
            command_label="/file",
            activity_state="processing_command",
            telemetry={
                "display_path": preview.display_path,
                "file_name": preview.file_name,
                "file_status": file_status,
                "file_truncated": preview.truncated,
                "file_size_bytes": preview.size_bytes,
                "file_size_label": preview.size_label,
                "file_size_category": preview.size_category,
                "file_read_at": preview.read_at,
                "file_summary": preview.audit_summary,
                "context_created_id": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
            },
        )

    def _execute_file_patch(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request = self._build_request(
            capability_id="file.patch.write",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/patchfile",
            parsed_arguments={},
            metadata={"argument_summary": "/patchfile [path hidden]"},
        )
        try:
            parsed = parse_patch_command(argument)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/patchfile",
                confirmation_id="",
            )

        return self._execute_pending_file_mutation(
            update=update,
            snapshot=snapshot,
            capability_id="file.patch.write",
            command_label="/patchfile",
            relative_path=parsed.relative_path,
            raw_argument=parsed.raw_argument,
            confirmation_preview=summarize_patch_request(parsed),
            operator_reason=parsed.operator_reason,
            expected_base_hash=parsed.expected_base_hash,
        )

    def _execute_file_create(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request = self._build_request(
            capability_id="file.create.write",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/createfile",
            parsed_arguments={},
            metadata={"argument_summary": "/createfile [path hidden]"},
        )
        try:
            parsed = parse_create_command(argument)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/createfile",
                confirmation_id="",
            )

        return self._execute_pending_file_creation(
            update=update,
            snapshot=snapshot,
            relative_path=parsed.relative_path,
            raw_argument=parsed.raw_argument,
            confirmation_preview=summarize_create_request(parsed),
            operator_reason=parsed.operator_reason,
        )

    def _execute_file_replace(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request = self._build_request(
            capability_id="file.write.replace",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/writefile",
            parsed_arguments={},
            metadata={"argument_summary": "/writefile [path hidden]"},
        )
        try:
            parsed = parse_write_command(argument)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/writefile",
                confirmation_id="",
            )

        return self._execute_pending_file_mutation(
            update=update,
            snapshot=snapshot,
            capability_id="file.write.replace",
            command_label="/writefile",
            relative_path=parsed.relative_path,
            raw_argument=parsed.raw_argument,
            confirmation_preview=summarize_write_request(parsed),
            operator_reason=parsed.operator_reason,
            expected_base_hash=parsed.expected_base_hash,
        )

    def _execute_run_command(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        repo_root, _, _, _ = self._service._repo_configuration_state()
        request = self._build_request(
            capability_id="shell.command.run",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/run",
            parsed_arguments={},
            metadata={"argument_summary": "/run [command hidden]"},
        )
        try:
            local_request = self._service._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=repo_root,
                command_text=argument,
                expected_scope=self._service._repo_display_name(repo_root),
            )
        except ExecutionRunnerError as exc:
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary="",
                command_label="/run",
                confirmation_id="",
            )
        return self._execute_pending_local_command(
            update=update,
            snapshot=snapshot,
            capability_id="shell.command.run",
            command_label="/run",
            raw_prompt=local_request.command_text,
            local_request=local_request,
        )

    def _execute_test_command(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        repo_root, _, _, _ = self._service._repo_configuration_state()
        request = self._build_request(
            capability_id="test.command.run",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/test",
            parsed_arguments={},
            metadata={"argument_summary": "/test [target hidden]"},
        )
        try:
            local_request = self._service._execution_runner.build_test_request(
                capability_id="test.command.run",
                repo_root=repo_root,
                target=argument,
                expected_scope=self._service._repo_display_name(repo_root),
            )
        except ExecutionRunnerError as exc:
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary="",
                command_label="/test",
                confirmation_id="",
            )
        return self._execute_pending_local_command(
            update=update,
            snapshot=snapshot,
            capability_id="test.command.run",
            command_label="/test",
            raw_prompt=argument.strip(),
            local_request=local_request,
        )

    def _execute_pending_local_command(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        capability_id: str,
        command_label: str,
        raw_prompt: str,
        local_request: LocalCommandExecutionRequest,
    ) -> CapabilityExecutionResult:
        evaluation, context = self._service._evaluate_capability_id(
            capability_id,
            snapshot,
            remember=True,
        )
        repo_root = local_request.working_directory
        scope = ExecutionScope(
            scope_type="repository",
            access_mode="execute",
            repo_root=repo_root,
            target_path=repo_root,
        )
        action_summary = f"{command_label} {local_request.command_summary}"
        target_node = self._service.resolve_execution_node()
        request = self._build_request(
            capability_id=capability_id,
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"command": local_request.command_summary},
            context=context,
            metadata={
                "argument_summary": action_summary,
                "confirmation_action_label": action_summary,
                "confirmation_preview_lines": (
                    f"Preview: run {local_request.command_summary}",
                    f"Node: {target_node.node.display_name} ({target_node.node.node_id}) | {target_node.node.node_type}",
                    f"Scope: {self._service._repo_display_name(repo_root)} | timeout {int(local_request.timeout_seconds)}s",
                ),
                "confirmation_metadata": {
                    "execution_kind": local_request.command_kind,
                    "execution_command_summary": local_request.command_summary,
                    "execution_action_summary": f"{local_request.command_summary} | {self._service._repo_display_name(repo_root)}",
                    "execution_timeout_seconds": str(int(local_request.timeout_seconds)),
                    "target_node_id": target_node.node.node_id,
                    "target_node_name": target_node.node.display_name,
                    "target_node_type": target_node.node.node_type,
                    "target_node_transport": target_node.node.transport,
                    "target_node_summary": f"{target_node.node.display_name} ({target_node.node.node_id})",
                },
            },
            scope_override=scope,
        )
        if evaluation.current_availability_state == "confirmation_required":
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=raw_prompt,
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._local_command_blocked_result(
                request=request,
                evaluation=evaluation,
                command_label=command_label,
            )
        scope_failure = self._scope_failure_result(request, command_label=command_label)
        if scope_failure is not None:
            return scope_failure
        return self._confirmation_result(
            request=request,
            confirmation_id="pending",
            outcome="failed",
            reason_code="unexpected_execution_without_confirmation",
            reason="Bounded command execution should require confirmation before it can run.",
            next_step="Resend the original command if you still want to request a confirmation.",
            retryable=False,
        )

    def _execute_pending_file_mutation(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        capability_id: str,
        command_label: str,
        relative_path: str,
        raw_argument: str,
        confirmation_preview: str,
        operator_reason: str,
        expected_base_hash: str,
    ) -> CapabilityExecutionResult:
        relative_path, target_path, allowed_roots, resolve_code, resolve_message = self._service.resolve_file_request(relative_path)
        evaluation, context = self._service._evaluate_capability_id(
            capability_id,
            snapshot,
            remember=True,
        )
        scope = ExecutionScope(
            scope_type="filesystem",
            access_mode="write",
            allowed_paths=allowed_roots,
            target_path=target_path,
        )
        action_summary = f"{command_label} {relative_path or '[missing]'}"
        preview_line = confirmation_preview
        request = self._build_request(
            capability_id=capability_id,
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"relative_path": relative_path},
            context=context,
            metadata={
                "argument_summary": action_summary,
                "confirmation_action_label": action_summary,
                "confirmation_preview_lines": (f"Preview: {preview_line}",),
                "confirmation_metadata": {
                    "mutation_action_summary": f"{relative_path or 'unknown file'} | {'patch' if capability_id == 'file.patch.write' else 'replace'}",
                    "target_path": relative_path,
                    "mutation_operation": "patch" if capability_id == "file.patch.write" else "replace",
                    "mutation_preview": preview_line,
                    "expected_base_hash": expected_base_hash[:12].lower(),
                    "operator_reason": operator_reason,
                },
            },
            scope_override=scope,
        )
        if resolve_code in {"missing_file_path", "absolute_path_not_allowed", "target_path_not_allowed"}:
            return self._file_mutation_error_result(
                request=request,
                error=FileMutatorError(resolve_code, resolve_message),
                relative_path=relative_path,
                command_label=command_label,
                confirmation_id="",
            )
        if resolve_code != "file_target_ready":
            return self._file_mutation_error_result(
                request=request,
                error=FileMutatorError(resolve_code, resolve_message),
                relative_path=relative_path,
                command_label=command_label,
                confirmation_id="",
            )
        if evaluation.current_availability_state == "confirmation_required":
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=raw_argument,
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._file_mutation_blocked_result(
                request=request,
                evaluation=evaluation,
                command_label=command_label,
            )
        scope_failure = self._scope_failure_result(request, command_label=command_label)
        if scope_failure is not None:
            return scope_failure
        return self._confirmation_result(
            request=request,
            confirmation_id="pending",
            outcome="failed",
            reason_code="unexpected_mutation_without_confirmation",
            reason="File mutation should require confirmation before execution.",
            next_step="Resend the original command if you still want to request a confirmation.",
            retryable=False,
        )

    def _execute_pending_file_creation(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        relative_path: str,
        raw_argument: str,
        confirmation_preview: str,
        operator_reason: str,
    ) -> CapabilityExecutionResult:
        relative_path, target_path, allowed_roots, missing_directories, resolve_code, resolve_message = self._service.resolve_file_creation_request(relative_path)
        evaluation, context = self._service._evaluate_capability_id(
            "file.create.write",
            snapshot,
            remember=True,
        )
        scope = ExecutionScope(
            scope_type="filesystem",
            access_mode="write",
            allowed_paths=allowed_roots,
            target_path=target_path,
        )
        preview_lines = [f"Preview: {confirmation_preview}"]
        if missing_directories:
            preview_lines.append(f"Will create directories: {', '.join(missing_directories)}")
        request = self._build_request(
            capability_id="file.create.write",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/createfile",
            parsed_arguments={"relative_path": relative_path},
            context=context,
            metadata={
                "argument_summary": f"/createfile {relative_path or '[missing]'}",
                "confirmation_action_label": f"/createfile {relative_path or '[missing]'}",
                "confirmation_preview_lines": tuple(preview_lines),
                "confirmation_metadata": {
                    "mutation_action_summary": f"{relative_path or 'unknown file'} | create",
                    "target_path": relative_path,
                    "mutation_operation": "create",
                    "mutation_preview": confirmation_preview,
                    "operator_reason": operator_reason,
                    "created_directories": ",".join(missing_directories),
                },
            },
            scope_override=scope,
        )
        if resolve_code in {
            "missing_file_path",
            "absolute_path_not_allowed",
            "target_path_not_allowed",
            "file_already_exists",
            "file_target_is_directory",
            "parent_not_directory",
            "file_scope_ambiguous",
        }:
            return self._file_mutation_error_result(
                request=request,
                error=FileMutatorError(resolve_code, resolve_message),
                relative_path=relative_path,
                command_label="/createfile",
                confirmation_id="",
            )
        if resolve_code != "file_create_ready":
            return self._file_mutation_error_result(
                request=request,
                error=FileMutatorError(resolve_code, resolve_message),
                relative_path=relative_path,
                command_label="/createfile",
                confirmation_id="",
            )
        if evaluation.current_availability_state == "confirmation_required":
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=raw_argument,
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._file_mutation_blocked_result(
                request=request,
                evaluation=evaluation,
                command_label="/createfile",
            )
        scope_failure = self._scope_failure_result(request, command_label="/createfile")
        if scope_failure is not None:
            return scope_failure
        return self._confirmation_result(
            request=request,
            confirmation_id="pending",
            outcome="failed",
            reason_code="unexpected_creation_without_confirmation",
            reason="File creation should require confirmation before execution.",
            next_step="Resend the original command if you still want to request a confirmation.",
            retryable=False,
        )

    def _execute_repo_explain(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        return self._service._workflow_executor.execute_repo_explain(
            update=update,
            snapshot=snapshot,
            relative_path=argument,
            batch_busy=batch_busy,
        )

    def _execute_file_explain(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        return self._service._workflow_executor.execute_file_explain(
            update=update,
            snapshot=snapshot,
            relative_path=argument,
            batch_busy=batch_busy,
        )

    def _execute_web_summarize(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        return self._service._workflow_executor.execute_web_summarize(
            update=update,
            snapshot=snapshot,
            target_url=argument,
            batch_busy=batch_busy,
        )

    def _execute_web_fetch(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        display_url, normalized_url, allowed_domains, target_domain, resolve_code, resolve_message = self._service.resolve_web_request(argument)
        evaluation, context = self._service._evaluate_capability_id(
            "web.fetch.read",
            snapshot,
            remember=True,
        )
        scope = ExecutionScope(
            scope_type="network",
            access_mode="read",
            target_domain=target_domain,
            domain_allowlist=allowed_domains,
        )
        request = self._build_request(
            capability_id="web.fetch.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/web",
            parsed_arguments={"url": display_url},
            context=context,
            metadata={"argument_summary": f"/web {display_url or '[missing]'}"},
            scope_override=scope,
        )
        if resolve_code == "missing_url":
            return self._web_error_result(
                request=request,
                error=WebFetchError("missing_url", "Use /web <https://allowed-domain/path>."),
                display_url=display_url,
            )
        if resolve_code in {"malformed_url", "unsupported_url_scheme"}:
            return self._web_error_result(
                request=request,
                error=WebFetchError(resolve_code, resolve_message),
                display_url=display_url,
            )
        if resolve_code == "web_target_ready":
            scope_failure = self._scope_failure_result(request, command_label="/web")
            if scope_failure is not None:
                return scope_failure
        if evaluation.current_availability_state == "confirmation_required":
            return self._web_confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                normalized_url=normalized_url,
                display_url=display_url,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._web_blocked_result(
                request=request,
                evaluation=evaluation,
            )
        if resolve_code != "web_target_ready":
            return self._web_error_result(
                request=request,
                error=WebFetchError(resolve_code, resolve_message),
                display_url=display_url,
            )
        try:
            preview = self._service.fetch_web_preview(normalized_url)
        except WebFetchError as exc:
            return self._web_error_result(request=request, error=exc, display_url=display_url)
        reply = self._service._build_web_reply(preview).reply
        context_entry = self._service.create_context_buffer(
            source_capability_id="web.fetch.read",
            source_command="/web",
            scope_type=request.scope.scope_type,
            source_summary=preview.domain,
            content_kind="web_preview",
            normalized_content=reply,
            content_preview=preview.audit_summary,
            size_class=preview.size_category,
            chat_id=update.chat_id,
            user_id=update.chat_id,
            request_id=request.request_id,
        )
        reply = "\n".join((reply, self._service._context_ready_note(context_entry)))
        if preview.oversized:
            status = "Large web preview truncated."
        elif preview.truncated:
            status = "Web preview truncated."
        else:
            status = "Web preview ready."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"web.fetch.read returned {preview.domain} ({preview.content_type}).",
            retryable=False,
            command_label="/web",
            activity_state="processing_command",
            mode_used="online" if snapshot.mode == "online" else snapshot.mode,
            telemetry={
                "web_domain": preview.domain,
                "web_display_url": preview.display_url,
                "web_content_type": preview.content_type,
                "web_status": status,
                "web_truncated": preview.truncated,
                "web_size_bytes": preview.size_bytes,
                "web_size_label": preview.size_label,
                "web_size_category": preview.size_category,
                "web_fetched_at": preview.fetched_at,
                "web_summary": preview.audit_summary,
                "context_created_id": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
            },
        )

    def _execute_contexts(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="context.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/contexts",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        contexts = self._service.recent_contexts_for_chat(chat_id=update.chat_id, limit=5)
        reply = self._service._build_contexts_reply(chat_id=update.chat_id, limit=5).reply
        summary = f"contexts.read returned {len(contexts)} context entries for chat {update.chat_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=summary,
            retryable=False,
            command_label="/contexts",
            activity_state="processing_command",
            telemetry={"context_summary": f"contexts listed ({len(contexts)})"},
        )

    def _execute_workflows(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="workflow.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/workflows",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        workflows = self._service.recent_workflows_for_chat(chat_id=update.chat_id, limit=5)
        reply = self._service._build_workflows_reply(chat_id=update.chat_id, limit=5).reply
        summary = f"workflow.read returned {len(workflows)} workflows for chat {update.chat_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=summary,
            retryable=False,
            command_label="/workflows",
            activity_state="processing_command",
            telemetry={"workflow_count": len(workflows)},
        )

    def _execute_workflow_status(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        reference = " ".join(argument.split())
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="workflow.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/workflowstatus",
            parsed_arguments={"reference": reference},
        )
        if scope_failure is not None:
            return scope_failure
        record = self._service.resolve_workflow_for_chat(chat_id=update.chat_id, reference=reference) if reference else self._service.current_or_latest_workflow_for_chat(chat_id=update.chat_id)
        reply = self._service._build_workflow_status_reply(chat_id=update.chat_id, reference=reference).reply
        if record is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="workflow_not_found",
                user_message=reply,
                internal_summary=f"workflow.read found no workflow for chat {update.chat_id}.",
                retryable=False,
                command_label="/workflowstatus",
                activity_state="processing_command",
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"workflow.read returned {record.workflow_id} in state {record.current_state}.",
            retryable=False,
            command_label="/workflowstatus",
            activity_state="processing_command",
            telemetry={"workflow_id": record.workflow_id, "workflow_state": record.current_state},
        )

    def _execute_cancel_workflow(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        reference = " ".join(argument.split())
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="workflow.cancel",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/cancelworkflow",
            parsed_arguments={"reference": reference},
        )
        if scope_failure is not None:
            return scope_failure
        outcome, record = self._service._workflow_executor.cancel_workflow(chat_id=update.chat_id, reference=reference)
        if outcome == "no_active":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="workflow_not_active",
                user_message="No active workflow is available to cancel in this chat.",
                internal_summary=f"workflow.cancel found no active workflow for chat {update.chat_id}.",
                retryable=False,
                command_label="/cancelworkflow",
                activity_state="processing_command",
            )
        if outcome == "not_found":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="workflow_not_found",
                user_message=f"Workflow {reference or '[missing]'} was not found in this chat.",
                internal_summary=f"workflow.cancel could not find workflow reference {reference or '[missing]'}.",
                retryable=False,
                command_label="/cancelworkflow",
                activity_state="processing_command",
            )
        if outcome == "not_cancellable" and record is not None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="workflow_not_cancellable",
                user_message=f"Workflow {record.workflow_id} is already {record.current_state.replace('_', ' ')} and cannot be cancelled.",
                internal_summary=f"workflow.cancel skipped terminal workflow {record.workflow_id} ({record.current_state}).",
                retryable=False,
                command_label="/cancelworkflow",
                activity_state="processing_command",
            )
        if record is None:
            return self._result(
                request,
                outcome="failed",
                reason_code="workflow_cancel_failed",
                user_message="Workflow cancellation failed unexpectedly.",
                internal_summary="workflow.cancel returned no workflow record.",
                retryable=False,
                command_label="/cancelworkflow",
                activity_state="processing_command",
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=record.final_user_facing_summary,
            internal_summary=f"workflow.cancel cancelled {record.workflow_id}.",
            retryable=False,
            command_label="/cancelworkflow",
            activity_state="processing_command",
            telemetry={"workflow_id": record.workflow_id, "workflow_state": record.current_state},
        )

    def _execute_clear_context(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="context.clear",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/clearcontext",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        cleared = self._service.clear_contexts_for_chat(chat_id=update.chat_id)
        reply = self._service._build_clear_context_reply(cleared_count=cleared).reply
        summary = f"Cleared {cleared} buffered context entries for chat {update.chat_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=summary,
            retryable=False,
            command_label="/clearcontext",
            activity_state="processing_command",
            telemetry={"context_clear_summary": summary},
        )

    def _execute_provider_query_with_latest_context(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        prompt: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        context_entry = self._service.latest_context_for_chat(chat_id=update.chat_id)
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/asklast",
            parsed_arguments={"prompt": " ".join(prompt.split())},
            metadata={"argument_summary": "/asklast [prompt hidden]", "response_style": "concise"},
        )
        if not " ".join(prompt.split()):
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_prompt",
                user_message="Couldn't run that ask.\nReason: No prompt was provided.\nNext: Try /asklast <prompt>.",
                internal_summary="/asklast rejected because no prompt was provided.",
                retryable=False,
                command_label="/asklast",
                activity_state="processing_command",
                ask_status="/asklast invalid: missing prompt.",
                hide_content_in_summary=True,
            )
        if context_entry is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="context_not_found",
                user_message="No recent context is available in this chat.\nNext: Run /repo, /file, or /web first, then retry /asklast <prompt>.",
                internal_summary="/asklast rejected because no recent context was available.",
                retryable=False,
                command_label="/asklast",
                activity_state="processing_command",
                ask_status="/asklast invalid: no recent context.",
                hide_content_in_summary=True,
            )
        return self._execute_provider_query(
            update=update,
            snapshot=snapshot,
            command_label="/asklast",
            prompt=prompt,
            response_style="concise",
            batch_busy=batch_busy,
            context_entry=context_entry,
        )

    def _execute_provider_query_with_selected_context(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        reference, prompt = self._parse_context_prompt_argument(argument)
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/askctx",
            parsed_arguments={"context_id": reference, "prompt": prompt},
            metadata={"argument_summary": f"/askctx {reference or '<missing>'} [prompt hidden]", "response_style": "concise"},
        )
        if not reference:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_context_id",
                user_message="Couldn't run that ask.\nReason: No context id was provided.\nNext: Try /askctx <context_id> <prompt>.",
                internal_summary="/askctx rejected because no context id was provided.",
                retryable=False,
                command_label="/askctx",
                activity_state="processing_command",
                ask_status="/askctx invalid: missing context id.",
                hide_content_in_summary=True,
            )
        if not prompt:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_prompt",
                user_message="Couldn't run that ask.\nReason: No prompt was provided.\nNext: Try /askctx <context_id> <prompt>.",
                internal_summary=f"/askctx rejected because no prompt was provided for context {reference}.",
                retryable=False,
                command_label="/askctx",
                activity_state="processing_command",
                ask_status="/askctx invalid: missing prompt.",
                hide_content_in_summary=True,
            )
        context_entry = self._service.resolve_context_for_chat(chat_id=update.chat_id, reference=reference)
        if context_entry is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="context_not_found",
                user_message=f"Context {reference.upper()} was not found.\nNext: Run /contexts to inspect available context ids, then retry /askctx.",
                internal_summary=f"/askctx rejected because context {reference.upper()} was not available in this chat.",
                retryable=False,
                command_label="/askctx",
                activity_state="processing_command",
                ask_status=f"/askctx invalid: context {reference.upper()} not found.",
                hide_content_in_summary=True,
            )
        return self._execute_provider_query(
            update=update,
            snapshot=snapshot,
            command_label="/askctx",
            prompt=prompt,
            response_style="concise",
            batch_busy=batch_busy,
            context_entry=context_entry,
        )

    def _execute_capabilities(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="capabilities.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/capabilities",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
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

    def _execute_audit(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="audit.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/audit",
            parsed_arguments={"limit": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        limit = self._parse_audit_limit(argument)
        if limit is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="invalid_audit_limit",
                user_message="Couldn't parse that audit command.\nNext: Use /audit or /audit <1-8>.",
                internal_summary="/audit rejected because the limit argument was invalid.",
                retryable=False,
                command_label="/audit",
                activity_state="processing_command",
            )
        reply = self._service._build_audit_reply(limit=limit).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="audit.read returned recent capability audit entries.",
            retryable=False,
            command_label="/audit",
            activity_state="processing_command",
        )

    def _repo_error_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        error: RepoInspectorError,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "git_not_installed": "Install Git or add it to PATH on this machine.",
            "repo_not_found": "Update the configured repository root to a valid local path.",
            "repo_root_not_absolute": "Set the repository root to an absolute path in the controller config.",
            "repo_root_not_directory": "Point the repository root at a directory, not a file.",
            "repo_root_invalid": "Check the configured repository root in the controller config.",
            "repo_root_missing": "Configure a repository root before using /repo.",
            "not_git_repository": "Point the repository root at a valid Git repository.",
            "git_command_failed": "Check local Git health for the configured repository, then try again.",
            "repo_inspection_timeout": "Try /repo again in a moment.",
        }
        outcome = "failed"
        retryable = True
        if error.code in {
            "git_not_installed",
            "repo_not_found",
            "repo_root_not_absolute",
            "repo_root_not_directory",
            "repo_root_invalid",
            "repo_root_missing",
            "not_git_repository",
        }:
            outcome = "unavailable"
        elif error.code == "repo_inspection_timeout":
            outcome = "timed_out"
        return self._result(
            request,
            outcome=outcome,
            reason_code=error.code,
            user_message="\n".join(
                (
                    "Can't run /repo right now." if outcome != "timed_out" else "Repository check timed out.",
                    f"Reason: {error.message}",
                    f"Next: {next_step_map.get(error.code, 'Check the repository configuration and try again.')}",
                )
            ),
            internal_summary=f"repo.status.read failed: {error.code}.",
            retryable=retryable,
            command_label="/repo",
            activity_state="provider_failed" if outcome == "failed" else "processing_command",
            telemetry={"repo_summary": f"{self._service._repo_display_name()} | {error.code}"},
        )

    def _file_error_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        error: FileReaderError,
        relative_path: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "file_not_found": "Check the relative path and try again.",
            "file_type_not_supported": "Request a supported text-based file inside the allowed scope.",
            "file_encoding_not_supported": "Request a UTF-8 text file inside the allowed scope.",
            "file_too_large": "Request a smaller file or narrow the target.",
            "file_roots_missing": "Configure at least one allowed file directory in the controller config.",
            "file_roots_not_absolute": "Use absolute allowed file directories in the controller config.",
            "target_path_not_allowed": "Use a relative path inside the allowed directories only.",
        }
        outcome = "unavailable"
        retryable = True
        if error.code == "target_path_not_allowed":
            outcome = "out_of_scope"
            retryable = False
        elif error.code in {"file_not_found"}:
            outcome = "unavailable"
        elif error.code in {"file_type_not_supported", "file_encoding_not_supported", "file_too_large"}:
            outcome = "failed"
        return self._result(
            request,
            outcome=outcome,
            reason_code=error.code,
            user_message="\n".join(
                (
                    "Can't run /file right now." if outcome != "out_of_scope" else "Action is out of scope.",
                    f"Reason: {error.message}",
                    f"Next: {next_step_map.get(error.code, 'Check the file path and allowed directories, then try again.')}",
                )
            ),
            internal_summary=f"file.read failed: {error.code} ({relative_path or 'missing path'}).",
            retryable=retryable,
            command_label="/file",
            activity_state="processing_command",
            telemetry={"display_path": relative_path, "file_summary": f"{relative_path or 'unknown file'} | {error.code}"},
        )

    def _file_mutation_blocked_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        command_label: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "file_scope_invalid": "Configure at least one allowed file directory in the operator console.",
            "operator_confirmation_required": "Approve the pending mutation request with /confirm <id>.",
        }
        outcome = "blocked"
        if evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
        elif evaluation.current_availability_state == "degraded":
            outcome = "degraded"
        return self._result(
            request,
            outcome=outcome,
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    f"Can't run {command_label} right now.",
                    f"Reason: {evaluation.blocking_reason or evaluation.message}",
                    f"Next: {next_step_map.get(evaluation.reason_code, 'Check readiness and the configured file scope in the operator console.')}",
                )
            ),
            internal_summary=f"{request.capability_id} blocked: {evaluation.reason_code}.",
            retryable=True,
            degraded=outcome == "degraded",
            command_label=command_label,
            activity_state="processing_command",
        )

    def _file_mutation_error_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        error: FileMutatorError,
        relative_path: str,
        command_label: str,
        confirmation_id: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "missing_file_path": f"Use {command_label} <relative_path> and include the required mutation body.",
            "missing_mutation_body": f"Use {command_label} <relative_path> and include the required mutation body.",
            "missing_patch_sections": "Use @@ FIND and @@ REPLACE blocks for each bounded patch.",
            "missing_write_content": "Use @@ CONTENT followed by the full replacement file content.",
            "missing_create_content": "Use @@ CONTENT followed by the full file content.",
            "absolute_path_not_allowed": f"Use {command_label} <relative_path> inside the allowed directories.",
            "target_path_not_allowed": "Use a relative path inside the allowed directories only.",
            "file_not_found": "Check the relative path and try again.",
            "file_already_exists": "Use /writefile or /patchfile for existing files.",
            "file_target_is_directory": "Choose a file path that does not already point to a directory.",
            "parent_not_directory": "Choose a path whose parent is a directory inside the allowed roots.",
            "file_scope_ambiguous": "Narrow the allowed file roots before creating a new file.",
            "file_type_not_supported": "Target a supported UTF-8 text file only.",
            "file_encoding_not_supported": "Target a UTF-8 text file only.",
            "file_too_large": "Target a smaller file or narrow the mutation request.",
            "replacement_too_large": "Use a smaller bounded patch or replacement body.",
            "protected_path_not_allowed": "Choose a source file under the allowed roots that is not in a protected control directory.",
            "patch_context_missing": "Re-read the file, refresh the exact patch text, and resend the request.",
            "patch_context_ambiguous": "Narrow the @@ FIND text so it matches exactly one location.",
            "base_hash_mismatch": "Run /file on the target again, then resend the mutation with a fresh base hash.",
            "invalid_base_hash": "Use at least the first 8 hexadecimal characters of the current base hash.",
            "no_changes_requested": "Adjust the request so it would change the target file.",
            "patch_operation_limit_exceeded": "Split the work into smaller patch requests.",
        }
        invalid_request_codes = {
            "missing_file_path",
            "missing_mutation_body",
            "missing_patch_sections",
            "missing_write_content",
            "absolute_path_not_allowed",
            "invalid_base_hash",
        }
        out_of_scope_codes = {"target_path_not_allowed", "protected_path_not_allowed"}
        unavailable_codes = {"file_not_found"}
        outcome = "failed"
        retryable = True
        if error.code in invalid_request_codes:
            outcome = "invalid_request"
            retryable = False
        elif error.code in out_of_scope_codes:
            outcome = "out_of_scope"
            retryable = False
        elif error.code in unavailable_codes:
            outcome = "unavailable"
        title = (
            f"Confirmation {confirmation_id} could not run."
            if confirmation_id
            else ("Action is out of scope." if outcome == "out_of_scope" else f"Can't run {command_label} right now.")
        )
        return self._result(
            request,
            outcome=outcome,
            reason_code=error.code,
            user_message="\n".join(
                (
                    title,
                    f"Reason: {error.message}",
                    f"Next: {next_step_map.get(error.code, 'Check the file path, scope, and mutation payload, then try again.')}",
                )
            ),
            internal_summary=f"{request.capability_id} failed: {error.code} ({relative_path or 'missing path'}).",
            retryable=retryable,
            command_label=command_label,
            activity_state="processing_command",
            confirmation_used=bool(confirmation_id),
            telemetry={
                "display_path": relative_path,
                "file_name": Path(relative_path).name if relative_path else "",
                "file_status": error.message,
                "file_summary": f"{relative_path or 'unknown file'} | {self._file_operation_label(request.capability_id)} | {error.code}",
            },
        )

    def _local_command_blocked_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        command_label: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "repo_root_invalid": "Configure a valid repository root in the operator console.",
            "operator_confirmation_required": "Approve the pending execution request with /confirm <id>.",
        }
        outcome = "blocked"
        if evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
        elif evaluation.current_availability_state == "degraded":
            outcome = "degraded"
        return self._result(
            request,
            outcome=outcome,
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    f"Can't run {command_label} right now.",
                    f"Reason: {evaluation.blocking_reason or evaluation.message}",
                    f"Next: {next_step_map.get(evaluation.reason_code, 'Check readiness and the configured repository root in the operator console.')}",
                )
            ),
            internal_summary=f"{request.capability_id} blocked: {evaluation.reason_code}.",
            retryable=True,
            degraded=outcome == "degraded",
            command_label=command_label,
            activity_state="processing_command",
        )

    def _local_command_error_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        error: ExecutionRunnerError | NodeRoutingError,
        command_summary: str,
        command_label: str,
        confirmation_id: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "missing_command": "Use /run <bounded command>.",
            "command_too_long": "Send a shorter bounded command.",
            "target_too_long": "Send a shorter test target.",
            "blocked_command_pattern": "Remove shell chaining, redirection, and pipeline operators.",
            "multiline_command_not_allowed": "Use a single-line bounded command only.",
            "multiline_target_not_allowed": "Use a single-line test target only.",
            "command_parse_failed": "Use a simpler bounded command format.",
            "command_prefix_not_allowed": "Use /test or an allowed Python-based /run command.",
            "unsupported_python_command": "Use python -m unittest, python -m pytest, or an approved smoke script.",
            "python_script_not_allowed": "Use an approved repo-local validation or smoke script only.",
            "command_option_not_allowed": "Remove option flags in this first-pass execution model.",
            "command_token_not_allowed": "Use module names or repo-relative paths only.",
            "absolute_path_not_allowed": "Use repo-relative paths only.",
            "target_path_not_allowed": "Keep command targets inside the configured repository root.",
            "repo_root_invalid": "Configure a valid repository root in the operator console.",
            "command_not_found": "Use an allowed command prefix or check the local Python environment.",
            "command_execution_failed": "Check the local environment and try again.",
            "node_execution_unavailable": "Use /nodes or /nodeselect local, then resend the command.",
            "node_not_online": "Use /nodes or /nodeselect local, then resend the command.",
            "node_type_unsupported": "Select a supported node with /nodeselect <id>.",
        }
        invalid_request_codes = {
            "missing_command",
            "command_too_long",
            "target_too_long",
            "blocked_command_pattern",
            "multiline_command_not_allowed",
            "multiline_target_not_allowed",
            "command_parse_failed",
            "command_prefix_not_allowed",
            "unsupported_python_command",
            "python_script_not_allowed",
            "command_option_not_allowed",
            "command_token_not_allowed",
        }
        out_of_scope_codes = {"absolute_path_not_allowed", "target_path_not_allowed"}
        unavailable_codes = {"repo_root_invalid"}
        outcome = "failed"
        retryable = True
        if error.code in invalid_request_codes:
            outcome = "invalid_request"
            retryable = False
        elif error.code in out_of_scope_codes:
            outcome = "out_of_scope"
            retryable = False
        elif error.code in unavailable_codes or error.code in {"node_execution_unavailable", "node_not_online", "node_type_unsupported"}:
            outcome = "unavailable"
        title = (
            f"Confirmation {confirmation_id} could not run."
            if confirmation_id
            else ("Action is out of scope." if outcome == "out_of_scope" else f"Can't run {command_label} right now.")
        )
        return self._result(
            request,
            outcome=outcome,
            reason_code=error.code,
            user_message="\n".join(
                (
                    title,
                    f"Reason: {error.message}",
                    f"Next: {next_step_map.get(error.code, 'Check the command, repository scope, and local environment, then try again.')}",
                )
            ),
            internal_summary=f"{request.capability_id} failed: {error.code} ({command_summary or 'missing command'}).",
            retryable=retryable,
            command_label=command_label,
            activity_state="processing_command",
            confirmation_used=bool(confirmation_id),
            telemetry={
                "execution_command_summary": command_summary,
                "execution_summary": f"{command_summary or 'bounded execution'} | {error.code}",
                "execution_output_summary": error.message,
            },
        )

    def _local_command_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        command_result,
    ) -> CapabilityExecutionResult:
        repo_label = self._service._repo_display_name(command_result.request.working_directory)
        node_summary = f"{command_result.node.display_name} ({command_result.node.node_id})"
        base_telemetry = {
            "execution_command": command_result.request.command_text,
            "execution_command_summary": command_result.request.command_summary,
            "execution_scope": command_result.request.working_directory,
            "execution_output_summary": command_result.output_summary,
            "execution_first_issue": command_result.first_issue,
            "target_node_id": command_result.node.node_id,
            "target_node_name": command_result.node.display_name,
            "target_node_type": command_result.node.node_type,
            "target_node_transport": command_result.node.transport,
            "target_node_summary": node_summary,
        }
        if command_result.timed_out:
            self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} timed out via bounded execution."
            lines = [
                f"Confirmation {confirmation.confirmation_id} approved.",
                f"Node: {node_summary}",
                f"Scope: {repo_label}",
                f"Command: {command_result.request.command_summary}",
                "Exit: timeout",
                f"Summary: {command_result.output_summary}",
            ]
            if command_result.first_issue:
                lines.append(f"First issue: {command_result.first_issue}")
            return self._result(
                request,
                outcome="timed_out",
                reason_code="command_timeout",
                user_message="\n".join(lines),
                internal_summary=self._service._last_confirmation_result,
                retryable=True,
                command_label="/confirm",
                activity_state="timed_out",
                confirmation_used=True,
                telemetry={**base_telemetry, "execution_summary": f"{command_result.request.command_summary} | timeout", "execution_exit_code": -1},
            )
        outcome = "success" if command_result.exit_code == 0 else "failed"
        reason_code = "ok" if command_result.exit_code == 0 else "command_exit_nonzero"
        status_label = "completed" if outcome == "success" else "failed"
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and {status_label} via bounded execution."
        lines = [
            f"Confirmation {confirmation.confirmation_id} approved.",
            f"Node: {node_summary}",
            f"Scope: {repo_label}",
            f"Command: {command_result.request.command_summary}",
            f"Exit code: {command_result.exit_code}",
            f"Summary: {command_result.output_summary}",
        ]
        if command_result.first_issue:
            lines.append(f"First issue: {command_result.first_issue}")
        return self._result(
            request,
            outcome=outcome,
            reason_code=reason_code,
            user_message="\n".join(lines),
            internal_summary=self._service._last_confirmation_result,
            retryable=outcome != "success",
            command_label="/confirm",
            activity_state="processing_command" if outcome == "success" else "provider_failed",
            confirmation_used=True,
            telemetry={**base_telemetry, "execution_summary": f"{command_result.request.command_summary} | exit {command_result.exit_code}", "execution_exit_code": command_result.exit_code},
        )

    def _web_error_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        error: WebFetchError,
        display_url: str,
        confirmation_id: str = "",
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "missing_url": "Use /web <https://allowed-domain/path>.",
            "malformed_url": "Use /web <https://allowed-domain/path>.",
            "unsupported_url_scheme": "Use /web <https://allowed-domain/path>.",
            "web_scope_missing": "Configure at least one allowed web domain in the controller config.",
            "target_domain_not_allowed": "Use a URL from the configured allowlisted domains only.",
            "redirect_target_not_allowed": "Use a URL that stays within the configured allowlisted domains.",
            "unsupported_content_type": "Request supported text, HTML, or JSON content only.",
            "web_fetch_timeout": "Try /web again in a moment.",
            "web_fetch_failed": "Check network access for the allowlisted domain, then try again.",
            "redirect_limit_exceeded": "Use a URL that resolves directly or stays within a short redirect chain.",
        }
        outcome = "failed"
        retryable = True
        if error.code in {"missing_url", "malformed_url", "unsupported_url_scheme"}:
            outcome = "invalid_request"
            retryable = False
        elif error.code in {"target_domain_not_allowed", "redirect_target_not_allowed"}:
            outcome = "out_of_scope"
            retryable = False
        elif error.code == "web_scope_missing":
            outcome = "unavailable"
        elif error.code == "web_fetch_timeout":
            outcome = "timed_out"
        return self._result(
            request,
            outcome=outcome,
            reason_code=error.code,
            user_message="\n".join(
                (
                    "Can't run /web right now." if outcome not in {"out_of_scope", "timed_out", "invalid_request"} else (
                        "Action is out of scope." if outcome == "out_of_scope" else (
                            "Web request timed out." if outcome == "timed_out" else "Couldn't parse that web command."
                        )
                    ),
                    f"Reason: {error.message}",
                    f"Next: {next_step_map.get(error.code, 'Check the URL and web-scope configuration, then try again.')}",
                )
            ),
            internal_summary=f"web.fetch.read failed: {error.code} ({display_url or 'missing url'}).",
            retryable=retryable,
            command_label="/web" if not confirmation_id else "/confirm",
            activity_state="provider_failed" if outcome in {"failed", "timed_out"} else "processing_command",
            confirmation_used=bool(confirmation_id),
            telemetry={
                "web_domain": request.scope.target_domain,
                "web_content_type": "",
                "web_status": error.message,
                "web_summary": f"{request.scope.target_domain or 'web'} | {error.code}",
            },
        )

    def _web_blocked_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        confirmation_id: str = "",
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "policy_always_offline": "Switch out of Always Offline before retrying the web fetch.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "web_scope_invalid": "Configure at least one allowed web domain in the controller config.",
            "online_confirmation_required": "Approve the pending remote request with /confirm <id> after /web returns a confirmation prompt.",
        }
        outcome = "blocked"
        retryable = True
        if evaluation.current_availability_state == "unavailable":
            outcome = "unavailable"
        elif evaluation.current_availability_state == "degraded":
            outcome = "degraded"
        return self._result(
            request,
            outcome=outcome,
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    "Can't run /web right now.",
                    f"Reason: {evaluation.blocking_reason or evaluation.message}",
                    f"Next: {next_step_map.get(evaluation.reason_code, 'Check the operator console configuration and try again.')}",
                )
            ),
            internal_summary=f"web.fetch.read blocked: {evaluation.reason_code}.",
            retryable=retryable,
            degraded=outcome == "degraded",
            command_label="/web" if not confirmation_id else "/confirm",
            activity_state="processing_command",
            confirmation_used=bool(confirmation_id),
        )

    def _web_confirmation_required_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        context: CapabilityContext,
        snapshot: ControllerSnapshot,
        normalized_url: str,
        display_url: str,
        chat_id: str,
        requester_label: str,
    ) -> CapabilityExecutionResult:
        confirmation = self._service._confirmation_store.create(
            capability_id=evaluation.capability_id,
            original_command=request.original_command,
            argument_summary=f"/web {display_url}",
            prompt_text=normalized_url,
            response_style="concise",
            chat_id=chat_id,
            requester_label=requester_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
        )
        expires_in = self._service._confirmation_seconds_remaining(confirmation)
        self._service._last_confirmation_requested = f"{confirmation.confirmation_id} pending for {evaluation.capability_id} (/web)."
        self._service._last_confirmation_result = f"{confirmation.confirmation_id} pending approval."
        self._service._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=f"Confirmation {confirmation.confirmation_id} created for {evaluation.capability_id}.",
            activity=True,
            last_command=request.original_command,
        )
        return self._result(
            request,
            outcome="confirmation_required",
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    "Action requires confirmation.",
                    f"Action: /web {display_url}",
                    f"Capability: {evaluation.capability_id}",
                    f"Reason: {self._service._confirmation_reason_message(evaluation.reason_code)}",
                    f"ID: {confirmation.confirmation_id} (expires in about {expires_in}s)",
                    f"Reply with: /confirm {confirmation.confirmation_id} or /deny {confirmation.confirmation_id}",
                )
            ),
            internal_summary=f"Confirmation {confirmation.confirmation_id} created for {evaluation.capability_id}.",
            retryable=False,
            command_label="/web",
            activity_state="processing_command",
            confirmation_used=False,
            telemetry={
                "confirmation_id": confirmation.confirmation_id,
                "web_domain": request.scope.target_domain,
                "web_summary": f"{request.scope.target_domain or 'web'} | confirmation pending",
            },
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
        context_entry: BufferedContext | None = None,
        context_entries: tuple[BufferedContext, ...] = (),
    ) -> CapabilityExecutionResult:
        prompt = " ".join(prompt.split())
        argument_summary = f"{command_label} [prompt hidden]"
        confirmation_action_label = f"{command_label} (prompt hidden)"
        selected_contexts = context_entries or ((context_entry,) if context_entry is not None else ())
        metadata: dict[str, object] = {
            "argument_summary": argument_summary,
            "response_style": response_style,
        }
        if len(selected_contexts) == 1:
            context_entry = selected_contexts[0]
            argument_summary = f"{command_label} {context_entry.context_id} [prompt hidden]"
            confirmation_action_label = f"{command_label} {context_entry.context_id} (prompt hidden)"
            metadata.update(
                {
                    "argument_summary": argument_summary,
                    "context_id": context_entry.context_id,
                    "context_source_summary": context_entry.source_summary,
                    "confirmation_action_label": confirmation_action_label,
                }
            )
        elif selected_contexts:
            context_ids = ",".join(context.context_id for context in selected_contexts)
            context_sources = " | ".join(context.source_summary for context in selected_contexts)
            argument_summary = f"{command_label} {context_ids} [prompt hidden]"
            confirmation_action_label = f"{command_label} {len(selected_contexts)} contexts (prompt hidden)"
            metadata.update(
                {
                    "argument_summary": argument_summary,
                    "context_ids": context_ids,
                    "context_source_summary": context_sources,
                    "confirmation_action_label": confirmation_action_label,
                }
            )
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"prompt": prompt, "response_style": response_style},
            metadata=metadata,
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
            metadata=metadata,
        )
        provider_prompt = prompt
        context_trimmed = False
        if len(selected_contexts) > 1:
            provider_prompt, context_trimmed = self._service._build_multi_contextual_prompt(prompt=prompt, contexts=selected_contexts)
        elif len(selected_contexts) == 1:
            context_entry = selected_contexts[0]
            provider_prompt, context_trimmed = self._service._build_contextual_prompt(prompt=prompt, context=context_entry)

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
                context_entry=context_entry,
                context_entries=selected_contexts,
            )
        if evaluation.current_availability_state != "allowed":
            return self._result_from_capability_block(
                request=request,
                evaluation=evaluation,
                command_label=command_label,
            )
        scope_failure = self._scope_failure_result(request, command_label=command_label)
        if scope_failure is not None:
            return scope_failure

        execution_mode = snapshot.mode
        if snapshot.selected_mode == "online" and snapshot.mode != "online":
            execution_mode = "online"
        if execution_mode == "offline":
            return self._run_offline_provider_query(
                request=request,
                context=context,
                chat_id=update.chat_id,
                prompt=provider_prompt,
                response_style=response_style,
                command_label=command_label,
                context_entry=context_entry,
                context_entries=selected_contexts,
                context_trimmed=context_trimmed,
            )
        return self._run_online_provider_query(
            request=request,
            context=context,
            chat_id=update.chat_id,
            prompt=provider_prompt,
            response_style=response_style,
            command_label=command_label,
            confirmation_used=False,
            context_entry=context_entry,
            context_entries=selected_contexts,
            context_trimmed=context_trimmed,
        )

    def _execute_confirm(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        confirmation_id = self._service._normalize_confirmation_id(argument)
        confirmation_lookup = self._service._confirmation_store.get(confirmation_id) if confirmation_id else None
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/confirm",
            parsed_arguments={"confirmation_id": confirmation_id},
            metadata=self._confirmation_command_metadata(
                command_label="/confirm",
                confirmation_id=confirmation_id,
                confirmation=confirmation_lookup,
            ),
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

        lookup_outcome, confirmation = self._service._confirmation_store.inspect(confirmation_id, chat_id=update.chat_id)
        if lookup_outcome != "pending" or confirmation is None:
            outcome = "already_used" if lookup_outcome in {"approved", "rejected"} else lookup_outcome
            if lookup_outcome == "expired":
                self._service._workflow_executor.mark_confirmation_resolution(confirmation=confirmation, outcome=lookup_outcome)
            return self._confirmation_state_result(
                request=request,
                command_label="/confirm",
                confirmation_id=confirmation_id,
                outcome=outcome,
                confirmation=confirmation,
            )

        if confirmation.metadata.get("workflow_id", "").strip():
            workflow_result = self._service._workflow_executor.resume_confirmation(
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=update.chat_id,
            )
            if workflow_result is not None:
                return workflow_result

        outcome, confirmation = self._service._confirmation_store.approve(confirmation_id, chat_id=update.chat_id)
        if outcome != "approved" or confirmation is None:
            if outcome == "expired":
                self._service._workflow_executor.mark_confirmation_resolution(confirmation=confirmation, outcome=outcome)
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
                **self._confirmation_command_metadata(
                    command_label="/confirm",
                    confirmation_id=confirmation.confirmation_id,
                    confirmation=confirmation,
                ),
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
        confirmation_lookup = self._service._confirmation_store.get(confirmation_id) if confirmation_id else None
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/deny",
            parsed_arguments={"confirmation_id": confirmation_id},
            metadata=self._confirmation_command_metadata(
                command_label="/deny",
                confirmation_id=confirmation_id,
                confirmation=confirmation_lookup,
            ),
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
        if outcome in {"rejected", "expired"}:
            self._service._workflow_executor.mark_confirmation_resolution(confirmation=confirmation, outcome=outcome)
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
        if confirmation.capability_id == "ask.provider_query":
            return self._execute_confirmed_provider_query(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "web.fetch.read":
            return self._execute_confirmed_web_fetch(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "file.create.write":
            return self._execute_confirmed_file_create(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "file.patch.write":
            return self._execute_confirmed_file_patch(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "file.write.replace":
            return self._execute_confirmed_file_replace(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "shell.command.run":
            return self._execute_confirmed_run_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "test.command.run":
            return self._execute_confirmed_test_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
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

    def _execute_confirmed_file_patch(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        try:
            parsed = parse_patch_command(confirmation.prompt_text)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        mutation_request, scope_failure, relative_path = self._prepare_confirmed_file_mutation_request(
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
            relative_path=parsed.relative_path,
        )
        if isinstance(mutation_request, CapabilityExecutionResult):
            return mutation_request
        if scope_failure is not None:
            return scope_failure
        try:
            result = self._service._file_mutator.apply_patch(
                FilePatchMutationRequest(
                    target_path=mutation_request.scope.target_path,
                    display_path=relative_path,
                    operator_reason=parsed.operator_reason,
                    expected_base_hash=parsed.expected_base_hash,
                    operations=parsed.operations,
                )
            )
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=mutation_request,
                error=exc,
                relative_path=relative_path,
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._file_mutation_success_result(
            request=mutation_request,
            confirmation=confirmation,
            mutation=result,
        )

    def _execute_confirmed_file_create(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        try:
            parsed = parse_create_command(confirmation.prompt_text)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        mutation_request, scope_failure, relative_path, missing_directories = self._prepare_confirmed_file_create_request(
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
            relative_path=parsed.relative_path,
        )
        if isinstance(mutation_request, CapabilityExecutionResult):
            return mutation_request
        if scope_failure is not None:
            return scope_failure
        try:
            result = self._service._file_mutator.create_file(
                FileCreateWriteRequest(
                    target_path=mutation_request.scope.target_path,
                    display_path=relative_path,
                    operator_reason=parsed.operator_reason,
                    new_content=parsed.new_content,
                    allowed_parent_creations=missing_directories,
                )
            )
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=mutation_request,
                error=exc,
                relative_path=relative_path,
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._file_mutation_success_result(
            request=mutation_request,
            confirmation=confirmation,
            mutation=result,
        )

    def _execute_confirmed_file_replace(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        try:
            parsed = parse_write_command(confirmation.prompt_text)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path="",
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        mutation_request, scope_failure, relative_path = self._prepare_confirmed_file_mutation_request(
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
            relative_path=parsed.relative_path,
        )
        if isinstance(mutation_request, CapabilityExecutionResult):
            return mutation_request
        if scope_failure is not None:
            return scope_failure
        try:
            result = self._service._file_mutator.replace_file(
                FileWriteReplaceRequest(
                    target_path=mutation_request.scope.target_path,
                    display_path=relative_path,
                    operator_reason=parsed.operator_reason,
                    expected_base_hash=parsed.expected_base_hash,
                    new_content=parsed.new_content,
                )
            )
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=mutation_request,
                error=exc,
                relative_path=relative_path,
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._file_mutation_success_result(
            request=mutation_request,
            confirmation=confirmation,
            mutation=result,
        )

    def _prepare_confirmed_file_mutation_request(
        self,
        *,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
        relative_path: str,
    ) -> tuple[CapabilityExecutionRequest | CapabilityExecutionResult, CapabilityExecutionResult | None, str]:
        evaluation, context = self._service._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        relative_path, target_path, allowed_roots, resolve_code, resolve_message = self._service.resolve_file_request(relative_path)
        scope = ExecutionScope(
            scope_type="filesystem",
            access_mode="write",
            allowed_paths=allowed_roots,
            target_path=target_path,
        )
        mutation_request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=confirmation.requester_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "relative_path": relative_path,
            },
            context=context,
            confirmation_context=confirmation.evaluation_context,
            metadata=self._confirmation_command_metadata(
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
                confirmation=confirmation,
            ),
            scope_override=scope,
        )
        if evaluation.current_availability_state != "allowed":
            return (
                self._blocked_confirmation_from_evaluation(
                    request=mutation_request,
                    confirmation_id=confirmation.confirmation_id,
                    evaluation=evaluation,
                ),
                None,
                relative_path,
            )
        if resolve_code != "file_target_ready":
            return (
                self._file_mutation_error_result(
                    request=mutation_request,
                    error=FileMutatorError(resolve_code, resolve_message),
                    relative_path=relative_path,
                    command_label="/confirm",
                    confirmation_id=confirmation.confirmation_id,
                ),
                None,
                relative_path,
            )
        return mutation_request, self._scope_failure_result(mutation_request, command_label="/confirm", confirmation_used=True), relative_path

    def _prepare_confirmed_file_create_request(
        self,
        *,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
        relative_path: str,
    ) -> tuple[CapabilityExecutionRequest | CapabilityExecutionResult, CapabilityExecutionResult | None, str, tuple[str, ...]]:
        evaluation, context = self._service._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        relative_path, target_path, allowed_roots, missing_directories, resolve_code, resolve_message = self._service.resolve_file_creation_request(relative_path)
        scope = ExecutionScope(
            scope_type="filesystem",
            access_mode="write",
            allowed_paths=allowed_roots,
            target_path=target_path,
        )
        mutation_request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=confirmation.requester_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "relative_path": relative_path,
            },
            context=context,
            confirmation_context=confirmation.evaluation_context,
            metadata=self._confirmation_command_metadata(
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
                confirmation=confirmation,
            ),
            scope_override=scope,
        )
        if evaluation.current_availability_state != "allowed":
            return (
                self._blocked_confirmation_from_evaluation(
                    request=mutation_request,
                    confirmation_id=confirmation.confirmation_id,
                    evaluation=evaluation,
                ),
                None,
                relative_path,
                missing_directories,
            )
        if resolve_code != "file_create_ready":
            return (
                self._file_mutation_error_result(
                    request=mutation_request,
                    error=FileMutatorError(resolve_code, resolve_message),
                    relative_path=relative_path,
                    command_label="/confirm",
                    confirmation_id=confirmation.confirmation_id,
                ),
                None,
                relative_path,
                missing_directories,
            )
        return (
            mutation_request,
            self._scope_failure_result(mutation_request, command_label="/confirm", confirmation_used=True),
            relative_path,
            missing_directories,
        )

    def _execute_confirmed_run_command(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        repo_root, _, _, _ = self._service._repo_configuration_state()
        try:
            local_request = self._service._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=repo_root,
                command_text=confirmation.prompt_text,
                expected_scope=self._service._repo_display_name(repo_root),
            )
        except ExecutionRunnerError as exc:
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary=str(confirmation.metadata.get("execution_command_summary") or "").strip(),
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._execute_confirmed_local_command(
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
            local_request=local_request,
        )

    def _execute_confirmed_test_command(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        repo_root, _, _, _ = self._service._repo_configuration_state()
        try:
            local_request = self._service._execution_runner.build_test_request(
                capability_id="test.command.run",
                repo_root=repo_root,
                target=confirmation.prompt_text,
                expected_scope=self._service._repo_display_name(repo_root),
            )
        except ExecutionRunnerError as exc:
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary=str(confirmation.metadata.get("execution_command_summary") or "").strip(),
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._execute_confirmed_local_command(
            confirmation=confirmation,
            snapshot=snapshot,
            chat_id=chat_id,
            local_request=local_request,
        )

    def _execute_confirmed_local_command(
        self,
        *,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
        local_request: LocalCommandExecutionRequest,
    ) -> CapabilityExecutionResult:
        evaluation, context = self._service._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        scope = ExecutionScope(
            scope_type="repository",
            access_mode="execute",
            repo_root=local_request.working_directory,
            target_path=local_request.working_directory,
        )
        request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=confirmation.requester_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "command": local_request.command_summary,
            },
            context=context,
            confirmation_context=confirmation.evaluation_context,
            metadata=self._confirmation_command_metadata(
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
                confirmation=confirmation,
            ),
            scope_override=scope,
        )
        if evaluation.current_availability_state != "allowed":
            return self._blocked_confirmation_from_evaluation(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                evaluation=evaluation,
            )
        scope_failure = self._scope_failure_result(request, command_label="/confirm", confirmation_used=True)
        if scope_failure is not None:
            return scope_failure
        target_node_id = str(confirmation.metadata.get("target_node_id") or "").strip().lower()
        target_node = self._service.get_registered_node(target_node_id) if target_node_id else None
        if target_node is None:
            target_node = self._service.resolve_execution_node().node
        try:
            command_result = self._service._node_router.execute(node=target_node, request=local_request)
        except (ExecutionRunnerError, NodeRoutingError) as exc:
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary=local_request.command_summary,
                command_label="/confirm",
                confirmation_id=confirmation.confirmation_id,
            )
        return self._local_command_result(
            request=request,
            confirmation=confirmation,
            command_result=command_result,
        )

    def _file_mutation_success_result(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        mutation,
    ) -> CapabilityExecutionResult:
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and completed via file mutation."
        lines = [
            f"Confirmation {confirmation.confirmation_id} approved.",
            f"Created: {mutation.display_path}" if mutation.operation_kind == "create" else f"File: {mutation.display_path}",
            f"Operation: {mutation.operation_kind}",
        ]
        if mutation.operation_kind == "create":
            if mutation.created_directories:
                lines.append(f"Directories created: {', '.join(mutation.created_directories)}")
            lines.append(f"Lines: {mutation.changed_lines}")
        else:
            lines.extend(
                (
                    f"Changed lines: {mutation.changed_lines}",
                    f"Changes: {mutation.change_count}",
                    f"Base: {mutation.base_hash_before[:12]} -> {mutation.base_hash_after[:12]}",
                )
            )
        if mutation.operator_reason:
            lines.append(f"Reason: {mutation.operator_reason}")
        if mutation.operation_kind == "create":
            lines.append(f"Next: Use /run python {mutation.display_path}")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(lines),
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "display_path": mutation.display_path,
                "file_name": mutation.file_name,
                "file_status": mutation.status_label,
                "file_size_bytes": mutation.size_bytes_after,
                "file_size_label": mutation.size_label_after,
                "file_size_category": "mutated",
                "file_read_at": mutation.applied_at,
                "file_summary": mutation.audit_summary,
                "mutation_operation": mutation.operation_kind,
                "mutation_changed_lines": mutation.changed_lines,
                "mutation_change_count": mutation.change_count,
                "mutation_base_before": mutation.base_hash_before,
                "mutation_base_after": mutation.base_hash_after,
                "mutation_created_directories": ",".join(mutation.created_directories),
            },
        )

    @staticmethod
    def _file_operation_label(capability_id: str) -> str:
        if capability_id == "file.create.write":
            return "create"
        if capability_id == "file.patch.write":
            return "patch"
        return "replace"

    @staticmethod
    def _confirmation_command_metadata(
        *,
        command_label: str,
        confirmation_id: str,
        confirmation: PendingConfirmation | None,
    ) -> dict[str, object]:
        argument_summary = f"{command_label} {confirmation_id}" if confirmation_id else f"{command_label} <missing>"
        if confirmation is not None:
            mutation_summary = confirmation.metadata.get("mutation_action_summary", "").strip()
            execution_summary = confirmation.metadata.get("execution_action_summary", "").strip()
            if mutation_summary:
                argument_summary = f"{argument_summary} | {mutation_summary}"
            elif execution_summary:
                argument_summary = f"{argument_summary} | {execution_summary}"
        return {"argument_summary": argument_summary}

    def _execute_confirmed_provider_query(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
        context_entry: BufferedContext | None = None,
        context_entries: tuple[BufferedContext, ...] = (),
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

        context_trimmed = False
        provider_prompt = confirmation.prompt_text
        selected_contexts = context_entries or ((context_entry,) if context_entry is not None else ())
        context_id = confirmation.metadata.get("context_id", "").strip()
        context_ids = confirmation.metadata.get("context_ids", "").strip()
        context_source_summary = confirmation.metadata.get("context_source_summary", "").strip()
        if not selected_contexts and context_ids:
            resolved_contexts: list[BufferedContext] = []
            missing_context_id = ""
            for reference in [value.strip() for value in context_ids.split(",") if value.strip()]:
                resolved = self._service.resolve_context_for_chat(chat_id=chat_id, reference=reference)
                if resolved is None:
                    missing_context_id = reference
                    break
                resolved_contexts.append(resolved)
            if missing_context_id:
                return self._confirmation_result(
                    request=request,
                    confirmation_id=confirmation.confirmation_id,
                    outcome="invalid_request",
                    reason_code="context_not_found",
                    reason=f"Context {missing_context_id} is no longer available.",
                    next_step="Run /contexts, then resend the original ask with available contexts.",
                    retryable=True,
                )
            selected_contexts = tuple(resolved_contexts)
        if not selected_contexts and context_id:
            resolved_context = self._service.resolve_context_for_chat(chat_id=chat_id, reference=context_id)
            if resolved_context is None:
                return self._confirmation_result(
                    request=request,
                    confirmation_id=confirmation.confirmation_id,
                    outcome="invalid_request",
                    reason_code="context_not_found",
                    reason=f"Context {context_id} is no longer available.",
                    next_step="Run /contexts, then resend /asklast or /askctx with an available context.",
                    retryable=True,
                )
            selected_contexts = (resolved_context,)
        if len(selected_contexts) > 1:
            provider_prompt, context_trimmed = self._service._build_multi_contextual_prompt(
                prompt=confirmation.prompt_text,
                contexts=selected_contexts,
            )
            context_source_summary = " | ".join(context.source_summary for context in selected_contexts)
        elif len(selected_contexts) == 1:
            context_entry = selected_contexts[0]
            provider_prompt, context_trimmed = self._service._build_contextual_prompt(
                prompt=confirmation.prompt_text,
                context=context_entry,
            )
            context_source_summary = context_entry.source_summary

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
                "argument_summary": confirmation.argument_summary or f"/confirm {confirmation.confirmation_id}",
                "response_style": confirmation.response_style,
                "context_id": selected_contexts[0].context_id if len(selected_contexts) == 1 else context_id,
                "context_ids": ",".join(context.context_id for context in selected_contexts),
                "context_source_summary": context_source_summary,
            },
        )
        if evaluation.current_availability_state != "allowed":
            return self._blocked_confirmation_from_evaluation(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                evaluation=evaluation,
            )
        scope_failure = self._scope_failure_result(request, command_label="/confirm", confirmation_used=True)
        if scope_failure is not None:
            return scope_failure

        use_online_provider = confirmation.evaluation_context.selected_mode == "online" or snapshot.mode == "online"
        if use_online_provider:
            return self._run_online_provider_query(
                request=request,
                context=context,
                chat_id=chat_id,
                prompt=provider_prompt,
                response_style=confirmation.response_style,
                command_label="/confirm",
                confirmation_used=True,
                confirmation_id=confirmation.confirmation_id,
                context_entry=context_entry,
                context_entries=selected_contexts,
                context_trimmed=context_trimmed,
            )
        return self._run_offline_provider_query(
            request=request,
            context=context,
            chat_id=chat_id,
            prompt=provider_prompt,
            response_style=confirmation.response_style,
            command_label="/confirm",
            confirmation_used=True,
            confirmation_id=confirmation.confirmation_id,
            context_entry=context_entry,
            context_entries=selected_contexts,
            context_trimmed=context_trimmed,
        )

    def _execute_confirmed_web_fetch(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        evaluation, context = self._service._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        display_url, normalized_url, allowed_domains, target_domain, resolve_code, resolve_message = self._service.resolve_web_request(confirmation.prompt_text)
        scope = ExecutionScope(
            scope_type="network",
            access_mode="read",
            target_domain=target_domain,
            domain_allowlist=allowed_domains,
        )
        request = self._build_request(
            capability_id=evaluation.capability_id,
            snapshot=snapshot,
            chat_id=chat_id,
            requester_label=confirmation.requester_label,
            original_command="/confirm",
            parsed_arguments={
                "confirmation_id": confirmation.confirmation_id,
                "url": display_url,
            },
            context=context,
            confirmation_context=confirmation.evaluation_context,
            metadata={
                "argument_summary": f"/confirm {confirmation.confirmation_id}",
                "response_style": confirmation.response_style,
            },
            scope_override=scope,
        )
        if evaluation.current_availability_state != "allowed":
            return self._blocked_confirmation_from_evaluation(
                request=request,
                confirmation_id=confirmation.confirmation_id,
                evaluation=evaluation,
            )
        scope_failure = self._scope_failure_result(request, command_label="/confirm", confirmation_used=True)
        if scope_failure is not None:
            return scope_failure
        if resolve_code != "web_target_ready":
            return self._web_error_result(
                request=request,
                error=WebFetchError(resolve_code, resolve_message),
                display_url=display_url,
                confirmation_id=confirmation.confirmation_id,
            )
        try:
            preview = self._service.fetch_web_preview(normalized_url)
        except WebFetchError as exc:
            return self._web_error_result(
                request=request,
                error=exc,
                display_url=display_url,
                confirmation_id=confirmation.confirmation_id,
            )
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and completed via web fetch."
        base_reply = "\n".join(
            (
                f"Confirmation {confirmation.confirmation_id} approved.",
                self._service._build_web_reply(preview).reply,
            )
        )
        context_entry = self._service.create_context_buffer(
            source_capability_id="web.fetch.read",
            source_command="/web",
            scope_type=request.scope.scope_type,
            source_summary=preview.domain,
            content_kind="web_preview",
            normalized_content=self._service._build_web_reply(preview).reply,
            content_preview=preview.audit_summary,
            size_class=preview.size_category,
            chat_id=chat_id,
            user_id=chat_id,
            request_id=request.request_id,
        )
        reply = "\n".join((base_reply, self._service._context_ready_note(context_entry)))
        status = "Large web preview truncated." if preview.oversized else ("Web preview truncated." if preview.truncated else "Web preview ready.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "web_domain": preview.domain,
                "web_display_url": preview.display_url,
                "web_content_type": preview.content_type,
                "web_status": status,
                "web_truncated": preview.truncated,
                "web_size_bytes": preview.size_bytes,
                "web_size_label": preview.size_label,
                "web_size_category": preview.size_category,
                "web_fetched_at": preview.fetched_at,
                "web_summary": preview.audit_summary,
                "context_created_id": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
            },
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
        context_entry: BufferedContext | None = None,
        context_entries: tuple[BufferedContext, ...] = (),
        context_trimmed: bool = False,
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
        selected_contexts = context_entries or ((context_entry,) if context_entry is not None else ())
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
                context_trimmed=context_trimmed,
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
            telemetry={
                "provider_model": model,
                "context_used_id": selected_contexts[0].context_id if len(selected_contexts) == 1 else "",
                "context_used_ids": ",".join(context.context_id for context in selected_contexts),
                "context_source_summary": " | ".join(context.source_summary for context in selected_contexts),
                "context_trimmed": context_trimmed,
            },
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
        context_entry: BufferedContext | None = None,
        context_entries: tuple[BufferedContext, ...] = (),
        context_trimmed: bool = False,
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
        selected_contexts = context_entries or ((context_entry,) if context_entry is not None else ())
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
                context_trimmed=context_trimmed,
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
            telemetry={
                "provider_model": model,
                "context_used_id": selected_contexts[0].context_id if len(selected_contexts) == 1 else "",
                "context_used_ids": ",".join(context.context_id for context in selected_contexts),
                "context_source_summary": " | ".join(context.source_summary for context in selected_contexts),
                "context_trimmed": context_trimmed,
            },
        )

    def _result_from_capability_block(
        self,
        *,
        request: CapabilityExecutionRequest,
        evaluation: CapabilityEvaluation,
        command_label: str,
    ) -> CapabilityExecutionResult:
        next_step_map = {
            "runtime_not_active": "Use /startruntime, then try again.",
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
        title = self._ask_command_title(command_label)
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
        context_entry: BufferedContext | None = None,
        context_entries: tuple[BufferedContext, ...] = (),
    ) -> CapabilityExecutionResult:
        action_label = str(request.metadata.get("confirmation_action_label") or f"{request.original_command} (prompt hidden)")
        confirmation_metadata: dict[str, str] = {}
        extra_confirmation_metadata = request.metadata.get("confirmation_metadata")
        selected_contexts = context_entries or ((context_entry,) if context_entry is not None else ())
        if len(selected_contexts) == 1:
            context_entry = selected_contexts[0]
            confirmation_metadata = {
                "context_id": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
            }
        elif selected_contexts:
            confirmation_metadata = {
                "context_ids": ",".join(context.context_id for context in selected_contexts),
                "context_source_summary": " | ".join(context.source_summary for context in selected_contexts),
            }
        if isinstance(extra_confirmation_metadata, dict):
            confirmation_metadata.update(
                {
                    str(key): str(value)
                    for key, value in extra_confirmation_metadata.items()
                    if str(key).strip() and str(value).strip()
                }
            )
        confirmation = self._service._confirmation_store.create(
            capability_id=evaluation.capability_id,
            original_command=request.original_command,
            argument_summary=str(request.metadata.get("argument_summary") or f"{request.original_command} [prompt hidden]"),
            prompt_text=prompt,
            response_style=response_style,
            chat_id=chat_id,
            requester_label=requester_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
            metadata=confirmation_metadata,
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
        preview_lines = request.metadata.get("confirmation_preview_lines")
        preview_tuple = tuple(str(item) for item in preview_lines) if isinstance(preview_lines, (list, tuple)) else ()
        return self._result(
            request,
            outcome="confirmation_required",
            reason_code=evaluation.reason_code,
            user_message="\n".join(
                (
                    "Action requires confirmation.",
                    f"Action: {action_label}",
                    f"Capability: {evaluation.capability_id}",
                    f"Reason: {self._service._confirmation_reason_message(evaluation.reason_code)}",
                    *preview_tuple,
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
            telemetry={
                "confirmation_id": confirmation.confirmation_id,
                "context_used_id": selected_contexts[0].context_id if len(selected_contexts) == 1 else "",
                "context_used_ids": ",".join(context.context_id for context in selected_contexts),
                "context_source_summary": " | ".join(context.source_summary for context in selected_contexts),
            },
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
            "runtime_not_active": "Use /startruntime, then resend the original command.",
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
            title = self._ask_command_title(command_label)
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
        context_trimmed: bool = False,
    ) -> str:
        formatted = self._service._format_ask_success(
            reply_text,
            provider_label=self._service._provider_label(provider_key, provider_model),  # type: ignore[arg-type]
            mode_label=mode_label,
            response_style=response_style,
        )
        if context_trimmed:
            formatted = "\n".join(("Context note: prior result was trimmed to fit safe prompt limits.", formatted))
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
    ) -> tuple[CapabilityExecutionRequest, CapabilityEvaluation, CapabilityContext, CapabilityExecutionResult | None]:
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
        return request, evaluation, context, self._scope_failure_result(request, command_label=original_command)

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
        scope_override: ExecutionScope | None = None,
    ) -> CapabilityExecutionRequest:
        provider_snapshot = self._provider_snapshot(snapshot, context=context)
        scope = scope_override or self._service._build_execution_scope(
            capability_id,
            snapshot=snapshot,
        )
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
            scope=scope,
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
        manifest = self._service._capability_manifest(request.capability_id)
        trust_summary = self._service._format_manifest_trust_summary(manifest)
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
            access_kind=manifest.access_kind,
            locality=manifest.locality,
            offline_safety=manifest.offline_safety,
            confirmation_sensitivity=manifest.confirmation_sensitivity,
            telegram_exposure=manifest.telegram_exposure,
            trust_summary=trust_summary,
            scope_summary=self._service._format_scope_summary(request.scope),
            command_label=command_label,
            activity_state=activity_state,
            ask_status=ask_status,
            hide_content_in_summary=hide_content_in_summary,
            telemetry=dict(telemetry or {}),
        )

    def _scope_failure_result(
        self,
        request: CapabilityExecutionRequest,
        *,
        command_label: str,
        confirmation_used: bool = False,
    ) -> CapabilityExecutionResult | None:
        validation = self._service.validate_request_scope(request)
        if validation.allowed:
            return None
        title = "Action is out of scope." if command_label in {"/confirm", "/deny"} else f"Can't run {command_label} right now."
        return self._result(
            request,
            outcome="out_of_scope",
            reason_code=validation.reason_code,
            user_message="\n".join(
                (
                    title,
                    f"Reason: {validation.message}",
                    "Next: Use an allowed scope for this capability or adjust the operator-console configuration.",
                )
            ),
            internal_summary=f"{command_label} rejected by scope validation ({validation.reason_code}).",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
            ask_status=f"{command_label} blocked by scope validation." if command_label in {"/ask", "/askd", "/confirm"} else "",
            hide_content_in_summary=command_label in {"/ask", "/askd", "/confirm"},
            confirmation_used=confirmation_used,
        )

    @staticmethod
    def _parse_audit_limit(argument: str) -> int | None:
        value = argument.strip()
        if not value:
            return 5
        if not value.isdigit():
            return None
        limit = int(value)
        if limit < 1 or limit > 8:
            return None
        return limit

    @staticmethod
    def _parse_context_prompt_argument(argument: str) -> tuple[str, str]:
        value = " ".join(argument.split())
        if not value:
            return "", ""
        parts = value.split(" ", 1)
        if len(parts) == 1:
            return parts[0], ""
        return parts[0], parts[1].strip()

    def _progress_ask_status(self, command_label: str, confirmation_id: str) -> str:
        if confirmation_id:
            return f"Confirmation {confirmation_id} in progress."
        return f"{command_label} in progress."

    def _completed_ask_status(self, command_label: str, provider_name: str, model: str, confirmation_id: str) -> str:
        if confirmation_id:
            return f"Confirmation {confirmation_id} completed via {provider_name} / {model}."
        return f"{command_label} completed via {provider_name} / {model}."

    @staticmethod
    def _ask_command_title(command_label: str) -> str:
        return f"Can't run {command_label} right now."

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
