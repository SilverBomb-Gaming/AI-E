"""Unified execution contract and executor for capability-driven command handling."""
from __future__ import annotations

from datetime import datetime
import json
from pathlib import Path
import secrets
from typing import TYPE_CHECKING, Protocol

from ..providers.base import ProviderReply
from .capability_models import CapabilityContext, CapabilityEvaluation
from .command_grammar import (
    parse_data_label_arguments,
    parse_chain_create_arguments,
    parse_data_limit,
    parse_data_search_arguments,
    parse_data_tag_arguments,
    parse_data_unlabel_arguments,
    parse_datasource_allow_arguments,
    parse_datasource_block_arguments,
    parse_datasource_create_arguments,
    parse_datasource_id_argument,
    parse_datasource_query_arguments,
    parse_datasource_review_arguments,
    parse_datasource_update_arguments,
    parse_dataset_add_filter_arguments,
    parse_dataset_create_arguments,
    parse_dataset_export_arguments,
    parse_dataset_id_argument,
    parse_dataset_label_arguments,
    parse_dataset_record_pair,
    parse_dataset_split_arguments,
    parse_model_experiment_create_arguments,
    parse_model_experiment_id_argument,
    parse_dispatch_arguments,
    parse_eval_create_arguments,
    parse_prod_assign_arguments,
    parse_prod_pause_resume_arguments,
    parse_prod_priority_arguments,
    parse_prod_project_arguments,
    parse_prod_status_arguments,
)
from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation
from .context_models import BufferedContext
from .evaluation_session_models import EvaluationJobDefinition, EvaluationSessionRecord
from .execution_models import CapabilityExecutionRequest, CapabilityExecutionResult, ProviderExecutionSnapshot
from .execution_models import LocalCommandExecutionRequest
from .execution_runner import ExecutionRunnerError
from .generated_project_models import GeneratedProjectRecord
from .last_run_models import LastRunRecord
from .dataset_export import DatasetExportError
from .node_dispatcher import NodeDispatchError
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
from .task_chain_models import TaskChainRecord
from .task_chain_policy import build_chain_policy
from .chat_command_parser import parse_chat_command
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
            suggestion, experiment, score = self._service.command_grammar_advisory(text=parsed_command.normalized_text)
            lines = ["Couldn't parse that command.", f"Next: {usage_hint}"]
            if suggestion and experiment is not None:
                lines.append(f"Advisory suggestion: {suggestion}")
                lines.append(f"Advisory model: {experiment.title} ({experiment.experiment_id}) score={score:.2f}")
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="parse_failure",
                user_message="\n".join(lines),
                internal_summary=f"Malformed Telegram command rejected: {parsed_command.normalized_text or 'unknown command'}.",
                retryable=False,
                command_label="parse_failure",
                activity_state="processing_command",
            )

        if command == "plain_text":
            return self._execute_natural_chat_message(
                update=update,
                snapshot=snapshot,
                message=parsed_command.normalized_text,
                entry_capability_id="telegram.plain_text",
                entry_command_label="plain_text",
                batch_busy=batch_busy,
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
        if command == "/dispatch":
            return self._execute_dispatch(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/dispatchstatus":
            return self._execute_dispatch_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/evalcreate":
            return self._execute_eval_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/evals":
            return self._execute_evals(update=update, snapshot=snapshot)
        if command == "/evalstatus":
            return self._execute_eval_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/evalruns":
            return self._execute_eval_runs(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/evalstart":
            return self._execute_eval_start(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/evalstop":
            return self._execute_eval_stop(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chaincreate":
            return self._execute_chain_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chains":
            return self._execute_chains(update=update, snapshot=snapshot)
        if command == "/chainstatus":
            return self._execute_chain_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chainsteps":
            return self._execute_chain_steps(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chainstart":
            return self._execute_chain_start(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chainresume":
            return self._execute_chain_resume(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chainstop":
            return self._execute_chain_stop(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/chaindecision":
            return self._execute_chain_decision(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/status":
            return self._execute_status(update=update, snapshot=snapshot)
        if command == "/lastaction":
            return self._execute_last_action(update=update, snapshot=snapshot)
        if command == "/chat":
            return self._execute_chat(update=update, snapshot=snapshot, argument=parsed_command.argument, batch_busy=batch_busy)
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
        if command == "/projectview":
            return self._execute_project_view(update=update, snapshot=snapshot)
        if command == "/prodproject":
            return self._execute_prod_project(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/prodstatus":
            return self._execute_prod_status(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/prodmobile":
            return self._execute_prod_mobile(update=update, snapshot=snapshot)
        if command == "/prodpriority":
            return self._execute_prod_priority(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/prodpause":
            return self._execute_prod_pause(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/prodresume":
            return self._execute_prod_resume(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/prodassign":
            return self._execute_prod_assign(update=update, snapshot=snapshot, argument=parsed_command.argument)
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
        if command == "/patchlast":
            return self._execute_file_patch_last(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/patchfile":
            return self._execute_file_patch(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/writefile":
            return self._execute_file_replace(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/featurestatus":
            return self._execute_feature_status(update=update, snapshot=snapshot)
        if command == "/featureapply":
            return self._execute_feature_apply(update=update, snapshot=snapshot)
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
        if command == "/data":
            return self._execute_data(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasearch":
            return self._execute_data_search(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datalabel":
            return self._execute_data_label(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/dataunlabel":
            return self._execute_data_unlabel(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datatag":
            return self._execute_data_tag(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasets":
            return self._execute_datasets(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/dataset":
            return self._execute_dataset(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetrecords":
            return self._execute_dataset_records(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetsummary":
            return self._execute_dataset_summary(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetcreate":
            return self._execute_dataset_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetadd":
            return self._execute_dataset_add(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetremove":
            return self._execute_dataset_remove(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetlabel":
            return self._execute_dataset_label(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetaddfilter":
            return self._execute_dataset_add_filter(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetsplit":
            return self._execute_dataset_split(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasetexport":
            return self._execute_dataset_export(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasources":
            return self._execute_datasources(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasource":
            return self._execute_datasource_read_like(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/datasource")
        if command == "/datasourcepolicy":
            return self._execute_datasource_read_like(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/datasourcepolicy")
        if command == "/datasourcesummary":
            return self._execute_datasource_summary(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourcequery":
            return self._execute_datasource_query(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourcecreate":
            return self._execute_datasource_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourceupdate":
            return self._execute_datasource_update(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourcereview":
            return self._execute_datasource_review(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourceblock":
            return self._execute_datasource_block(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/datasourceallow":
            return self._execute_datasource_allow(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/modelexperiments":
            return self._execute_model_experiments(update=update, snapshot=snapshot)
        if command == "/modelexperiment":
            return self._execute_model_experiment_read_like(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperiment")
        if command == "/modelexperimentresults":
            return self._execute_model_experiment_read_like(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperimentresults")
        if command == "/modelexperimentcreate":
            return self._execute_model_experiment_create(update=update, snapshot=snapshot, argument=parsed_command.argument)
        if command == "/modelexperimentstart":
            return self._execute_model_experiment_control(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperimentstart")
        if command == "/modelexperimentstop":
            return self._execute_model_experiment_control(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperimentstop")
        if command == "/modelexperimentapprove":
            return self._execute_model_experiment_control(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperimentapprove")
        if command == "/modelexperimentreject":
            return self._execute_model_experiment_control(update=update, snapshot=snapshot, argument=parsed_command.argument, command_label="/modelexperimentreject")
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

    def _execute_dispatch(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed_dispatch, error = parse_dispatch_arguments(argument)
        selector = (parsed_dispatch or {}).get("selector", "")
        raw_command = (parsed_dispatch or {}).get("command", "")
        if error is not None or not selector or not raw_command:
            request, _, _, scope_failure = self._prepare_capability_request(
                capability_id="node.dispatch.query",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/dispatch",
                parsed_arguments={"selector": selector},
                metadata={"argument_summary": "/dispatch [target] [command hidden]"},
            )
            if scope_failure is not None:
                return scope_failure
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="dispatch_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't queue that dispatch.",
                        f"Reason: {(error.reason if error is not None else 'Missing required target and bounded command.')}",
                        "Next: " + (error.next_step if error is not None else 'Use /dispatch --target <node_or_role> --command "/test ...".'),
                    )
                ),
                internal_summary="node.dispatch.query rejected invalid operator syntax.",
                retryable=False,
                command_label="/dispatch",
                activity_state="processing_command",
            )
        inner_text = self._strip_wrapping_quotes(raw_command)
        inner_command = parse_chat_command(text=inner_text, has_text=True)
        if inner_command.command_label not in {"/run", "/test"}:
            request, _, _, scope_failure = self._prepare_capability_request(
                capability_id="node.dispatch.query",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/dispatch",
                parsed_arguments={"selector": selector},
                metadata={"argument_summary": f"/dispatch {selector} [command hidden]"},
            )
            if scope_failure is not None:
                return scope_failure
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="dispatch_command_not_supported",
                user_message="Couldn't queue that dispatch.\nReason: Only bounded /run and /test commands are supported for node dispatch right now.",
                internal_summary="node.dispatch.query rejected a non-execution inner command.",
                retryable=False,
                command_label="/dispatch",
                activity_state="processing_command",
            )
        target, target_code, target_message = self._service.resolve_dispatch_target(
            selector=selector,
            required_command_label=inner_command.command_label,
            requested_command=inner_text,
        )
        if target is None:
            request, _, _, scope_failure = self._prepare_capability_request(
                capability_id="node.dispatch.query",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/dispatch",
                parsed_arguments={"selector": selector},
                metadata={"argument_summary": f"/dispatch {selector} [command hidden]"},
            )
            if scope_failure is not None:
                return scope_failure
            outcome = "unavailable" if target_code in {"dispatch_node_unavailable", "dispatch_node_disabled", "dispatch_node_busy"} else "blocked"
            if target_code == "dispatch_target_unknown":
                outcome = "invalid_request"
            return self._result(
                request,
                outcome=outcome,
                reason_code=target_code,
                user_message=f"Couldn't queue that dispatch.\nReason: {target_message}",
                internal_summary=f"node.dispatch.query refused dispatch target: {target_code}.",
                retryable=outcome != "invalid_request",
                command_label="/dispatch",
                activity_state="processing_command",
            )
        try:
            local_request = self._build_dispatch_local_request(target_node=target.node, inner_command_label=inner_command.command_label, inner_argument=inner_command.argument)
        except ExecutionRunnerError as exc:
            request, _, _, scope_failure = self._prepare_capability_request(
                capability_id="node.dispatch.query",
                snapshot=snapshot,
                chat_id=update.chat_id,
                requester_label=update.sender_label,
                original_command="/dispatch",
                parsed_arguments={"selector": selector},
                metadata={"argument_summary": f"/dispatch {selector} [command hidden]"},
            )
            if scope_failure is not None:
                return scope_failure
            return self._local_command_error_result(
                request=request,
                error=exc,
                command_summary="",
                command_label="/dispatch",
                confirmation_id="",
            )
        evaluation, context = self._service._evaluate_capability_id("node.dispatch.query", snapshot, remember=True)
        job_id = self._service.next_dispatch_job_id()
        preview_lines = (
            f"Preview: dispatch {local_request.command_summary}",
            f"Target node: {target.node.node_id} | {target.node.display_name} | {target.node.role}",
            f"Reason: {target.routing_reason}",
            f"Scope: {self._service._repo_display_name(target.node.repo_root)} | timeout {int(local_request.timeout_seconds)}s",
        )
        request = self._build_request(
            capability_id="node.dispatch.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/dispatch",
            parsed_arguments={"selector": selector, "command": inner_command.command_label},
            context=context,
            metadata={
                "argument_summary": f"/dispatch {selector} [command hidden]",
                "confirmation_action_label": f"dispatch {local_request.command_summary} to {target.node.node_id}",
                "confirmation_preview_lines": preview_lines,
                "confirmation_metadata": {
                    "dispatch_job_id": job_id,
                    "dispatch_selection_mode": target.selection_mode,
                    "dispatch_target_selector": target.target_value,
                    "dispatch_requested_command_label": inner_command.command_label,
                    "dispatch_requested_command_text": inner_text,
                    "dispatch_requested_command_summary": local_request.command_summary,
                    "dispatch_routing_reason": target.routing_reason,
                    "dispatch_execution_payload_json": json.dumps(self._serialize_local_request(local_request)),
                    "target_node_id": target.node.node_id,
                    "target_node_name": target.node.display_name,
                    "target_node_role": target.node.role,
                    "target_node_type": target.node.node_type,
                    "target_node_transport": target.node.transport,
                },
            },
        )
        scope_failure = self._scope_failure_result(request, command_label="/dispatch")
        if scope_failure is not None:
            return scope_failure
        if evaluation.current_availability_state in {"confirmation_required", "allowed"}:
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=inner_text,
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        if evaluation.current_availability_state != "allowed":
            return self._local_command_blocked_result(request=request, evaluation=evaluation, command_label="/dispatch")
        return self._result(
            request,
            outcome="failed",
            reason_code="dispatch_confirmation_expected",
            user_message="Dispatch could not continue because approval was expected before queueing the node job.",
            internal_summary="node.dispatch.query expected confirmation before queueing a remote job.",
            retryable=True,
            command_label="/dispatch",
            activity_state="processing_command",
        )

    def _execute_dispatch_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        job_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="node.dispatch.status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/dispatchstatus",
            parsed_arguments={"job_id": job_id},
            metadata={"argument_summary": f"/dispatchstatus {job_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        if not job_id:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="dispatch_job_missing",
                user_message="Couldn't inspect dispatch status.\nReason: No job id was provided.\nNext: Use /dispatchstatus <job_id>.",
                internal_summary="node.dispatch.status.read rejected because no job id was provided.",
                retryable=False,
                command_label="/dispatchstatus",
                activity_state="processing_command",
            )
        record = self._service.get_dispatch_job(job_id)
        if record is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="dispatch_job_not_found",
                user_message=f"Couldn't inspect dispatch status.\nReason: No job matches {job_id}.\nNext: Use /dispatch <node_or_role> <bounded command> to queue new work.",
                internal_summary=f"node.dispatch.status.read rejected unknown job id: {job_id}.",
                retryable=False,
                command_label="/dispatchstatus",
                activity_state="processing_command",
            )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._node_formatter.format_dispatch_status(record=record),
            internal_summary=f"node.dispatch.status.read returned {record.job_id}.",
            retryable=False,
            command_label="/dispatchstatus",
            activity_state="processing_command",
            telemetry={
                "dispatch_job_id": record.job_id,
                "target_node_id": record.target_node_id,
                "target_node_name": record.target_node_name,
                "target_node_role": record.target_node_role,
                "dispatch_status": record.status,
                "dispatch_routing_reason": record.routing_reason,
            },
        )

    def _execute_eval_create(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.create",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evalcreate",
            parsed_arguments={},
            metadata={"argument_summary": "/evalcreate [session definition]"},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_eval_create_arguments(argument)
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_create_invalid",
                user_message="\n".join(
                    (
                        "Couldn't create that evaluation session.",
                        f"Reason: {(error.reason if error is not None else 'Invalid evaluation session arguments.')}",
                        "Next: " + (error.next_step if error is not None else 'Use /evalcreate --title "name" --command "/test target" --runs 3 --interval 60.'),
                    )
                ),
                internal_summary="evaluation.session.create rejected invalid session arguments.",
                retryable=False,
                command_label="/evalcreate",
                activity_state="processing_command",
            )
        try:
            session = self._build_evaluation_session(parsed=parsed, chat_id=update.chat_id, requester_label=update.sender_label)
        except ValueError as exc:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_create_invalid",
                user_message=f"Couldn't create that evaluation session.\nReason: {exc}",
                internal_summary="evaluation.session.create rejected invalid session arguments.",
                retryable=False,
                command_label="/evalcreate",
                activity_state="processing_command",
            )
        stored = self._service.create_evaluation_session(session)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(
                (
                    self._service._evaluation_formatter.format_session_preview(session=stored),
                    f"Next: Use /evalstart {stored.session_id} to request approval and begin the loop.",
                )
            ),
            internal_summary=f"evaluation.session.create stored {stored.session_id}.",
            retryable=False,
            command_label="/evalcreate",
            activity_state="processing_command",
            telemetry={
                "evaluation_session_id": stored.session_id,
                "evaluation_status": stored.status,
            },
        )

    def _execute_evals(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.list",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evals",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        sessions = self._service.list_evaluation_sessions()
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._evaluation_formatter.format_session_list(sessions=sessions),
            internal_summary=f"evaluation.session.list returned {len(sessions)} session(s).",
            retryable=False,
            command_label="/evals",
            activity_state="processing_command",
        )

    def _execute_eval_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        session_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.status",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evalstatus",
            parsed_arguments={"session_id": session_id},
            metadata={"argument_summary": f"/evalstatus {session_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service.get_evaluation_session(session_id)
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_session_not_found",
                user_message=f"Couldn't inspect evaluation status.\nReason: No session matches {session_id or '[missing]'}.\nNext: Use /evals to list sessions.",
                internal_summary=f"evaluation.session.status rejected unknown session id: {session_id or '[missing]' }.",
                retryable=False,
                command_label="/evalstatus",
                activity_state="processing_command",
            )
        runs = self._service.evaluation_runs_for_session(session.session_id, limit=5)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._evaluation_formatter.format_session_status(session=session, runs=runs),
            internal_summary=f"evaluation.session.status returned {session.session_id}.",
            retryable=False,
            command_label="/evalstatus",
            activity_state="processing_command",
            telemetry={
                "evaluation_session_id": session.session_id,
                "evaluation_status": session.status,
            },
        )

    def _execute_eval_runs(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        session_id, limit = self._parse_eval_runs_argument(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.runs",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evalruns",
            parsed_arguments={"session_id": session_id, "limit": str(limit)},
            metadata={"argument_summary": f"/evalruns {session_id or '[missing]'} {limit}"},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service.get_evaluation_session(session_id)
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_session_not_found",
                user_message=f"Couldn't inspect evaluation runs.\nReason: No session matches {session_id or '[missing]'}.\nNext: Use /evals to list sessions.",
                internal_summary=f"evaluation.session.runs rejected unknown session id: {session_id or '[missing]' }.",
                retryable=False,
                command_label="/evalruns",
                activity_state="processing_command",
            )
        runs = self._service.evaluation_runs_for_session(session.session_id, limit=limit)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._evaluation_formatter.format_session_runs(session=session, runs=runs),
            internal_summary=f"evaluation.session.runs returned {len(runs)} run(s) for {session.session_id}.",
            retryable=False,
            command_label="/evalruns",
            activity_state="processing_command",
        )

    def _execute_eval_start(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        session_id = argument.strip().upper()
        session = self._service.get_evaluation_session(session_id)
        request, evaluation, context, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.start",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evalstart",
            parsed_arguments={"session_id": session_id},
            metadata={
                "argument_summary": f"/evalstart {session_id or '[missing]'}",
                "confirmation_action_label": f"start evaluation session {session_id or '[missing]'}",
                "confirmation_preview_lines": tuple(
                    (
                        f"Session: {session.title}",
                        f"Job: {session.allowed_jobs[0].command_summary if session is not None and session.allowed_jobs else '-'}",
                        f"Runs: {session.max_runs}",
                        f"Interval: {session.interval_seconds}s",
                    )
                ) if session is not None else (),
                "confirmation_metadata": {"evaluation_session_id": session_id},
            },
        )
        if scope_failure is not None:
            return scope_failure
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_session_not_found",
                user_message=f"Couldn't start that evaluation session.\nReason: No session matches {session_id or '[missing]'}.\nNext: Use /evals to list sessions.",
                internal_summary=f"evaluation.session.start rejected unknown session id: {session_id or '[missing]' }.",
                retryable=False,
                command_label="/evalstart",
                activity_state="processing_command",
            )
        if session.status == "running":
            return self._result(
                request,
                outcome="success",
                reason_code="ok",
                user_message=f"Evaluation session {session.session_id} is already running.",
                internal_summary=f"evaluation.session.start observed {session.session_id} already running.",
                retryable=False,
                command_label="/evalstart",
                activity_state="processing_command",
            )
        if evaluation.current_availability_state in {"confirmation_required", "allowed"}:
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=f"start evaluation session {session.session_id}",
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        return self._result(
            request,
            outcome="failed",
            reason_code="evaluation_start_blocked",
            user_message="Evaluation start could not continue because approval was blocked.",
            internal_summary=f"evaluation.session.start blocked for {session.session_id}.",
            retryable=True,
            command_label="/evalstart",
            activity_state="processing_command",
        )

    def _execute_eval_stop(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        session_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="evaluation.session.stop",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/evalstop",
            parsed_arguments={"session_id": session_id},
            metadata={"argument_summary": f"/evalstop {session_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        session = self._service.get_evaluation_session(session_id)
        if session is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="evaluation_session_not_found",
                user_message=f"Couldn't stop that evaluation session.\nReason: No session matches {session_id or '[missing]'}.\nNext: Use /evals to list sessions.",
                internal_summary=f"evaluation.session.stop rejected unknown session id: {session_id or '[missing]' }.",
                retryable=False,
                command_label="/evalstop",
                activity_state="processing_command",
            )
        stopped = self._service.stop_evaluation_session(session.session_id, reason="Stopped by operator.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Evaluation session {stopped.session_id} stopped.\nReason: {stopped.stop_reason or 'Stopped by operator.'}",
            internal_summary=f"evaluation.session.stop marked {stopped.session_id} as stopped.",
            retryable=False,
            command_label="/evalstop",
            activity_state="processing_command",
        )

    def _execute_chain_create(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.create",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chaincreate",
            parsed_arguments={"raw": argument},
            metadata={"argument_summary": "/chaincreate [definition hidden]"},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_chain_create_arguments(argument)
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_parse_failed",
                user_message="\n".join(
                    (
                        "Couldn't create that task chain.",
                        f"Reason: {(error.reason if error is not None else 'Invalid task-chain arguments.')}",
                        "Next: " + (error.next_step if error is not None else 'Use /chaincreate --title "name" --type validate_then_report --command "/run pytest ..." --steps 3.'),
                    )
                ),
                internal_summary=f"task.chain.create rejected invalid syntax: {(error.reason if error is not None else 'invalid task-chain arguments')}",
                retryable=False,
                command_label="/chaincreate",
                activity_state="processing_command",
            )
        try:
            chain = self._build_task_chain(parsed=parsed, chat_id=update.chat_id, requester_label=update.sender_label)
        except ValueError as exc:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_invalid_definition",
                user_message=f"Couldn't create that task chain.\nReason: {exc}\nNext: Adjust the chain type, target, or bounded command and retry.",
                internal_summary=f"task.chain.create rejected invalid definition: {exc}",
                retryable=False,
                command_label="/chaincreate",
                activity_state="processing_command",
            )
        created = self._service.create_task_chain(chain)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._task_chain_formatter.format_chain_preview(chain=created),
            internal_summary=f"task.chain.create stored {created.chain_id}.",
            retryable=False,
            command_label="/chaincreate",
            activity_state="processing_command",
            telemetry={"task_chain_id": created.chain_id, "task_chain_status": created.status},
        )

    def _execute_chains(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.list",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chains",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        chains = self._service.list_task_chains()
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._task_chain_formatter.format_chain_list(chains=chains),
            internal_summary=f"task.chain.list returned {len(chains)} chain(s).",
            retryable=False,
            command_label="/chains",
            activity_state="processing_command",
        )

    def _execute_chain_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.status",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chainstatus",
            parsed_arguments={"chain_id": chain_id},
            metadata={"argument_summary": f"/chainstatus {chain_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't inspect task chain status.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.status rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chainstatus",
                activity_state="processing_command",
            )
        steps = self._service.task_chain_steps(chain.chain_id, limit=5)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._task_chain_formatter.format_chain_status(chain=chain, steps=steps),
            internal_summary=f"task.chain.status returned {chain.chain_id}.",
            retryable=False,
            command_label="/chainstatus",
            activity_state="processing_command",
            telemetry={"task_chain_id": chain.chain_id, "task_chain_status": chain.status},
        )

    def _execute_chain_steps(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id, limit = self._parse_chain_steps_argument(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.steps",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chainsteps",
            parsed_arguments={"chain_id": chain_id, "limit": str(limit)},
            metadata={"argument_summary": f"/chainsteps {chain_id or '[missing]'} {limit}"},
        )
        if scope_failure is not None:
            return scope_failure
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't inspect task chain steps.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.steps rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chainsteps",
                activity_state="processing_command",
            )
        steps = self._service.task_chain_steps(chain.chain_id, limit=limit)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._task_chain_formatter.format_chain_steps(chain=chain, steps=steps),
            internal_summary=f"task.chain.steps returned {len(steps)} step(s) for {chain.chain_id}.",
            retryable=False,
            command_label="/chainsteps",
            activity_state="processing_command",
        )

    def _execute_chain_start(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id = argument.strip().upper()
        chain = self._service.get_task_chain(chain_id)
        request, evaluation, context, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.start",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chainstart",
            parsed_arguments={"chain_id": chain_id},
            metadata={
                "argument_summary": f"/chainstart {chain_id or '[missing]'}",
                "confirmation_action_label": f"start task chain {chain_id or '[missing]'}",
                "confirmation_preview_lines": tuple(
                    (
                        f"Chain: {chain.title}",
                        f"Type: {chain.chain_type}",
                        f"Command: {chain.command_label} {chain.command_argument}".strip(),
                        f"Limits: {chain.max_steps} steps / {chain.max_failures} failures",
                    )
                ) if chain is not None else (),
                "confirmation_metadata": {"task_chain_id": chain_id},
            },
        )
        if scope_failure is not None:
            return scope_failure
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't start that task chain.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.start rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chainstart",
                activity_state="processing_command",
            )
        if chain.status == "paused":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_paused",
                user_message=f"Task chain {chain.chain_id} is paused.\nNext: Use /chaindecision {chain.chain_id} to inspect the last bounded decision, then /chainresume {chain.chain_id} if you want to continue.",
                internal_summary=f"task.chain.start rejected paused chain {chain.chain_id}.",
                retryable=False,
                command_label="/chainstart",
                activity_state="processing_command",
            )
        if chain.status == "running":
            return self._result(
                request,
                outcome="success",
                reason_code="ok",
                user_message=f"Task chain {chain.chain_id} is already running.",
                internal_summary=f"task.chain.start observed {chain.chain_id} already running.",
                retryable=False,
                command_label="/chainstart",
                activity_state="processing_command",
            )
        if evaluation.current_availability_state in {"confirmation_required", "allowed"}:
            return self._confirmation_required_result(
                request=request,
                evaluation=evaluation,
                context=context,
                snapshot=snapshot,
                prompt=f"start task chain {chain.chain_id}",
                response_style="concise",
                chat_id=update.chat_id,
                requester_label=update.sender_label,
            )
        return self._result(
            request,
            outcome="failed",
            reason_code="task_chain_start_blocked",
            user_message="Task chain start could not continue because approval was blocked.",
            internal_summary=f"task.chain.start blocked for {chain.chain_id}.",
            retryable=True,
            command_label="/chainstart",
            activity_state="processing_command",
        )

    def _execute_chain_resume(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.resume",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chainresume",
            parsed_arguments={"chain_id": chain_id},
            metadata={"argument_summary": f"/chainresume {chain_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't resume that task chain.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.resume rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chainresume",
                activity_state="processing_command",
            )
        if chain.status != "paused":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_paused",
                user_message=f"Task chain {chain.chain_id} is not paused.\nNext: Use /chainstatus {chain.chain_id} to inspect its current state.",
                internal_summary=f"task.chain.resume rejected non-paused chain {chain.chain_id}.",
                retryable=False,
                command_label="/chainresume",
                activity_state="processing_command",
            )
        resumed = self._service.resume_task_chain(chain.chain_id)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Task chain {resumed.chain_id} resumed.\nNext: Use /chainstatus {resumed.chain_id} or /chaindecision {resumed.chain_id} while it runs.",
            internal_summary=f"task.chain.resume resumed {resumed.chain_id}.",
            retryable=False,
            command_label="/chainresume",
            activity_state="processing_command",
            telemetry={"task_chain_id": resumed.chain_id, "task_chain_status": resumed.status},
        )

    def _execute_chain_stop(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.stop",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chainstop",
            parsed_arguments={"chain_id": chain_id},
            metadata={"argument_summary": f"/chainstop {chain_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't stop that task chain.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.stop rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chainstop",
                activity_state="processing_command",
            )
        stopped = self._service.stop_task_chain(chain.chain_id, reason="Stopped by operator.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Task chain {stopped.chain_id} stopped.\nReason: {stopped.stop_reason or 'Stopped by operator.'}",
            internal_summary=f"task.chain.stop marked {stopped.chain_id} as stopped.",
            retryable=False,
            command_label="/chainstop",
            activity_state="processing_command",
        )

    def _execute_chain_decision(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        chain_id = argument.strip().upper()
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="task.chain.decision",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/chaindecision",
            parsed_arguments={"chain_id": chain_id},
            metadata={"argument_summary": f"/chaindecision {chain_id or '[missing]'}"},
        )
        if scope_failure is not None:
            return scope_failure
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="task_chain_not_found",
                user_message=f"Couldn't inspect that task chain decision.\nReason: No chain matches {chain_id or '[missing]'}.\nNext: Use /chains to list chains.",
                internal_summary=f"task.chain.decision rejected unknown chain id: {chain_id or '[missing]' }.",
                retryable=False,
                command_label="/chaindecision",
                activity_state="processing_command",
            )
        steps = self._service.task_chain_steps(chain.chain_id, limit=5)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._task_chain_formatter.format_chain_decision(chain=chain, steps=steps),
            internal_summary=f"task.chain.decision returned {chain.chain_id}.",
            retryable=False,
            command_label="/chaindecision",
            activity_state="processing_command",
            telemetry={"task_chain_id": chain.chain_id, "task_chain_status": chain.status},
        )

    @staticmethod
    def _parse_dispatch_argument(argument: str) -> tuple[str, str]:
        parsed, _ = parse_dispatch_arguments(argument)
        if parsed is None:
            return "", ""
        return parsed.get("selector", ""), parsed.get("command", "")

    @staticmethod
    def _strip_wrapping_quotes(text: str) -> str:
        stripped = text.strip()
        if len(stripped) >= 2 and stripped[0] == stripped[-1] and stripped[0] in {'"', "'"}:
            return stripped[1:-1].strip()
        return stripped

    def _parse_eval_create_argument(self, argument: str) -> tuple[dict[str, str], str]:
        parsed, error = parse_eval_create_arguments(argument)
        if error is not None or parsed is None:
            return {}, error.reason if error is not None else "Invalid evaluation session arguments."
        return parsed, ""

    @staticmethod
    def _parse_eval_runs_argument(argument: str) -> tuple[str, int]:
        parts = argument.split()
        session_id = parts[0].strip().upper() if parts else ""
        if len(parts) >= 2:
            try:
                return session_id, max(1, min(25, int(parts[1])))
            except ValueError:
                return session_id, 10
        return session_id, 10

    def _parse_chain_create_argument(self, argument: str) -> tuple[dict[str, str], str]:
        parsed, error = parse_chain_create_arguments(argument)
        if error is not None or parsed is None:
            return {}, error.reason if error is not None else "Invalid task-chain arguments."
        return parsed, ""

    @staticmethod
    def _parse_chain_steps_argument(argument: str) -> tuple[str, int]:
        parts = argument.split()
        chain_id = parts[0].strip().upper() if parts else ""
        if len(parts) >= 2:
            try:
                return chain_id, max(1, min(25, int(parts[1])))
            except ValueError:
                return chain_id, 10
        return chain_id, 10

    @staticmethod
    def _parse_chain_target(value: str) -> tuple[str, str, str, str]:
        normalized = value.strip().lower() or "local"
        if normalized == "local":
            return "local", "", "local controller", "fallback_target"
        if normalized.startswith("node:"):
            selector = normalized.split(":", 1)[1].strip().lower()
            return "node", selector, f"node {selector}", "fallback_target"
        if normalized.startswith("role:"):
            selector = normalized.split(":", 1)[1].strip().lower()
            return "role", selector, f"role {selector}", "fallback_target"
        raise ValueError("Target must be local, node:<id>, or role:<role>.")

    def _build_task_chain(self, *, parsed: dict[str, str], chat_id: str, requester_label: str) -> TaskChainRecord:
        chain_id = self._service.next_task_chain_id()
        command_text = self._strip_wrapping_quotes(parsed.get("command", ""))
        command = parse_chat_command(text=command_text, has_text=True)
        if command.command_label not in {"/run", "/test"}:
            raise ValueError("Only bounded /run and /test commands are supported inside task chains.")
        chain_type = parsed.get("type", "").strip().lower()
        if chain_type not in {
            "validate_then_report",
            "feature_validate_loop",
            "dispatch_validate_recover",
            "validate_with_fallback",
            "validate_compare_report",
            "dispatch_recover_resume",
            "feature_validate_gate",
        }:
            raise ValueError(
                "Chain type must be validate_then_report, feature_validate_loop, dispatch_validate_recover, validate_with_fallback, validate_compare_report, dispatch_recover_resume, or feature_validate_gate."
            )
        primary_kind, primary_selector, primary_display, _ = self._parse_chain_target(parsed.get("target", "local"))
        fallback_value = parsed.get("fallback", "stop").strip().lower() or "stop"
        fallback_policy = "stop"
        fallback_kind = "local"
        fallback_selector = ""
        fallback_display = "stop"
        if fallback_value != "stop":
            fallback_kind, fallback_selector, fallback_display, fallback_policy = self._parse_chain_target(fallback_value)
        if chain_type == "dispatch_validate_recover" and primary_kind == "local":
            raise ValueError("dispatch_validate_recover requires a node:<id> or role:<role> primary target.")
        if chain_type == "dispatch_recover_resume" and primary_kind == "local":
            raise ValueError("dispatch_recover_resume requires a node:<id> or role:<role> primary target.")
        if chain_type in {"validate_with_fallback", "validate_compare_report", "dispatch_recover_resume"} and fallback_value == "stop":
            raise ValueError(f"{chain_type} requires an explicit bounded fallback target.")
        if chain_type == "validate_compare_report" and fallback_display == primary_display:
            raise ValueError("validate_compare_report requires a comparison target that differs from the primary target.")
        allowed_step_families: list[str] = ["test" if command.command_label == "/test" else "run", "report"]
        if primary_kind in {"node", "role"} or fallback_kind in {"node", "role"}:
            allowed_step_families.append("dispatch")
        if chain_type in {"feature_validate_loop", "feature_validate_gate"}:
            allowed_step_families.append("feature_status")
        chain_policy_version, initial_stage, branch_rules, fallback_actions, allowed_transition_reasons = build_chain_policy(
            chain_type=chain_type,
            fallback_kind=fallback_kind,
            fallback_selector=fallback_selector,
            fallback_display=fallback_display,
        )
        return TaskChainRecord(
            chain_id=chain_id,
            title=parsed.get("title", "").strip(),
            objective=parsed.get("objective", "").strip() or parsed.get("title", "").strip(),
            chain_type=chain_type,  # type: ignore[arg-type]
            created_at=self._service._now_iso(),
            approved_at="",
            status="created",
            owner_label=requester_label,
            source="telegram",
            chat_id=chat_id,
            command_text=command_text,
            command_label=command.command_label,
            command_argument=command.argument,
            primary_target_kind=primary_kind,  # type: ignore[arg-type]
            primary_target_selector=primary_selector,
            primary_target_display=primary_display,
            fallback_target_kind=fallback_kind,  # type: ignore[arg-type]
            fallback_target_selector=fallback_selector,
            fallback_target_display=fallback_display,
            fallback_policy=fallback_policy,
            allowed_step_families=tuple(dict.fromkeys(allowed_step_families)),  # type: ignore[arg-type]
            max_steps=max(1, int(parsed.get("steps", "1"))),
            max_failures=max(1, int(parsed.get("failures", "1"))),
            max_no_progress=max(1, int(parsed.get("no-progress", parsed.get("no_progress", "1")))),
            chain_policy_version=chain_policy_version,
            branch_rules=branch_rules,
            fallback_actions=fallback_actions,
            allowed_transition_reasons=allowed_transition_reasons,
            latest_summary="Chain created and waiting for approval.",
            progress_state="idle",
            last_decision_summary="No supervised decision has been recorded yet.",
            metadata={
                "stage": initial_stage,
                "compat_retries": parsed.get("retries", "").strip(),
            },
        )

    def _build_evaluation_session(self, *, parsed: dict[str, str], chat_id: str, requester_label: str) -> EvaluationSessionRecord:
        session_id = self._service.next_evaluation_session_id()
        command_text = self._strip_wrapping_quotes(parsed.get("command", ""))
        command = parse_chat_command(text=command_text, has_text=True)
        if command.command_label not in {"/run", "/test"}:
            raise ValueError("Only bounded /run and /test commands are supported for evaluation sessions.")
        target_value = parsed.get("target", "local").strip().lower() or "local"
        target_kind = "local"
        target_selector = ""
        target_display = "local controller"
        job_kind = "local_command"
        if target_value.startswith("node:"):
            job_kind = "node_dispatch"
            target_kind = "node"
            target_selector = target_value.split(":", 1)[1].strip().lower()
            target_display = f"node {target_selector}"
        elif target_value.startswith("role:"):
            job_kind = "node_dispatch"
            target_kind = "role"
            target_selector = target_value.split(":", 1)[1].strip().lower()
            target_display = f"role {target_selector}"
        runs = max(1, int(parsed.get("runs", "1")))
        failures = max(1, int(parsed.get("failures", "1")))
        interval = max(0, int(parsed.get("interval", "0")))
        dispatch_errors = max(1, int(parsed.get("dispatch-errors", parsed.get("dispatch_errors", "1"))))
        job = EvaluationJobDefinition(
            job_id="job-1",
            command_label=command.command_label,
            command_text=command_text,
            command_argument=command.argument,
            command_summary=f"{command.command_label} {command.argument}".strip(),
            job_kind=job_kind,  # type: ignore[arg-type]
            target_kind=target_kind,  # type: ignore[arg-type]
            target_selector=target_selector,
            target_display=target_display,
            expected_scope=self._service._repo_display_name(),
        )
        return EvaluationSessionRecord(
            session_id=session_id,
            title=parsed.get("title", "").strip(),
            purpose=parsed.get("purpose", "").strip(),
            created_at=self._service._now_iso(),
            approved_at="",
            status="created",
            owner_label=requester_label,
            source="telegram",
            chat_id=chat_id,
            allowed_jobs=(job,),
            interval_seconds=interval,
            max_runs=runs,
            max_failures=failures,
            dispatch_error_threshold=dispatch_errors,
            stop_conditions=("max_runs", "max_failures", "operator_stop"),
            latest_summary="Session created and waiting for approval.",
            metadata={"original_command": command_text},
        )

    def _build_dispatch_local_request(self, *, target_node, inner_command_label: str, inner_argument: str) -> LocalCommandExecutionRequest:
        repo_root = target_node.repo_root.strip()
        if inner_command_label == "/run":
            return self._service._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=repo_root,
                command_text=inner_argument,
                expected_scope=self._service._repo_display_name(repo_root),
            )
        return self._service._execution_runner.build_test_request(
            capability_id="test.command.run",
            repo_root=repo_root,
            target=inner_argument,
            expected_scope=self._service._repo_display_name(repo_root),
        )

    @staticmethod
    def _serialize_local_request(local_request: LocalCommandExecutionRequest) -> dict[str, object]:
        return {
            "capability_id": local_request.capability_id,
            "command_kind": local_request.command_kind,
            "command_family": local_request.command_family,
            "command_text": local_request.command_text,
            "command_summary": local_request.command_summary,
            "working_directory": local_request.working_directory,
            "timeout_seconds": local_request.timeout_seconds,
            "operator_reason": local_request.operator_reason,
            "expected_scope": local_request.expected_scope,
            "argv": list(local_request.argv),
        }

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
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        return self._execute_natural_chat_message(
            update=update,
            snapshot=snapshot,
            message=argument,
            entry_capability_id="chat.orchestrate.read",
            entry_command_label="/chat",
            batch_busy=batch_busy,
        )

    def _execute_natural_chat_message(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        message: str,
        entry_capability_id: str,
        entry_command_label: str,
        batch_busy: bool,
    ) -> CapabilityExecutionResult:
        request = self._build_request(
            capability_id=entry_capability_id,
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=entry_command_label,
            parsed_arguments={"message": " ".join(message.split())},
            metadata={"argument_summary": f"{entry_command_label} [message hidden]"},
        )
        scope_failure = self._scope_failure_result(request, command_label=entry_command_label)
        if scope_failure is not None:
            return scope_failure
        prompt = " ".join(message.split())
        if not prompt:
            guidance = "Use /chat <message>." if entry_command_label == "/chat" else "Send a natural-language request or use /help."
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_chat_message",
                user_message=f"Couldn't route that chat request.\nReason: No conversational message was provided.\nNext: {guidance}",
                internal_summary=f"{entry_command_label} rejected because no conversational message was provided.",
                retryable=False,
                command_label=entry_command_label,
                activity_state="processing_command",
            )
        production_outcome = self._service.handle_production_conversation(chat_id=update.chat_id, message=prompt)
        if production_outcome.matched:
            routed_capability_id = "production.read" if production_outcome.routed_action.startswith("status_") or production_outcome.routed_action == "clarify" else "production.control.query"
            return self._result(
                request,
                outcome="success",
                reason_code="ok" if not production_outcome.clarification else "needs_clarification",
                user_message=production_outcome.reply,
                internal_summary=(
                    f"{entry_capability_id} recognized production intent and routed to {production_outcome.routed_action or 'production'}"
                ),
                retryable=False,
                command_label=entry_command_label,
                activity_state="processing_command",
                telemetry={
                    "production_conversation": True,
                    "production_summary": production_outcome.summary,
                    "production_context_used": True,
                    "production_clarification": production_outcome.clarification,
                    "routed_capability_id": routed_capability_id,
                    "routed_command_label": production_outcome.routed_action,
                    "routed_telemetry": dict(production_outcome.telemetry or {}),
                },
            )
        feature_decision = self._service.plan_feature_bundle_for_chat(chat_id=update.chat_id, prompt=prompt)
        if feature_decision.kind == "planned" and feature_decision.bundle is not None:
            bundle = feature_decision.bundle
            return self._result(
                request,
                outcome="success",
                reason_code="ok",
                user_message=self._service._feature_bundle_formatter.format_proposal(bundle),
                internal_summary=f"{entry_capability_id} prepared bounded feature bundle {bundle.bundle_id} for review.",
                retryable=False,
                command_label=entry_command_label,
                activity_state="processing_command",
                telemetry={
                    "feature_bundle_id": bundle.bundle_id,
                    "feature_bundle_state": bundle.state,
                    "feature_bundle": bundle.to_payload(),
                    "routed_capability_id": "build.feature.status.read",
                    "routed_command_label": "/featurestatus",
                },
            )
        if feature_decision.kind == "refused":
            return self._result(
                request,
                outcome="success",
                reason_code="feature_bundle_refused",
                user_message=self._service._feature_bundle_formatter.format_refusal(
                    reason=feature_decision.refusal_reason,
                    next_step=feature_decision.next_step,
                ),
                internal_summary=f"{entry_capability_id} refused bounded multi-file planning: {feature_decision.refusal_reason}",
                retryable=False,
                command_label=entry_command_label,
                activity_state="processing_command",
                telemetry={
                    "feature_bundle_refusal_reason": feature_decision.refusal_reason,
                    "feature_bundle_next_step": feature_decision.next_step,
                },
            )
        execution_conversation = self._service.plan_task_execution_conversation(chat_id=update.chat_id, message=prompt)
        if execution_conversation.matched:
            if execution_conversation.request is not None and execution_conversation.request.requires_clarification:
                return self._result(
                    request,
                    outcome="success",
                    reason_code="needs_clarification",
                    user_message=execution_conversation.reply,
                    internal_summary=f"{entry_capability_id} requested bounded execution clarification.",
                    retryable=False,
                    command_label=entry_command_label,
                    activity_state="processing_command",
                    telemetry={
                        "task_execution_conversation": True,
                        **execution_conversation.telemetry,
                    },
                )
            inner_command = execution_conversation.chain_create_command
            parsed_inner = parse_chat_command(text=inner_command, has_text=True)
            inner_update = TelegramInboundMessage(
                update_id=update.update_id,
                chat_id=update.chat_id,
                text=inner_command,
                sender_label=update.sender_label,
            )
            inner_result = self.execute_telegram(
                update=inner_update,
                parsed_command=parsed_inner,
                snapshot=snapshot,
                batch_busy=False,
            )
            chain_id = str(inner_result.telemetry.get("task_chain_id") or "").strip().upper()
            user_message = inner_result.user_message
            if chain_id:
                user_message = "\n\n".join(
                    (
                        execution_conversation.reply,
                        inner_result.user_message,
                        f"Next: Use /chainstart {chain_id} when you want to request one-shot approval for execution.",
                    )
                )
            return self._result(
                request,
                outcome=inner_result.outcome,
                reason_code=inner_result.outcome_reason_code,
                user_message=user_message,
                internal_summary=(
                    f"{entry_capability_id} compiled a conversational execution request into task chain {chain_id or 'preview'}; "
                    f"inner outcome={inner_result.outcome}."
                ),
                retryable=inner_result.retryable,
                command_label=entry_command_label,
                activity_state="processing_command",
                degraded=inner_result.degraded,
                provider_used=inner_result.provider_used,
                mode_used=inner_result.mode_used,
                confirmation_used=inner_result.confirmation_used,
                ask_status=inner_result.ask_status,
                hide_content_in_summary=inner_result.hide_content_in_summary,
                telemetry={
                    "task_execution_conversation": True,
                    **execution_conversation.telemetry,
                    "routed_capability_id": inner_result.capability_id,
                    "routed_command_label": "/chaincreate",
                    "routed_telemetry": dict(inner_result.telemetry),
                },
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
        legacy_orchestration = self._service._chat_orchestrator.orchestrate(
            prompt,
            orchestration_id=self._generate_chat_orchestration_id(),
            chat_id=update.chat_id,
            context=orchestration_context,
        )
        natural_context = self._service._chat_ingress.build_context(service=self._service, snapshot=snapshot, chat_id=update.chat_id)
        classification, route_decision = self._service._chat_ingress.classify_and_route(
            message=prompt,
            context=natural_context,
            legacy_orchestration=legacy_orchestration,
        )
        telemetry_base = {
            "natural_chat_message": prompt,
            "natural_chat_context": natural_context.to_payload(),
            "natural_chat_classification": classification.to_payload(),
            "natural_chat_route": route_decision.to_payload(),
            "orchestration_context": orchestration_context.to_payload(),
            "orchestration_result": legacy_orchestration.to_payload(),
            "natural_chat_summary": f"{classification.intent_label} {classification.confidence:.2f} -> {route_decision.selected_route or 'fallback'}",
        }
        if route_decision.route_kind == "legacy_chat":
            inner_result = self._execute_legacy_chat_orchestration(update=update, snapshot=snapshot, argument=prompt)
            return self._result(
                request,
                outcome=inner_result.outcome,
                reason_code=inner_result.outcome_reason_code,
                user_message=inner_result.user_message,
                internal_summary=(
                    f"{entry_capability_id} classified {classification.intent_label} ({classification.confidence:.2f}) and reused legacy /chat routing to "
                    f"{legacy_orchestration.routed_action or 'clarification'}; inner outcome={inner_result.outcome}."
                ),
                retryable=inner_result.retryable,
                command_label=entry_command_label,
                activity_state="processing_command",
                degraded=inner_result.degraded,
                provider_used=inner_result.provider_used,
                mode_used=inner_result.mode_used,
                confirmation_used=inner_result.confirmation_used,
                ask_status=inner_result.ask_status,
                hide_content_in_summary=inner_result.hide_content_in_summary,
                telemetry={
                    **telemetry_base,
                    "routed_capability_id": str(inner_result.telemetry.get("routed_capability_id") or inner_result.capability_id),
                    "routed_command_label": str(inner_result.telemetry.get("routed_command_label") or legacy_orchestration.routed_action),
                    "routed_telemetry": dict(inner_result.telemetry.get("routed_telemetry") or inner_result.telemetry),
                },
            )
        if route_decision.route_kind == "fallback":
            return self._result(
                request,
                outcome="success",
                reason_code="needs_clarification",
                user_message=self._service._chat_ingress.fallback_reply(
                    classification=classification,
                    route_decision=route_decision,
                    context=natural_context,
                ),
                internal_summary=(
                    f"{entry_capability_id} classified {classification.intent_label} ({classification.confidence:.2f}) and returned a safe fallback: "
                    f"{route_decision.fallback_reason or classification.rationale}"
                ),
                retryable=False,
                command_label=entry_command_label,
                activity_state="processing_command",
                telemetry=telemetry_base,
            )
        inner_result = self._dispatch_chat_routed_action(
            update=update,
            snapshot=snapshot,
            routed_action=route_decision.route_command,
            message=route_decision.route_argument or prompt,
            batch_busy=batch_busy,
        )
        return self._result(
            request,
            outcome=inner_result.outcome,
            reason_code=inner_result.outcome_reason_code,
            user_message=inner_result.user_message,
            internal_summary=(
                f"{entry_capability_id} classified {classification.intent_label} ({classification.confidence:.2f}) and routed to "
                f"{route_decision.selected_route}; inner outcome={inner_result.outcome}."
            ),
            retryable=inner_result.retryable,
            command_label=entry_command_label,
            activity_state="processing_command",
            degraded=inner_result.degraded,
            provider_used=inner_result.provider_used,
            mode_used=inner_result.mode_used,
            confirmation_used=inner_result.confirmation_used,
            ask_status=inner_result.ask_status,
            hide_content_in_summary=inner_result.hide_content_in_summary,
            telemetry={
                **telemetry_base,
                "routed_capability_id": inner_result.capability_id,
                "routed_command_label": route_decision.route_command,
                "routed_telemetry": dict(inner_result.telemetry),
            },
        )

    def _execute_feature_status(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="build.feature.status.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/featurestatus",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        bundle = self._service.active_feature_bundle_for_chat(chat_id=update.chat_id)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service.feature_bundle_status_reply(chat_id=update.chat_id),
            internal_summary="Returned active bounded feature bundle status." if bundle is not None else "No active bounded feature bundle is available.",
            retryable=False,
            command_label="/featurestatus",
            activity_state="processing_command",
            telemetry={
                "feature_bundle_active": bool(bundle is not None),
                "feature_bundle_id": bundle.bundle_id if bundle is not None else "",
                "feature_bundle_state": bundle.state if bundle is not None else "",
                "feature_bundle": bundle.to_payload() if bundle is not None else {},
            },
        )

    def _execute_feature_apply(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
    ) -> CapabilityExecutionResult:
        request, evaluation, context, scope_failure = self._prepare_capability_request(
            capability_id="build.feature.apply.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/featureapply",
            parsed_arguments={},
            metadata={
                "argument_summary": "/featureapply",
            },
        )
        if scope_failure is not None:
            return scope_failure
        bundle = self._service.active_feature_bundle_for_chat(chat_id=update.chat_id)
        if bundle is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="no_active_feature_bundle",
                user_message=self._service._feature_bundle_formatter.format_no_active_bundle(),
                internal_summary="/featureapply rejected because no active feature bundle exists.",
                retryable=False,
                command_label="/featureapply",
                activity_state="processing_command",
            )
        if bundle.state != "proposed":
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="feature_bundle_not_proposed",
                user_message="\n".join(
                    (
                        f"Feature bundle {bundle.bundle_id} is not awaiting apply approval.",
                        f"State: {bundle.state}",
                        "Next: use /featurestatus to inspect the current bundle state or send a new bounded feature request.",
                    )
                ),
                internal_summary=f"/featureapply rejected because feature bundle {bundle.bundle_id} is {bundle.state}.",
                retryable=False,
                command_label="/featureapply",
                activity_state="processing_command",
                telemetry={
                    "feature_bundle_id": bundle.bundle_id,
                    "feature_bundle_state": bundle.state,
                },
            )
        editable_paths = tuple(item.relative_path for item in bundle.editable_files())
        if not editable_paths:
            return self._result(
                request,
                outcome="failed",
                reason_code="feature_bundle_missing_editable_files",
                user_message="Feature bundle has no editable files to apply.\nNext: send a fresh bounded feature request.",
                internal_summary=f"/featureapply failed because bundle {bundle.bundle_id} had no editable files.",
                retryable=False,
                command_label="/featureapply",
                activity_state="provider_failed",
            )
        request.metadata.update(
            {
                "confirmation_action_label": f"apply feature bundle {bundle.bundle_id} ({len(editable_paths)} files)",
                "confirmation_preview_lines": [
                    f"Bundle: {bundle.bundle_id}",
                    f"Feature: {bundle.feature_title}",
                    *(f"File: {path}" for path in editable_paths),
                    *((f"Validation: {bundle.validation_plan.command_text}",) if bundle.validation_plan is not None else ()),
                ],
                "confirmation_metadata": {
                    "feature_bundle_id": bundle.bundle_id,
                    "feature_title": bundle.feature_title,
                },
            }
        )
        return self._confirmation_required_result(
            request=request,
            evaluation=evaluation,
            context=context,
            snapshot=snapshot,
            prompt=bundle.bundle_id,
            response_style="concise",
            chat_id=update.chat_id,
            requester_label=update.sender_label,
        )

    def _execute_confirmed_feature_bundle_apply(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        bundle_id = str(confirmation.metadata.get("feature_bundle_id") or confirmation.prompt_text).strip()
        bundle = self._service.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None or bundle.bundle_id != bundle_id:
            return self._result(
                request,
                outcome="failed",
                reason_code="feature_bundle_missing",
                user_message="\n".join(
                    (
                        f"Feature bundle {bundle_id or confirmation.confirmation_id} could not be applied.",
                        "Reason: The active bundle no longer matches the approved request.",
                        "Next: use /featurestatus to inspect state or send the bounded feature request again.",
                    )
                ),
                internal_summary=f"Confirmation {confirmation.confirmation_id} failed because feature bundle {bundle_id or '?'} was missing.",
                retryable=False,
                command_label="/confirm",
                activity_state="provider_failed",
                confirmation_used=True,
            )
        applying_bundle = bundle.with_state(
            "applying",
            updated_at=self._service._now_iso(),
            apply_summary=f"Applying {len(bundle.editable_files())} editable files.",
            stop_reason="",
        )
        self._service.set_active_feature_bundle(chat_id=chat_id, bundle=applying_bundle)
        applied_files: list[str] = []
        try:
            for item in applying_bundle.editable_files():
                parsed = parse_patch_command(item.patch_argument)
                relative_path, target_path, _, resolve_code, resolve_message = self._service.resolve_file_request(parsed.relative_path)
                if resolve_code != "file_target_ready":
                    raise FileMutatorError(resolve_code, resolve_message)
                self._service._file_mutator.apply_patch(
                    FilePatchMutationRequest(
                        target_path=target_path,
                        display_path=relative_path,
                        operator_reason=parsed.operator_reason,
                        expected_base_hash=parsed.expected_base_hash,
                        operations=parsed.operations,
                    )
                )
                applied_files.append(relative_path)
        except FileMutatorError as exc:
            failed_bundle = applying_bundle.with_state(
                "failed",
                updated_at=self._service._now_iso(),
                applied_files=tuple(applied_files),
                apply_summary=f"Stopped after {len(applied_files)} editable files.",
                stop_reason=exc.message,
            )
            self._service.set_active_feature_bundle(chat_id=chat_id, bundle=failed_bundle)
            return self._result(
                request,
                outcome="failed",
                reason_code=exc.code,
                user_message=self._service._feature_bundle_formatter.format_apply_failure(
                    failed_bundle,
                    detail=f"{exc.code}: {exc.message}",
                ),
                internal_summary=f"Confirmation {confirmation.confirmation_id} failed while applying feature bundle {failed_bundle.bundle_id}: {exc.code}.",
                retryable=False,
                command_label="/confirm",
                activity_state="provider_failed",
                confirmation_used=True,
                telemetry={
                    "feature_bundle_id": failed_bundle.bundle_id,
                    "feature_bundle_state": failed_bundle.state,
                    "feature_bundle": failed_bundle.to_payload(),
                },
            )
        applied_bundle = applying_bundle.with_state(
            "applied",
            updated_at=self._service._now_iso(),
            applied_files=tuple(applied_files),
            apply_summary=f"Applied {len(applied_files)} editable files.",
        )
        self._service.set_active_feature_bundle(chat_id=chat_id, bundle=applied_bundle)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._feature_bundle_formatter.format_apply_success(applied_bundle),
            internal_summary=f"Confirmation {confirmation.confirmation_id} applied feature bundle {applied_bundle.bundle_id}.",
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "feature_bundle_id": applied_bundle.bundle_id,
                "feature_bundle_state": applied_bundle.state,
                "feature_bundle": applied_bundle.to_payload(),
            },
        )

    def _execute_legacy_chat_orchestration(
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
            batch_busy=False,
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
                project_id=self._generate_generated_project_id(),
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
                "generated_project_id": proposal.project_id,
                "generated_project_root": proposal.target_root,
                "generated_entrypoint_path": proposal.entrypoint_path,
                "bootstrap_proposal": proposal.to_payload(),
            },
        )

    def _execute_project_view(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="project.generated.view.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/projectview",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        project = self._service.active_generated_project_for_chat(chat_id=update.chat_id)
        if project is None:
            return self._result(
                request,
                outcome="success",
                reason_code="no_active_generated_project",
                user_message="No active generated project\nNext: Use /bootstrapproject and /bootstrapapprove to create one.",
                internal_summary="project.generated.view.read found no active generated project.",
                retryable=False,
                command_label="/projectview",
                activity_state="processing_command",
                telemetry={"generated_project": None},
            )
        lines = [
            "Active generated project",
            "",
            f"ID: {project.project_id}",
            f"Type: {project.project_type}",
            f"Root: {project.project_root}",
        ]
        if project.entrypoint_path:
            lines.append(f"Entrypoint: {project.entrypoint_path}")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(lines),
            internal_summary=f"project.generated.view.read returned {project.project_id}.",
            retryable=False,
            command_label="/projectview",
            activity_state="processing_command",
            telemetry={"generated_project": project.to_payload()},
        )

    def _execute_prod_project(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_project_arguments(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.project.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodproject",
            parsed_arguments=dict(parsed or {}),
            metadata={"argument_summary": "/prodproject [context]"},
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_project_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't set production project context.",
                        f"Reason: {error.reason if error is not None else 'Missing required context.'}",
                        "Next: " + (error.next_step if error is not None else 'Use /prodproject --title "name".'),
                    )
                ),
                internal_summary="production.project.query rejected invalid project-context syntax.",
                retryable=False,
                command_label="/prodproject",
                activity_state="processing_command",
            )
        project = self._service.establish_production_project(
            chat_id=update.chat_id,
            title=parsed.get("title", ""),
            engine_family=parsed.get("engine", "unknown"),
            milestone=parsed.get("milestone", "active production"),
        )
        reply = self._service.production_status_reply(chat_id=update.chat_id, mobile=True)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((f"Production project set to {project.project_title}.", reply)),
            internal_summary=f"production.project.query established project context {project.project_id}.",
            retryable=False,
            command_label="/prodproject",
            activity_state="processing_command",
            telemetry={
                "production_project_id": project.project_id,
                "production_project": project.to_payload(),
                "routed_capability_id": "production.project.query",
                "routed_command_label": "/prodproject",
            },
        )

    def _execute_prod_status(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_status_arguments(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodstatus",
            parsed_arguments=dict(parsed or {}),
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_status_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't summarize production state.",
                        f"Reason: {error.reason if error is not None else 'Unsupported focus.'}",
                        "Next: " + (error.next_step if error is not None else "Use /prodstatus [overview|blocked|changes|nodes|attention]."),
                    )
                ),
                internal_summary="production.read rejected invalid status syntax.",
                retryable=False,
                command_label="/prodstatus",
                activity_state="processing_command",
            )
        focus = parsed.get("focus", "overview")
        reply = self._service.production_status_reply(chat_id=update.chat_id, focus=focus)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"production.read returned {focus} production status.",
            retryable=False,
            command_label="/prodstatus",
            activity_state="processing_command",
            telemetry={"production_focus": focus, "routed_capability_id": "production.read", "routed_command_label": "/prodstatus"},
        )

    def _execute_prod_mobile(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodmobile",
            parsed_arguments={"mobile": True},
        )
        if scope_failure is not None:
            return scope_failure
        reply = self._service.production_status_reply(chat_id=update.chat_id, mobile=True)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="production.read returned mobile production status.",
            retryable=False,
            command_label="/prodmobile",
            activity_state="processing_command",
            telemetry={"production_mobile": True, "routed_capability_id": "production.read", "routed_command_label": "/prodmobile"},
        )

    def _execute_prod_priority(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_priority_arguments(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.control.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodpriority",
            parsed_arguments=dict(parsed or {}),
            metadata={"argument_summary": "/prodpriority [focus]"},
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_priority_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't update the production priority.",
                        f"Reason: {error.reason if error is not None else 'Missing priority title.'}",
                        "Next: " + (error.next_step if error is not None else 'Use /prodpriority --title "focus".'),
                    )
                ),
                internal_summary="production.control.query rejected invalid priority syntax.",
                retryable=False,
                command_label="/prodpriority",
                activity_state="processing_command",
            )
        project = self._service.set_production_priority(
            chat_id=update.chat_id,
            title=parsed.get("title", ""),
            category=parsed.get("category", "systems_tools"),
            node_hint=parsed.get("node", ""),
        )
        reply = self._service.production_status_reply(chat_id=update.chat_id, mobile=True)
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((f"Updated production priority to {parsed.get('title', '')}.", reply)),
            internal_summary=f"production.control.query updated priority for project {project.project_id}.",
            retryable=False,
            command_label="/prodpriority",
            activity_state="processing_command",
            telemetry={
                "production_action": "set_priority",
                "production_category": parsed.get("category", "systems_tools"),
                "routed_capability_id": "production.control.query",
                "routed_command_label": "/prodpriority",
            },
        )

    def _execute_prod_pause(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_pause_resume_arguments(argument, command="/prodpause")
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.control.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodpause",
            parsed_arguments=dict(parsed or {}),
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_pause_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't pause that production target.",
                        f"Reason: {error.reason if error is not None else 'Missing target.'}",
                        "Next: " + (error.next_step if error is not None else "Use /prodpause [validation|followup|category]."),
                    )
                ),
                internal_summary="production.control.query rejected invalid pause syntax.",
                retryable=False,
                command_label="/prodpause",
                activity_state="processing_command",
            )
        reply = self._service.pause_production_target(chat_id=update.chat_id, target=parsed.get("target", "validation"))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"production.control.query paused target {parsed.get('target', 'validation')}.",
            retryable=False,
            command_label="/prodpause",
            activity_state="processing_command",
            telemetry={"production_action": "pause", "production_target": parsed.get("target", "validation"), "routed_capability_id": "production.control.query", "routed_command_label": "/prodpause"},
        )

    def _execute_prod_resume(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_pause_resume_arguments(argument, command="/prodresume")
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.control.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodresume",
            parsed_arguments=dict(parsed or {}),
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_resume_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't resume that production target.",
                        f"Reason: {error.reason if error is not None else 'Missing target.'}",
                        "Next: " + (error.next_step if error is not None else "Use /prodresume [validation|followup|category]."),
                    )
                ),
                internal_summary="production.control.query rejected invalid resume syntax.",
                retryable=False,
                command_label="/prodresume",
                activity_state="processing_command",
            )
        reply = self._service.resume_production_target(chat_id=update.chat_id, target=parsed.get("target", "validation"))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"production.control.query resumed target {parsed.get('target', 'validation')}.",
            retryable=False,
            command_label="/prodresume",
            activity_state="processing_command",
            telemetry={"production_action": "resume", "production_target": parsed.get("target", "validation"), "routed_capability_id": "production.control.query", "routed_command_label": "/prodresume"},
        )

    def _execute_prod_assign(self, *, update: TelegramInboundMessage, snapshot: ControllerSnapshot, argument: str) -> CapabilityExecutionResult:
        parsed, error = parse_prod_assign_arguments(argument)
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="production.control.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/prodassign",
            parsed_arguments=dict(parsed or {}),
            metadata={"argument_summary": "/prodassign [assignment]"},
        )
        if scope_failure is not None:
            return scope_failure
        if error is not None or parsed is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="production_assign_usage_invalid",
                user_message="\n".join(
                    (
                        "Couldn't assign that production work.",
                        f"Reason: {error.reason if error is not None else 'Missing target.'}",
                        "Next: " + (error.next_step if error is not None else "Use /prodassign --target <node|validator|another>."),
                    )
                ),
                internal_summary="production.control.query rejected invalid assign syntax.",
                retryable=False,
                command_label="/prodassign",
                activity_state="processing_command",
            )
        reply = self._service.assign_production_work(
            chat_id=update.chat_id,
            target=parsed.get("target", "validator"),
            category=parsed.get("category", ""),
            title=parsed.get("title", ""),
        )
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"production.control.query assigned work using target {parsed.get('target', 'validator')}.",
            retryable=False,
            command_label="/prodassign",
            activity_state="processing_command",
            telemetry={"production_action": "assign", "production_target": parsed.get("target", "validator"), "routed_capability_id": "production.control.query", "routed_command_label": "/prodassign"},
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
        generated_project = GeneratedProjectRecord(
            project_id=completed.project_id,
            project_type=completed.project_type,
            project_root=completed.target_root,
            entrypoint_path=completed.entrypoint_path,
            created_at_utc=completed.updated_at,
            status="active",
        )
        self._service.set_active_generated_project(chat_id=update.chat_id, project=generated_project)
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
                "generated_project": generated_project.to_payload(),
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
    def _generate_generated_project_id() -> str:
        return f"GP-{secrets.token_hex(3).upper()}"

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
        batch_busy: bool,
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
        if routed_action == "/projectview":
            return self._execute_project_view(update=update, snapshot=snapshot)
        if routed_action == "/contexts":
            return self._execute_contexts(update=update, snapshot=snapshot)
        if routed_action == "/help":
            return self._execute_help(update=update, snapshot=snapshot)
        if routed_action == "/ask":
            return self._execute_provider_query(
                update=update,
                snapshot=snapshot,
                command_label="/ask",
                prompt=message,
                response_style="concise",
                batch_busy=batch_busy,
            )
        if routed_action == "/askd":
            return self._execute_provider_query(
                update=update,
                snapshot=snapshot,
                command_label="/askd",
                prompt=message,
                response_style="detailed",
                batch_busy=batch_busy,
            )
        if routed_action == "/asklast":
            return self._execute_provider_query_with_latest_context(
                update=update,
                snapshot=snapshot,
                prompt=message,
                batch_busy=batch_busy,
            )
        if routed_action == "/askctx":
            return self._execute_provider_query_with_selected_context(
                update=update,
                snapshot=snapshot,
                argument=message,
                batch_busy=batch_busy,
            )
        if routed_action == "/run":
            return self._execute_run_command(update=update, snapshot=snapshot, argument=message)
        if routed_action == "/test":
            return self._execute_test_command(update=update, snapshot=snapshot, argument=message)
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
            try:
                parsed = self._load_prepared_patch_command(
                    chat_id=update.chat_id,
                    argument=argument,
                    original_error=exc,
                )
            except FileMutatorError as prepared_error:
                return self._file_mutation_error_result(
                    request=request,
                    error=prepared_error,
                    relative_path=argument.splitlines()[0].strip().replace("\\", "/") if argument.strip() else "",
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

    def _execute_file_patch_last(
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
            original_command="/patchlast",
            parsed_arguments={},
            metadata={"argument_summary": "/patchlast [path hidden]"},
        )
        relative_path = argument.splitlines()[0].strip().replace("\\", "/") if argument.strip() else ""
        if not relative_path:
            return self._file_mutation_error_result(
                request=request,
                error=FileMutatorError("missing_file_path", "Provide a relative file path as the first line of the command."),
                relative_path="",
                command_label="/patchlast",
                confirmation_id="",
            )
        extra_lines = [line.strip() for line in argument.splitlines()[1:] if line.strip()]
        if extra_lines:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="patchlast_argument_invalid",
                user_message="Can't use /patchlast right now.\nReason: Provide only the explicit relative path.\nNext: Use /patchlast <relative_path>.",
                internal_summary="/patchlast rejected because extra mutation content was provided.",
                retryable=False,
                command_label="/patchlast",
                activity_state="processing_command",
            )
        prepared_argument = self._service.consume_pending_patch_draft(chat_id=update.chat_id, relative_path=relative_path)
        if not prepared_argument:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="missing_prepared_patch",
                user_message=(
                    "Can't use /patchlast right now.\n"
                    "Reason: No recent patch-eligible edit suggestion is available.\n"
                    "Next: Use /askctx <context_id> <change request> or /asklast <change request> first."
                ),
                internal_summary=f"/patchlast rejected because no recent patch-eligible suggestion was available for {relative_path}.",
                retryable=False,
                command_label="/patchlast",
                activity_state="processing_command",
            )
        try:
            parsed = parse_patch_command(prepared_argument)
        except FileMutatorError as exc:
            return self._file_mutation_error_result(
                request=request,
                error=exc,
                relative_path=relative_path,
                command_label="/patchlast",
                confirmation_id="",
            )

        return self._execute_pending_file_mutation(
            update=update,
            snapshot=snapshot,
            capability_id="file.patch.write",
            command_label="/patchlast",
            relative_path=parsed.relative_path,
            raw_argument=parsed.raw_argument,
            confirmation_preview=summarize_patch_request(parsed),
            operator_reason=parsed.operator_reason,
            expected_base_hash=parsed.expected_base_hash,
        )

    def _load_prepared_patch_command(
        self,
        *,
        chat_id: str,
        argument: str,
        original_error: FileMutatorError,
    ):
        if original_error.code not in {"missing_mutation_body", "missing_patch_sections"}:
            raise original_error
        relative_path = argument.splitlines()[0].strip().replace("\\", "/")
        if not relative_path:
            raise original_error
        prepared_argument = self._service.consume_pending_patch_draft(chat_id=chat_id, relative_path=relative_path)
        if not prepared_argument:
            raise FileMutatorError(
                "missing_prepared_patch",
                f"No prepared patch is available for {relative_path}.",
            )
        return parse_patch_command(prepared_argument)

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
        prompt = " ".join(prompt.split())
        context_entry = self._service.latest_context_for_chat(chat_id=update.chat_id)
        last_run = self._service.latest_run_for_chat(chat_id=update.chat_id)
        request = self._build_request(
            capability_id="ask.provider_query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/asklast",
            parsed_arguments={"prompt": prompt},
            metadata={"argument_summary": "/asklast [prompt hidden]", "response_style": "concise"},
        )
        if not prompt:
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
        bounded_run_result = self._maybe_execute_bounded_last_run_edit_plan(
            request=request,
            update=update,
            command_label="/asklast",
            prompt=prompt,
            last_run=last_run,
        )
        if bounded_run_result is not None:
            return bounded_run_result
        if context_entry is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="context_not_found",
                user_message=(
                    "Can't use /asklast right now.\n"
                    "Reason: No recent run result is available for improvement and no buffered context is available.\n"
                    "Next: Use /run <approved command> first or /askctx <context_id> <change request>."
                ),
                internal_summary="/asklast rejected because no recent run result or buffered context was available.",
                retryable=False,
                command_label="/asklast",
                activity_state="processing_command",
                ask_status="/asklast invalid: no recent run result or buffered context.",
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

    def _execute_data(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="data.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/data",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        value = argument.strip()
        if not value:
            reply = self._service._build_data_list_reply(limit=8).reply
        elif value.isdigit():
            limit = self._parse_data_limit(value)
            if limit is None:
                return self._result(
                    request,
                    outcome="invalid_request",
                    reason_code="invalid_data_limit",
                    user_message="Couldn't parse that data command.\nNext: Use /data, /data <record_id>, or /data <1-20>.",
                    internal_summary="/data rejected because the limit argument was invalid.",
                    retryable=False,
                    command_label="/data",
                    activity_state="processing_command",
                )
            reply = self._service._build_data_list_reply(limit=limit).reply
        else:
            reply = self._service._build_data_record_reply(record_id=value).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="data.read returned durable captured data records.",
            retryable=False,
            command_label="/data",
            activity_state="processing_command",
        )

    def _execute_data_search(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="data.search",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasearch",
            parsed_arguments={"query": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        filters, limit, error = parse_data_search_arguments(argument)
        if filters is None:
            return self._result(
                request,
                outcome="invalid_request",
                reason_code="invalid_data_search",
                user_message="\n".join(
                    (
                        "Couldn't parse that data search.",
                        f"Reason: {(error.reason if error is not None else 'Invalid data-search filters.')}",
                        f"Next: {(error.next_step if error is not None else 'Use /datasearch --type chain_step --chain-id CH-... [--limit 8].')}",
                    )
                ),
                internal_summary="/datasearch rejected because the filter argument was invalid.",
                retryable=False,
                command_label="/datasearch",
                activity_state="processing_command",
            )
        reply = self._service._build_data_search_reply(filters=filters, limit=limit).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="data.search returned filtered durable data records.",
            retryable=False,
            command_label="/datasearch",
            activity_state="processing_command",
        )

    def _execute_data_label(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="data.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datalabel",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_data_label_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datalabel", title="Couldn't parse that data label.", error=error)
        try:
            state = self._service.label_data_record(record_id=parsed["record_id"], label=parsed["label"])
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datalabel", title="Couldn't label that record.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Record {state.record_id} labeled {state.primary_label}.",
            internal_summary=f"data.curation labeled {state.record_id} as {state.primary_label}.",
            retryable=False,
            command_label="/datalabel",
            activity_state="processing_command",
        )

    def _execute_data_unlabel(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="data.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/dataunlabel",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_data_unlabel_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/dataunlabel", title="Couldn't parse that data unlabel.", error=error)
        try:
            state = self._service.unlabel_data_record(record_id=parsed["record_id"], expected_label=parsed.get("label", ""))
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/dataunlabel", title="Couldn't clear that record label.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Cleared curation label for {state.record_id}.",
            internal_summary=f"data.curation cleared label for {state.record_id}.",
            retryable=False,
            command_label="/dataunlabel",
            activity_state="processing_command",
        )

    def _execute_data_tag(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="data.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datatag",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_data_tag_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datatag", title="Couldn't parse that data tag.", error=error)
        try:
            state = self._service.tag_data_record(record_id=parsed["record_id"], tag=parsed["tag"])
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datatag", title="Couldn't tag that record.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=f"Record {state.record_id} tagged: {', '.join(state.tags)}",
            internal_summary=f"data.curation added tag to {state.record_id}.",
            retryable=False,
            command_label="/datatag",
            activity_state="processing_command",
        )

    def _execute_datasets(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasets",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        if argument.strip():
            return self._invalid_dataset_request(request=request, command_label="/datasets", title="Couldn't parse that datasets command.", reason="/datasets does not accept arguments.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasets_reply().reply,
            internal_summary="dataset.read listed curated datasets.",
            retryable=False,
            command_label="/datasets",
            activity_state="processing_command",
        )

    def _execute_dataset(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        return self._execute_dataset_read_like(update=update, snapshot=snapshot, argument=argument, command_label="/dataset")

    def _execute_dataset_records(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        return self._execute_dataset_read_like(update=update, snapshot=snapshot, argument=argument, command_label="/datasetrecords")

    def _execute_dataset_summary(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        return self._execute_dataset_read_like(update=update, snapshot=snapshot, argument=argument, command_label="/datasetsummary")

    def _execute_dataset_read_like(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        command_label: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        dataset_id, error = parse_dataset_id_argument(argument, command=command_label)
        if dataset_id is None:
            return self._invalid_dataset_request(request=request, command_label=command_label, title=f"Couldn't parse that {command_label} command.", error=error)
        if command_label == "/dataset":
            reply = self._service._build_dataset_reply(dataset_id=dataset_id).reply
        elif command_label == "/datasetrecords":
            reply = self._service._build_dataset_records_reply(dataset_id=dataset_id).reply
        else:
            reply = self._service._build_dataset_summary_reply(dataset_id=dataset_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"dataset.read handled {command_label} for {dataset_id}.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _execute_dataset_create(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasetcreate",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_create_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetcreate", title="Couldn't parse that dataset create.", error=error)
        allow_empty = str(parsed.get("allow-empty", "")).strip().lower() in {"1", "true", "yes"}
        filters = {key.replace("-", "_"): value for key, value in parsed.items() if key not in {"title", "description", "allow-empty"}}
        try:
            dataset = self._service.create_dataset_from_filters(
                title=parsed.get("title", ""),
                description=parsed.get("description", ""),
                filters=filters,
                allow_empty=allow_empty,
            )
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datasetcreate", title="Couldn't create that dataset.", reason=str(exc))
        reply = self._service._build_dataset_reply(dataset_id=dataset.dataset_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((reply, f"Next: Use /datasetrecords {dataset.dataset_id}, /datasetsummary {dataset.dataset_id}, /datasetsplit {dataset.dataset_id} --mode deterministic --train 80 --eval 20, or /datasetexport {dataset.dataset_id} --format jsonl.")),
            internal_summary=f"dataset.curation created {dataset.dataset_id}.",
            retryable=False,
            command_label="/datasetcreate",
            activity_state="processing_command",
        )

    def _execute_dataset_add(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        return self._execute_dataset_record_mutation(update=update, snapshot=snapshot, argument=argument, command_label="/datasetadd")

    def _execute_dataset_remove(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        return self._execute_dataset_record_mutation(update=update, snapshot=snapshot, argument=argument, command_label="/datasetremove")

    def _execute_dataset_record_mutation(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        command_label: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_record_pair(argument, command=command_label)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label=command_label, title=f"Couldn't parse that {command_label} command.", error=error)
        try:
            if command_label == "/datasetadd":
                dataset, created = self._service.add_record_to_dataset(dataset_id=parsed["dataset_id"], record_id=parsed["record_id"])
                action = "Added" if created else "Record already present in"
                reply = "\n".join((f"{action} {parsed['record_id']} to {dataset.dataset_id}.", self._service._build_dataset_summary_reply(dataset_id=dataset.dataset_id).reply))
            else:
                dataset = self._service.remove_record_from_dataset(dataset_id=parsed["dataset_id"], record_id=parsed["record_id"])
                reply = "\n".join((f"Removed {parsed['record_id']} from {dataset.dataset_id}.", self._service._build_dataset_summary_reply(dataset_id=dataset.dataset_id).reply))
        except ValueError as exc:
            title = "Couldn't update that dataset membership."
            return self._invalid_dataset_request(request=request, command_label=command_label, title=title, reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"dataset.curation handled {command_label} for {parsed['dataset_id']}.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _execute_dataset_label(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasetlabel",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_label_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetlabel", title="Couldn't parse that dataset label.", error=error)
        try:
            dataset, count = self._service.label_dataset_records(dataset_id=parsed["dataset_id"], label=parsed["label"])
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datasetlabel", title="Couldn't label that dataset.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((f"Relabeled {count} record(s) in {dataset.dataset_id} as {parsed['label']}.", self._service._build_dataset_summary_reply(dataset_id=dataset.dataset_id).reply)),
            internal_summary=f"dataset.curation relabeled members of {dataset.dataset_id}.",
            retryable=False,
            command_label="/datasetlabel",
            activity_state="processing_command",
        )

    def _execute_dataset_add_filter(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.curation.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasetaddfilter",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_add_filter_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetaddfilter", title="Couldn't parse that dataset addfilter.", error=error)
        dataset_id = parsed.pop("dataset_id", "")
        filters = {key.replace("-", "_"): value for key, value in parsed.items()}
        try:
            dataset, added = self._service.add_dataset_records_by_filter(dataset_id=dataset_id, filters=filters)
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datasetaddfilter", title="Couldn't add those filtered records.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((f"Added {added} record(s) to {dataset.dataset_id}.", self._service._build_dataset_summary_reply(dataset_id=dataset.dataset_id).reply)),
            internal_summary=f"dataset.curation bulk-added records to {dataset.dataset_id}.",
            retryable=False,
            command_label="/datasetaddfilter",
            activity_state="processing_command",
        )

    def _execute_dataset_split(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.split.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasetsplit",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_split_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetsplit", title="Couldn't parse that dataset split.", error=error)
        train = self._parse_percentage(parsed.get("train", ""))
        eval_percent = self._parse_percentage(parsed.get("eval", ""))
        holdout = self._parse_percentage(parsed.get("holdout", ""), required=False)
        if train is None or eval_percent is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetsplit", title="Couldn't parse that dataset split.", reason="Train and eval percentages must be integers from 0 to 100.")
        holdout_percent = holdout if holdout is not None else max(0, 100 - train - eval_percent)
        try:
            dataset = self._service.assign_dataset_splits(
                dataset_id=parsed.get("dataset_id", ""),
                mode=parsed.get("mode", "deterministic"),
                train_percent=train,
                eval_percent=eval_percent,
                holdout_percent=holdout_percent,
            )
        except ValueError as exc:
            return self._invalid_dataset_request(request=request, command_label="/datasetsplit", title="Couldn't assign dataset splits.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((f"Assigned deterministic splits for {dataset.dataset_id}.", self._service._build_dataset_summary_reply(dataset_id=dataset.dataset_id).reply)),
            internal_summary=f"dataset.split assigned deterministic splits for {dataset.dataset_id}.",
            retryable=False,
            command_label="/datasetsplit",
            activity_state="processing_command",
        )

    def _execute_dataset_export(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="dataset.export.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasetexport",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_dataset_export_arguments(argument)
        if parsed is None:
            return self._invalid_dataset_request(request=request, command_label="/datasetexport", title="Couldn't parse that dataset export.", error=error)
        try:
            export = self._service.export_dataset(
                dataset_id=parsed.get("dataset_id", ""),
                export_format=parsed.get("format", "jsonl"),
                split=parsed.get("split", ""),
            )
        except (ValueError, DatasetExportError) as exc:
            return self._invalid_dataset_request(request=request, command_label="/datasetexport", title="Couldn't export that dataset.", reason=str(exc))
        lines = [
            f"Exported {export.dataset_id} to {export.export_format.upper()}.",
            f"Records: {export.record_count}",
            f"Split: {export.split or 'all'}",
            f"File: {export.file_path}",
        ]
        if export.view_shapes:
            lines.append(f"Views: {', '.join(export.view_shapes)}")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(lines),
            internal_summary=f"dataset.export wrote {export.file_path}.",
            retryable=False,
            command_label="/datasetexport",
            activity_state="processing_command",
        )

    def _execute_datasources(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasources",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        if argument.strip():
            return self._invalid_datasource_request(request=request, command_label="/datasources", title="Couldn't parse that datasources command.", reason="/datasources does not accept arguments.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasources_reply().reply,
            internal_summary="datasource.read listed datasource policy records.",
            retryable=False,
            command_label="/datasources",
            activity_state="processing_command",
        )

    def _execute_datasource_read_like(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        command_label: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        source_id, error = parse_datasource_id_argument(argument, command=command_label)
        if source_id is None:
            return self._invalid_datasource_request(request=request, command_label=command_label, title=f"Couldn't parse that {command_label} command.", error=error)
        reply = self._service._build_datasource_reply(source_id=source_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"datasource.read handled {command_label} for {source_id}.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _execute_datasource_summary(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourcesummary",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        if argument.strip():
            return self._invalid_datasource_request(request=request, command_label="/datasourcesummary", title="Couldn't parse that datasource summary command.", reason="/datasourcesummary does not accept arguments.")
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasource_summary_reply().reply,
            internal_summary="datasource.read summarized datasource policy state.",
            retryable=False,
            command_label="/datasourcesummary",
            activity_state="processing_command",
        )

    def _execute_datasource_query(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourcequery",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_query_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourcequery", title="Couldn't parse that datasource query.", error=error)
        rows = self._service.list_source_policies(
            usage_class=parsed.get("usage", ""),
            review_status=parsed.get("review", ""),
            status=parsed.get("status", ""),
            source_type=parsed.get("type", ""),
            tag=parsed.get("tag", ""),
            operation=parsed.get("operation", ""),
        )
        if not rows:
            details = " ".join(f"{key}={value}" for key, value in parsed.items()) or "no filters"
            message = "\n".join(("Datasource query", f"No datasource policies matched: {details}"))
        else:
            message = self._service._build_datasources_reply(records=rows).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=message,
            internal_summary=f"datasource.policy.query filtered {len(rows)} datasource record(s).",
            retryable=False,
            command_label="/datasourcequery",
            activity_state="processing_command",
        )

    def _execute_datasource_create(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourcecreate",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_create_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourcecreate", title="Couldn't parse that datasource create.", error=error)
        try:
            record = self._service.create_source_policy(
                source_name=parsed.get("name", ""),
                source_type=parsed.get("type", ""),
                source_locator=parsed.get("locator", ""),
                usage_class=parsed.get("usage", "requires_review"),
                status=parsed.get("status", "draft"),
                review_status=parsed.get("review", "draft"),
                owner=parsed.get("owner", ""),
                source_scope=parsed.get("scope", ""),
                collection_method_class=parsed.get("collection", "manual_declaration"),
                policy_notes=parsed.get("note", ""),
                content_license_note=parsed.get("license-note", ""),
                robots_note=parsed.get("robots-note", ""),
                terms_note=parsed.get("terms-note", ""),
                retention_policy=parsed.get("retention", ""),
                training_eligibility_reason=parsed.get("training-reason", ""),
                blocked_reason=parsed.get("blocked-reason", ""),
                review_required=self._parse_bool(parsed.get("review-required", "true"), default=True),
                tags=self._split_csv(parsed.get("tags", "")),
                provenance_requirements=self._split_pipe(parsed.get("provenance", "")),
                allowed_operations=self._split_csv(parsed.get("operations", "")),
            )
        except ValueError as exc:
            return self._invalid_datasource_request(request=request, command_label="/datasourcecreate", title="Couldn't create that datasource policy.", reason=str(exc))
        reply = self._service._build_datasource_reply(source_id=record.source_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((reply, f"Next: Use /datasourcereview {record.source_id} pending_review, /datasourceallow {record.source_id} retrieval_only, or /datasourceblock {record.source_id} --reason \"text\".")),
            internal_summary=f"datasource.policy.query created {record.source_id}.",
            retryable=False,
            command_label="/datasourcecreate",
            activity_state="processing_command",
        )

    def _execute_datasource_update(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourceupdate",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_update_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourceupdate", title="Couldn't parse that datasource update.", error=error)
        try:
            record = self._service.update_source_policy(
                source_id=parsed.get("source_id", ""),
                source_name=parsed.get("name"),
                source_type=parsed.get("type"),
                source_locator=parsed.get("locator"),
                usage_class=parsed.get("usage"),
                status=parsed.get("status"),
                owner=parsed.get("owner"),
                source_scope=parsed.get("scope"),
                collection_method_class=parsed.get("collection"),
                policy_notes=parsed.get("note"),
                content_license_note=parsed.get("license-note"),
                robots_note=parsed.get("robots-note"),
                terms_note=parsed.get("terms-note"),
                retention_policy=parsed.get("retention"),
                training_eligibility_reason=parsed.get("training-reason"),
                blocked_reason=parsed.get("blocked-reason"),
                review_required=self._parse_optional_bool(parsed.get("review-required")),
                tags=self._split_csv(parsed.get("tags", "")) if "tags" in parsed else None,
                provenance_requirements=self._split_pipe(parsed.get("provenance", "")) if "provenance" in parsed else None,
                allowed_operations=self._split_csv(parsed.get("operations", "")) if "operations" in parsed else None,
            )
        except ValueError as exc:
            return self._invalid_datasource_request(request=request, command_label="/datasourceupdate", title="Couldn't update that datasource policy.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasource_reply(source_id=record.source_id).reply,
            internal_summary=f"datasource.policy.query updated {record.source_id}.",
            retryable=False,
            command_label="/datasourceupdate",
            activity_state="processing_command",
        )

    def _execute_datasource_review(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourcereview",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_review_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourcereview", title="Couldn't parse that datasource review.", error=error)
        try:
            record = self._service.review_source_policy(
                source_id=parsed.get("source_id", ""),
                review_status=parsed.get("review", ""),
                reviewer=parsed.get("reviewer", ""),
                note=parsed.get("note", ""),
            )
        except ValueError as exc:
            return self._invalid_datasource_request(request=request, command_label="/datasourcereview", title="Couldn't review that datasource policy.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasource_reply(source_id=record.source_id).reply,
            internal_summary=f"datasource.policy.query reviewed {record.source_id}.",
            retryable=False,
            command_label="/datasourcereview",
            activity_state="processing_command",
        )

    def _execute_datasource_block(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourceblock",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_block_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourceblock", title="Couldn't parse that datasource block.", error=error)
        try:
            record = self._service.block_source_policy(
                source_id=parsed.get("source_id", ""),
                reason=parsed.get("reason", ""),
                reviewer=parsed.get("reviewer", ""),
                note=parsed.get("note", ""),
            )
        except ValueError as exc:
            return self._invalid_datasource_request(request=request, command_label="/datasourceblock", title="Couldn't block that datasource policy.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasource_reply(source_id=record.source_id).reply,
            internal_summary=f"datasource.policy.query blocked {record.source_id}.",
            retryable=False,
            command_label="/datasourceblock",
            activity_state="processing_command",
        )

    def _execute_datasource_allow(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="datasource.policy.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/datasourceallow",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_datasource_allow_arguments(argument)
        if parsed is None:
            return self._invalid_datasource_request(request=request, command_label="/datasourceallow", title="Couldn't parse that datasource allow command.", error=error)
        try:
            record = self._service.set_source_policy_usage(
                source_id=parsed.get("source_id", ""),
                usage_class=parsed.get("usage", ""),
                reviewer=parsed.get("reviewer", ""),
                note=parsed.get("note", ""),
                training_eligibility_reason=parsed.get("training-reason"),
            )
        except ValueError as exc:
            return self._invalid_datasource_request(request=request, command_label="/datasourceallow", title="Couldn't update datasource usage.", reason=str(exc))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=self._service._build_datasource_reply(source_id=record.source_id).reply,
            internal_summary=f"datasource.policy.query set usage for {record.source_id}.",
            retryable=False,
            command_label="/datasourceallow",
            activity_state="processing_command",
        )

    def _execute_model_experiments(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="model.experiment.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/modelexperiments",
            parsed_arguments={},
        )
        if scope_failure is not None:
            return scope_failure
        reply = self._service._build_model_experiments_reply().reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary="model.experiment.read listed local experiments.",
            retryable=False,
            command_label="/modelexperiments",
            activity_state="processing_command",
        )

    def _execute_model_experiment_read_like(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        command_label: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="model.experiment.read",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        experiment_id, error = parse_model_experiment_id_argument(argument, command=command_label)
        if experiment_id is None:
            return self._invalid_model_experiment_request(request=request, command_label=command_label, title=f"Couldn't parse that {command_label} command.", error=error)
        if command_label == "/modelexperiment":
            reply = self._service._build_model_experiment_reply(experiment_id=experiment_id).reply
        else:
            reply = self._service._build_model_experiment_results_reply(experiment_id=experiment_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=reply,
            internal_summary=f"model.experiment.read handled {command_label} for {experiment_id}.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _execute_model_experiment_create(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="model.experiment.query",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command="/modelexperimentcreate",
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        parsed, error = parse_model_experiment_create_arguments(argument)
        if parsed is None:
            return self._invalid_model_experiment_request(request=request, command_label="/modelexperimentcreate", title="Couldn't parse that model experiment create.", error=error)
        try:
            experiment = self._service.create_model_experiment(
                title=parsed.get("title", ""),
                task_type=parsed.get("task", ""),
                dataset_id=parsed.get("dataset", ""),
                baseline=parsed.get("baseline", "rules"),
                adaptation_method=parsed.get("method", "char_bigram_knn_v1"),
                base_model=parsed.get("base-model", "rules"),
                train_split=parsed.get("train-split", "train"),
                eval_split=parsed.get("eval-split", "eval"),
                mode=parsed.get("mode", "advisory"),
                notes=parsed.get("notes", ""),
            )
        except ValueError as exc:
            return self._invalid_model_experiment_request(request=request, command_label="/modelexperimentcreate", title="Couldn't create that model experiment.", reason=str(exc))
        reply = self._service._build_model_experiment_reply(experiment_id=experiment.experiment_id).reply
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join((reply, f"Next: Use /modelexperimentstart {experiment.experiment_id} or /modelexperimentresults {experiment.experiment_id}.")),
            internal_summary=f"model.experiment.query created {experiment.experiment_id}.",
            retryable=False,
            command_label="/modelexperimentcreate",
            activity_state="processing_command",
        )

    def _execute_model_experiment_control(
        self,
        *,
        update: TelegramInboundMessage,
        snapshot: ControllerSnapshot,
        argument: str,
        command_label: str,
    ) -> CapabilityExecutionResult:
        request, _, _, scope_failure = self._prepare_capability_request(
            capability_id="model.experiment.control",
            snapshot=snapshot,
            chat_id=update.chat_id,
            requester_label=update.sender_label,
            original_command=command_label,
            parsed_arguments={"argument": argument.strip()},
        )
        if scope_failure is not None:
            return scope_failure
        experiment_id, error = parse_model_experiment_id_argument(argument, command=command_label)
        if experiment_id is None:
            return self._invalid_model_experiment_request(request=request, command_label=command_label, title=f"Couldn't parse that {command_label} command.", error=error)
        try:
            if command_label == "/modelexperimentstart":
                experiment = self._service.run_model_experiment(experiment_id=experiment_id)
                reply = self._service._build_model_experiment_results_reply(experiment_id=experiment.experiment_id).reply
                message = "\n".join((f"Completed experiment {experiment.experiment_id}.", reply))
            elif command_label == "/modelexperimentstop":
                experiment = self._service.stop_model_experiment(experiment_id=experiment_id)
                message = f"Stop requested for {experiment.experiment_id}."
            elif command_label == "/modelexperimentapprove":
                experiment = self._service.set_model_experiment_integration_status(experiment_id=experiment_id, integration_status="approved_for_advisory_use")
                message = f"Approved {experiment.experiment_id} for advisory use."
            else:
                experiment = self._service.set_model_experiment_integration_status(experiment_id=experiment_id, integration_status="rejected")
                message = f"Rejected {experiment.experiment_id} for advisory use."
        except ValueError as exc:
            return self._invalid_model_experiment_request(request=request, command_label=command_label, title=f"Couldn't complete {command_label}.", reason=str(exc))
        if command_label in {"/modelexperimentapprove", "/modelexperimentreject", "/modelexperimentstop"}:
            message = "\n".join((message, self._service._build_model_experiment_reply(experiment_id=experiment.experiment_id).reply))
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=message,
            internal_summary=f"model.experiment.control handled {command_label} for {experiment.experiment_id}.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    @staticmethod
    def _parse_percentage(value: str, *, required: bool = True) -> int | None:
        normalized = value.strip()
        if not normalized:
            return None if required else None
        if not normalized.isdigit():
            return None
        parsed = int(normalized)
        if parsed < 0 or parsed > 100:
            return None
        return parsed

    def _invalid_dataset_request(
        self,
        *,
        request: CapabilityExecutionRequest,
        command_label: str,
        title: str,
        error=None,
        reason: str = "",
    ) -> CapabilityExecutionResult:
        message_reason = reason or (error.reason if error is not None else "Invalid request.")
        next_step = error.next_step if error is not None else "Use /help to see the supported dataset commands."
        return self._result(
            request,
            outcome="invalid_request",
            reason_code="invalid_dataset_request",
            user_message="\n".join((title, f"Reason: {message_reason}", f"Next: {next_step}")),
            internal_summary=f"{command_label} rejected because the dataset request was invalid.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _invalid_datasource_request(
        self,
        *,
        request: CapabilityExecutionRequest,
        command_label: str,
        title: str,
        error=None,
        reason: str = "",
    ) -> CapabilityExecutionResult:
        message_reason = reason or (error.reason if error is not None else "Invalid request.")
        next_step = error.next_step if error is not None else "Use /help to see the supported datasource commands."
        return self._result(
            request,
            outcome="invalid_request",
            reason_code="invalid_datasource_request",
            user_message="\n".join((title, f"Reason: {message_reason}", f"Next: {next_step}")),
            internal_summary=f"{command_label} rejected because the datasource request was invalid.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    def _invalid_model_experiment_request(
        self,
        *,
        request: CapabilityExecutionRequest,
        command_label: str,
        title: str,
        error=None,
        reason: str = "",
    ) -> CapabilityExecutionResult:
        message_reason = reason or (error.reason if error is not None else "Invalid request.")
        next_step = error.next_step if error is not None else "Use /help to see the supported model experiment commands."
        return self._result(
            request,
            outcome="invalid_request",
            reason_code="invalid_model_experiment_request",
            user_message="\n".join((title, f"Reason: {message_reason}", f"Next: {next_step}")),
            internal_summary=f"{command_label} rejected because the model experiment request was invalid.",
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
        )

    @staticmethod
    def _split_csv(value: str) -> tuple[str, ...]:
        return tuple(item.strip() for item in value.split(",") if item.strip())

    @staticmethod
    def _split_pipe(value: str) -> tuple[str, ...]:
        return tuple(item.strip() for item in value.split("|") if item.strip())

    @staticmethod
    def _parse_bool(value: str, *, default: bool) -> bool:
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
        return default

    @classmethod
    def _parse_optional_bool(cls, value: str | None) -> bool | None:
        if value is None:
            return None
        return cls._parse_bool(value, default=True)

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
            "missing_prepared_patch": "Use /askctx or /asklast first, or include @@ FIND and @@ REPLACE blocks directly.",
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
            "missing_prepared_patch",
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
            "run_alias_argument_count_not_allowed": "Use /run main or /run main <repo-local target>.",
            "run_alias_entrypoint_missing": "Create the approved CLI scaffold first, then retry /run main.",
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
            "run_alias_argument_count_not_allowed",
            "run_alias_entrypoint_missing",
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
        last_run_record = self._build_last_run_record(command_result=command_result)
        base_telemetry = {
            "execution_command": command_result.request.command_text,
            "execution_command_summary": command_result.request.command_summary,
            "execution_scope": command_result.request.working_directory,
            "execution_output_summary": command_result.output_summary,
            "execution_first_issue": command_result.first_issue,
            "execution_target_root": last_run_record.target_root or "",
            "execution_entrypoint_path": last_run_record.entrypoint_path or "",
            "execution_stdout_preview": last_run_record.stdout_preview,
            "execution_stderr_preview": last_run_record.stderr_preview,
            "target_node_id": command_result.node.node_id,
            "target_node_name": command_result.node.display_name,
            "target_node_type": command_result.node.node_type,
            "target_node_transport": command_result.node.transport,
            "target_node_summary": node_summary,
        }
        context_entry = None
        if command_result.timed_out:
            if request.capability_id == "shell.command.run":
                self._service.set_latest_run_for_chat(chat_id=request.chat_id, record=last_run_record)
            self._service.record_feature_bundle_validation_result(
                chat_id=request.chat_id,
                command_text=command_result.request.command_summary,
                outcome="timed_out",
                output_summary=command_result.output_summary,
                first_issue=command_result.first_issue,
            )
            self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} timed out via bounded execution."
            lines = [
                f"Confirmation {confirmation.confirmation_id} approved.",
                f"Node: {node_summary}",
                f"Scope: {repo_label}",
                f"Command: {command_result.request.command_summary}",
                *((f"Target: {last_run_record.target_root}",) if last_run_record.target_root else ()),
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
            *((f"Target: {last_run_record.target_root}",) if last_run_record.target_root else ()),
            f"Exit code: {command_result.exit_code}",
            f"Summary: {command_result.output_summary}",
        ]
        if command_result.first_issue:
            lines.append(f"First issue: {command_result.first_issue}")
        if request.capability_id == "shell.command.run":
            self._service.set_latest_run_for_chat(chat_id=request.chat_id, record=last_run_record)
        self._service.record_feature_bundle_validation_result(
            chat_id=request.chat_id,
            command_text=command_result.request.command_summary,
            outcome=outcome,
            output_summary=command_result.output_summary,
            first_issue=command_result.first_issue,
        )
        if outcome == "success" and request.capability_id == "shell.command.run" and command_result.request.command_summary.startswith("main"):
            context_content = "\n".join(lines[1:])
            context_entry = self._service.create_context_buffer(
                source_capability_id="shell.command.run",
                source_command="/run",
                scope_type=request.scope.scope_type,
                source_summary=command_result.request.command_summary,
                content_kind="execution_result",
                normalized_content=context_content,
                content_preview=command_result.output_summary,
                size_class="summary",
                chat_id=request.chat_id,
                user_id=request.user_id,
                request_id=request.request_id,
            )
            lines.append(self._service._context_ready_note(context_entry))
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
            telemetry={
                **base_telemetry,
                "execution_summary": f"{command_result.request.command_summary} | exit {command_result.exit_code}",
                "execution_exit_code": command_result.exit_code,
                "last_run_record": last_run_record.to_payload() if request.capability_id == "shell.command.run" else {},
                "context_created_id": context_entry.context_id if context_entry is not None else "",
                "context_source_summary": context_entry.source_summary if context_entry is not None else "",
            },
        )

    def _build_last_run_record(self, *, command_result) -> LastRunRecord:
        command_summary = command_result.request.command_summary.strip()
        command_label = command_summary.split(maxsplit=1)[0] if command_summary else ""
        target_root: str | None = None
        if len(command_result.request.argv) > 2:
            target_root = str(command_result.request.argv[2]).strip().replace("\\", "/") or None
        elif command_label == "main" and command_summary == "main .":
            target_root = "."
        entrypoint_path: str | None = None
        if len(command_result.request.argv) > 1:
            entrypoint_path = str(command_result.request.argv[1]).strip().replace("\\", "/") or None
        stdout_preview = self._service._summarize_text(command_result.stdout.strip(), limit=240)
        stderr_preview = self._service._summarize_text(command_result.stderr.strip(), limit=240)
        is_patch_relevant = bool(
            command_label == "main"
            and entrypoint_path
            and (entrypoint_path == "src/main.py" or entrypoint_path.lower().endswith("/src/main.py"))
        )
        return LastRunRecord(
            command_label=command_label,
            target_root=target_root,
            entrypoint_path=entrypoint_path,
            argv=[str(token) for token in command_result.request.argv],
            exit_code=None if command_result.timed_out else command_result.exit_code,
            stdout_preview=stdout_preview,
            stderr_preview=stderr_preview,
            summary=command_result.output_summary,
            created_at_utc=command_result.completed_at,
            is_patch_relevant=is_patch_relevant,
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

        bounded_edit_result = self._maybe_execute_bounded_cli_edit_plan(
            request=request,
            update=update,
            command_label=command_label,
            prompt=prompt,
            selected_contexts=selected_contexts,
        )
        if bounded_edit_result is not None:
            return bounded_edit_result

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

    def _maybe_execute_bounded_cli_edit_plan(
        self,
        *,
        request: CapabilityExecutionRequest,
        update: TelegramInboundMessage,
        command_label: str,
        prompt: str,
        selected_contexts: tuple[BufferedContext, ...],
    ) -> CapabilityExecutionResult | None:
        if len(selected_contexts) != 1:
            return None
        context_entry = selected_contexts[0]
        plan = self._build_bounded_cli_edit_plan(prompt=prompt, context_entry=context_entry)
        if plan is None:
            return None
        relative_path, prepared_argument, user_message, plan_summary = plan
        self._service.save_pending_patch_draft(
            chat_id=update.chat_id,
            relative_path=relative_path,
            raw_argument=prepared_argument,
            summary=plan_summary,
            source_kind=context_entry.content_kind,
            source_context_id=context_entry.context_id,
        )
        ask_status = f"{command_label} prepared bounded patch for {relative_path}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message=user_message,
            internal_summary=ask_status,
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
            ask_status=ask_status,
            hide_content_in_summary=True,
            telemetry={
                "context_used_id": context_entry.context_id,
                "context_used_ids": context_entry.context_id,
                "context_source_summary": context_entry.source_summary,
                "patch_target_path": relative_path,
                "patch_plan_summary": plan_summary,
            },
        )

    def _maybe_execute_bounded_last_run_edit_plan(
        self,
        *,
        request: CapabilityExecutionRequest,
        update: TelegramInboundMessage,
        command_label: str,
        prompt: str,
        last_run: LastRunRecord | None,
    ) -> CapabilityExecutionResult | None:
        if last_run is None or not last_run.is_patch_relevant:
            return None
        relative_path = (last_run.entrypoint_path or "").strip().replace("\\", "/")
        if not relative_path:
            return None
        plan = self._build_bounded_cli_edit_plan_for_path(prompt=prompt, relative_path=relative_path)
        if plan is None:
            return None
        _, prepared_argument, user_message, plan_summary = plan
        response_lines = [f"Planned improvement for {relative_path}"]
        if last_run.summary:
            response_lines.extend(("Observed:", f"- last run: {last_run.summary}"))
        response_lines.extend(user_message.splitlines()[1:])
        self._service.save_pending_patch_draft(
            chat_id=update.chat_id,
            relative_path=relative_path,
            raw_argument=prepared_argument,
            summary=plan_summary,
            source_kind="execution_result",
            source_context_id="RUN",
        )
        ask_status = f"{command_label} prepared bounded patch for {relative_path} from the latest run."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(response_lines),
            internal_summary=ask_status,
            retryable=False,
            command_label=command_label,
            activity_state="processing_command",
            ask_status=ask_status,
            hide_content_in_summary=True,
            telemetry={
                "last_run_command_label": last_run.command_label,
                "last_run_target_root": last_run.target_root or "",
                "last_run_entrypoint_path": relative_path,
                "last_run_summary": last_run.summary,
                "patch_target_path": relative_path,
                "patch_plan_summary": plan_summary,
            },
        )

    def _build_bounded_cli_edit_plan(
        self,
        *,
        prompt: str,
        context_entry: BufferedContext,
    ) -> tuple[str, str, str, str] | None:
        relative_path = self._bounded_main_path_from_context(context_entry)
        return self._build_bounded_cli_edit_plan_for_path(prompt=prompt, relative_path=relative_path)

    def _build_bounded_cli_edit_plan_for_path(
        self,
        *,
        prompt: str,
        relative_path: str,
    ) -> tuple[str, str, str, str] | None:
        if not relative_path:
            return None
        current_content = self._read_repo_file_text(relative_path)
        if current_content is None:
            return None
        lowered_prompt = prompt.lower()
        if "logging" in lowered_prompt:
            return self._build_logging_cli_edit_plan(relative_path=relative_path, current_content=current_content)
        if "csv" in lowered_prompt:
            return self._build_csv_cli_edit_plan(relative_path=relative_path, current_content=current_content)
        if any(token in lowered_prompt for token in ("format", "error", "message")):
            return self._build_formatting_cli_edit_plan(relative_path=relative_path, current_content=current_content)
        return None

    @staticmethod
    def _bounded_main_path_from_context(context_entry: BufferedContext) -> str:
        source_summary = context_entry.source_summary.strip().replace("\\", "/")
        lowered = source_summary.lower()
        if context_entry.content_kind == "file_preview":
            if lowered == "src/main.py":
                return source_summary
            if lowered.startswith("generated/") and lowered.endswith("/src/main.py"):
                return source_summary
            return ""
        if context_entry.content_kind == "execution_result" and lowered.startswith("main"):
            parts = source_summary.split(maxsplit=1)
            if len(parts) == 1:
                return "src/main.py"
            project_root = parts[1].strip().replace("\\", "/")
            if project_root == ".":
                return "src/main.py"
            if project_root.lower().startswith("generated/"):
                return f"{project_root}/src/main.py"
        return ""

    def _read_repo_file_text(self, relative_path: str) -> str | None:
        _, target_path, _, resolve_code, _ = self._service.resolve_file_request(relative_path)
        if resolve_code != "file_target_ready" or not target_path:
            return None
        try:
            return Path(target_path).read_text(encoding="utf-8")
        except OSError:
            return None

    def _build_csv_cli_edit_plan(self, *, relative_path: str, current_content: str) -> tuple[str, str, str, str]:
        new_content = (
            "import csv\n"
            "from pathlib import Path\n"
            "import sys\n\n\n"
            "def main() -> int:\n"
            "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
            "    target = target.resolve()\n"
            "    if not target.exists() or not target.is_dir():\n"
            "        print(f\"Target is not a directory: {target}\")\n"
            "        return 1\n\n"
            "    rows: list[tuple[str, int]] = []\n"
            "    for path in sorted(candidate for candidate in target.iterdir() if candidate.is_file()):\n"
            "        rows.append((path.name, path.stat().st_size))\n\n"
            "    output_path = target / \"summary.csv\"\n"
            "    with output_path.open(\"w\", newline=\"\", encoding=\"utf-8\") as handle:\n"
            "        writer = csv.writer(handle)\n"
            "        writer.writerow((\"name\", \"size_bytes\"))\n"
            "        writer.writerows(rows)\n\n"
            "    print(f\"Scanned {len(rows)} files in {target}\")\n"
            "    print(f\"Wrote CSV: {output_path}\")\n"
            "    return 0\n\n\n"
            "if __name__ == \"__main__\":\n"
            "    raise SystemExit(main())\n"
        )
        prepared_argument = self._build_exact_patch_argument(
            relative_path=relative_path,
            operator_reason="add CSV writing to generated CLI scaffold",
            current_content=current_content,
            new_content=new_content,
        )
        user_message = "\n".join(
            (
                f"Planned update for {relative_path}",
                "Change:",
                "- iterate through files in the target directory",
                "- capture file names and sizes",
                "- write rows to summary.csv",
                "Next:",
                f"- use /patchlast {relative_path} to apply the update",
            )
        )
        return relative_path, prepared_argument, user_message, f"CSV writing support prepared for {relative_path}"

    def _build_logging_cli_edit_plan(self, *, relative_path: str, current_content: str) -> tuple[str, str, str, str]:
        new_content = (
            "import logging\n"
            "from pathlib import Path\n"
            "import sys\n\n\n"
            "logging.basicConfig(level=logging.INFO, format=\"[%(levelname)s] %(message)s\")\n"
            "logger = logging.getLogger(__name__)\n\n\n"
            "def main() -> int:\n"
            "    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(\".\")\n"
            "    logger.info(\"Scanning target: %s\", target.resolve())\n"
            "    print(f\"Scanning: {target}\")\n"
            "    return 0\n\n\n"
            "if __name__ == \"__main__\":\n"
            "    raise SystemExit(main())\n"
        )
        prepared_argument = self._build_exact_patch_argument(
            relative_path=relative_path,
            operator_reason="add bounded logging to generated CLI scaffold",
            current_content=current_content,
            new_content=new_content,
        )
        user_message = "\n".join(
            (
                f"Planned update for {relative_path}",
                "Change:",
                "- configure basic INFO logging",
                "- log the resolved scan target before the existing print output",
                "- preserve the current single-file CLI entrypoint structure",
                "Next:",
                f"- use /patchlast {relative_path} to apply the update",
            )
        )
        return relative_path, prepared_argument, user_message, f"Logging support prepared for {relative_path}"

    def _build_formatting_cli_edit_plan(self, *, relative_path: str, current_content: str) -> tuple[str, str, str, str]:
        if "summary.csv" in current_content:
            new_content = current_content.replace(
                '    print(f"Wrote CSV: {output_path}")\n',
                '    print(f"CSV rows written: {len(rows)}")\n    print(f"Wrote CSV: {output_path}")\n',
            )
        else:
            new_content = current_content.replace(
                '    print(f"Scanning: {target}")\n',
                '    print(f"Scanning directory: {target.resolve()}")\n',
            )
        prepared_argument = self._build_exact_patch_argument(
            relative_path=relative_path,
            operator_reason="improve generated CLI output formatting",
            current_content=current_content,
            new_content=new_content,
        )
        user_message = "\n".join(
            (
                f"Planned improvement for {relative_path}",
                "Change:",
                "- keep the current CLI entrypoint structure",
                "- make the operator-facing output easier to read",
                "- preserve the edit loop as an explicit /patchlast step",
                "Next:",
                f"- use /patchlast {relative_path} to apply the update",
            )
        )
        return relative_path, prepared_argument, user_message, f"Output formatting update prepared for {relative_path}"

    @staticmethod
    def _build_exact_patch_argument(
        *,
        relative_path: str,
        operator_reason: str,
        current_content: str,
        new_content: str,
    ) -> str:
        return "\n".join(
            (
                relative_path,
                f"Reason: {operator_reason}",
                "@@ FIND",
                current_content.rstrip("\n"),
                "@@ REPLACE",
                new_content.rstrip("\n"),
            )
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
        if confirmation.capability_id == "build.feature.apply.query":
            return self._execute_confirmed_feature_bundle_apply(
                request=request,
                confirmation=confirmation,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "node.dispatch.query":
            return self._execute_confirmed_dispatch_command(
                request=request,
                confirmation=confirmation,
                snapshot=snapshot,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "evaluation.session.start":
            return self._execute_confirmed_eval_start(
                request=request,
                confirmation=confirmation,
                chat_id=chat_id,
            )
        if confirmation.capability_id == "task.chain.start":
            return self._execute_confirmed_chain_start(
                request=request,
                confirmation=confirmation,
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
        target_node_id = str(confirmation.metadata.get("target_node_id") or "").strip().lower()
        target_node = self._service.get_registered_node(target_node_id) if target_node_id else None
        repo_root = self._service._repo_configuration_state()[0]
        if target_node is not None and target_node.transport == "shared_directory" and target_node.repo_root.strip():
            repo_root = target_node.repo_root.strip()
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
        target_node_id = str(confirmation.metadata.get("target_node_id") or "").strip().lower()
        target_node = self._service.get_registered_node(target_node_id) if target_node_id else None
        repo_root = self._service._repo_configuration_state()[0]
        if target_node is not None and target_node.transport == "shared_directory" and target_node.repo_root.strip():
            repo_root = target_node.repo_root.strip()
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

    def _execute_confirmed_dispatch_command(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        payload_json = str(confirmation.metadata.get("dispatch_execution_payload_json") or "").strip()
        target_node_id = str(confirmation.metadata.get("target_node_id") or "").strip().lower()
        target_node = self._service.get_registered_node(target_node_id) if target_node_id else None
        if target_node is None:
            return self._result(
                request,
                outcome="failed",
                reason_code="dispatch_target_missing",
                user_message="Dispatch could not continue because the selected node is no longer registered.",
                internal_summary="node.dispatch.query failed because the selected node was missing at approval time.",
                retryable=True,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        try:
            local_request = self._request_from_confirmation_payload(payload_json)
        except (ValueError, json.JSONDecodeError):
            return self._result(
                request,
                outcome="failed",
                reason_code="dispatch_payload_invalid",
                user_message="Dispatch could not continue because the queued execution payload was invalid.",
                internal_summary="node.dispatch.query failed because the queued execution payload could not be reconstructed.",
                retryable=False,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        job_id = str(confirmation.metadata.get("dispatch_job_id") or "").strip().upper()
        record = self._build_dispatch_record_from_confirmation(
            confirmation=confirmation,
            target_node=target_node,
            local_request=local_request,
            job_id=job_id,
            chat_id=chat_id,
        )
        try:
            queued = self._service.queue_dispatch_job(record=record)
        except NodeDispatchError as exc:
            return self._result(
                request,
                outcome="failed",
                reason_code=exc.code,
                user_message=f"Dispatch could not be queued.\nReason: {exc.message}",
                internal_summary=f"node.dispatch.query failed queueing {job_id}: {exc.code}.",
                retryable=True,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and queued dispatch job {queued.job_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="dispatch_queued",
            user_message="\n".join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    f"Dispatch job: {queued.job_id}",
                    f"Target node: {queued.target_node_id} | {queued.target_node_name}",
                    f"Reason: {queued.routing_reason}",
                    f"Command: {queued.requested_command_summary}",
                    "Status: queued",
                    f"Next: Use /dispatchstatus {queued.job_id} to inspect progress.",
                )
            ),
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "dispatch_job_id": queued.job_id,
                "dispatch_status": queued.status,
                "dispatch_routing_reason": queued.routing_reason,
                "target_node_id": queued.target_node_id,
                "target_node_name": queued.target_node_name,
                "target_node_role": queued.target_node_role,
                "execution_summary": f"dispatch {queued.requested_command_summary} | queued",
            },
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
        if target_node.transport == "shared_directory":
            return self._queue_selected_remote_command(
                confirmation=confirmation,
                request=request,
                local_request=local_request,
                target_node=target_node,
                chat_id=chat_id,
            )
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

    def _execute_confirmed_eval_start(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        session_id = str(confirmation.metadata.get("evaluation_session_id") or "").strip().upper()
        session = self._service.get_evaluation_session(session_id)
        if session is None:
            return self._result(
                request,
                outcome="failed",
                reason_code="evaluation_session_not_found",
                user_message="Evaluation start could not continue because the session no longer exists.",
                internal_summary=f"evaluation.session.start failed because {session_id or '[missing]'} no longer exists.",
                retryable=False,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        started = self._service.start_evaluation_session(session.session_id)
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and started evaluation session {started.session_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    f"Evaluation session {started.session_id} started.",
                    f"Next: Use /evalstatus {started.session_id} while it runs.",
                )
            ),
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "evaluation_session_id": started.session_id,
                "evaluation_status": started.status,
            },
        )

    def _execute_confirmed_chain_start(
        self,
        *,
        request: CapabilityExecutionRequest,
        confirmation: PendingConfirmation,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        chain_id = str(confirmation.metadata.get("task_chain_id") or "").strip().upper()
        chain = self._service.get_task_chain(chain_id)
        if chain is None:
            return self._result(
                request,
                outcome="failed",
                reason_code="task_chain_not_found",
                user_message="Task chain start could not continue because the chain no longer exists.",
                internal_summary=f"task.chain.start failed because {chain_id or '[missing]'} no longer exists.",
                retryable=False,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        started = self._service.start_task_chain(chain.chain_id)
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and started task chain {started.chain_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="ok",
            user_message="\n".join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    f"Task chain {started.chain_id} started.",
                    f"Next: Use /chainstatus {started.chain_id} while it runs.",
                )
            ),
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={"task_chain_id": started.chain_id, "task_chain_status": started.status},
        )

    def _queue_selected_remote_command(
        self,
        *,
        confirmation: PendingConfirmation,
        request: CapabilityExecutionRequest,
        local_request: LocalCommandExecutionRequest,
        target_node,
        chat_id: str,
    ) -> CapabilityExecutionResult:
        job_id = self._service.next_dispatch_job_id()
        record = self._build_dispatch_record_from_confirmation(
            confirmation=confirmation,
            target_node=target_node,
            local_request=local_request,
            job_id=job_id,
            chat_id=chat_id,
            selection_mode="node_id",
            selector=target_node.node_id,
            routing_reason=str(confirmation.metadata.get("dispatch_routing_reason") or f"selected node {target_node.node_id}").strip(),
        )
        try:
            queued = self._service.queue_dispatch_job(record=record)
        except NodeDispatchError as exc:
            return self._result(
                request,
                outcome="failed",
                reason_code=exc.code,
                user_message=f"Dispatch could not be queued.\nReason: {exc.message}",
                internal_summary=f"{request.capability_id} could not queue remote execution: {exc.code}.",
                retryable=True,
                command_label="/confirm",
                activity_state="processing_command",
                confirmation_used=True,
            )
        self._service._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and queued dispatch job {queued.job_id}."
        return self._result(
            request,
            outcome="success",
            reason_code="dispatch_queued",
            user_message="\n".join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    f"Dispatch job: {queued.job_id}",
                    f"Target node: {queued.target_node_id} | {queued.target_node_name}",
                    f"Command: {queued.requested_command_summary}",
                    f"Reason: {queued.routing_reason}",
                    "Status: queued",
                    f"Next: Use /dispatchstatus {queued.job_id} to inspect progress.",
                )
            ),
            internal_summary=self._service._last_confirmation_result,
            retryable=False,
            command_label="/confirm",
            activity_state="processing_command",
            confirmation_used=True,
            telemetry={
                "dispatch_job_id": queued.job_id,
                "dispatch_status": queued.status,
                "dispatch_routing_reason": queued.routing_reason,
                "target_node_id": queued.target_node_id,
                "target_node_name": queued.target_node_name,
                "target_node_role": queued.target_node_role,
                "execution_summary": f"dispatch {queued.requested_command_summary} | queued",
            },
        )

    def _build_dispatch_record_from_confirmation(
        self,
        *,
        confirmation: PendingConfirmation,
        target_node,
        local_request: LocalCommandExecutionRequest,
        job_id: str,
        chat_id: str,
        selection_mode: str | None = None,
        selector: str | None = None,
        routing_reason: str | None = None,
    ):
        normalized_job_id = job_id.strip().upper() or self._service.next_dispatch_job_id()
        selection_mode_value = str(selection_mode or confirmation.metadata.get("dispatch_selection_mode") or "node_id").strip().lower()
        selector_value = str(selector or confirmation.metadata.get("dispatch_target_selector") or target_node.node_id).strip().lower()
        routing_reason_value = str(routing_reason or confirmation.metadata.get("dispatch_routing_reason") or f"explicit node {target_node.node_id}").strip()
        from .node_models import NodeDispatchRecord

        return NodeDispatchRecord(
            job_id=normalized_job_id,
            status="queued",
            requested_capability_id=local_request.capability_id,
            requested_command_label=str(confirmation.metadata.get("dispatch_requested_command_label") or ("/test" if local_request.command_kind == "test" else "/run")).strip(),
            requested_command_text=str(confirmation.metadata.get("dispatch_requested_command_text") or local_request.command_text).strip(),
            requested_command_summary=str(confirmation.metadata.get("dispatch_requested_command_summary") or local_request.command_summary).strip(),
            target_selection_mode=selection_mode_value,
            target_selector=selector_value,
            target_node_id=target_node.node_id,
            target_node_role=target_node.role,
            target_node_name=target_node.display_name,
            routing_reason=routing_reason_value,
            request_source="operator-console",
            requester_label=confirmation.requester_label,
            chat_id=chat_id,
            confirmation_required=True,
            confirmation_id=confirmation.confirmation_id,
            queued_at=self._service._now_iso(),
            result_summary="",
            failure_reason="",
            current_job_state="queued",
            execution_payload=self._serialize_local_request(local_request),
        )

    @staticmethod
    def _request_from_confirmation_payload(payload_json: str) -> LocalCommandExecutionRequest:
        payload = json.loads(payload_json)
        if not isinstance(payload, dict):
            raise ValueError("Dispatch payload must be a JSON object.")
        argv = payload.get("argv")
        return LocalCommandExecutionRequest(
            capability_id=str(payload.get("capability_id", "")).strip(),
            command_kind=str(payload.get("command_kind", "run")).strip(),  # type: ignore[arg-type]
            command_family=str(payload.get("command_family", "generic")).strip(),  # type: ignore[arg-type]
            command_text=str(payload.get("command_text", "")).strip(),
            command_summary=str(payload.get("command_summary", "")).strip(),
            working_directory=str(payload.get("working_directory", "")).strip(),
            timeout_seconds=float(payload.get("timeout_seconds", 20.0) or 20.0),
            operator_reason=str(payload.get("operator_reason", "")).strip(),
            expected_scope=str(payload.get("expected_scope", "")).strip(),
            argv=tuple(str(item) for item in (argv or ()) if str(item)),
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
                timeout_seconds=self._service._provider_timeout_seconds("ollama"),
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
        if not confirmation_used and command_label in {"/ask", "/askd", "/askctx", "/asklast"}:
            self._service.clear_pending_patch_draft(chat_id=chat_id)
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
        if not confirmation_used and command_label in {"/ask", "/askd", "/askctx", "/asklast"}:
            self._service.clear_pending_patch_draft(chat_id=chat_id)
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
    def _parse_data_limit(argument: str) -> int | None:
        return parse_data_limit(argument)

    @classmethod
    def _parse_data_search(cls, argument: str) -> tuple[dict[str, str] | None, int]:
        filters, limit, _ = parse_data_search_arguments(argument)
        return filters, limit

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
