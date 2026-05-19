"""Thin application service that bridges UI actions to the runtime layer."""
from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from hashlib import sha256
from importlib import import_module
import json
from pathlib import Path
import secrets
import threading
import time
from typing import Callable
from urllib.parse import urlparse

from .audit_models import AuditRecord
from .audit_store import AuditStore
from .autonomous_dev_loop import AutonomousDevLoop
from .autonomous_dev_models import AutonomousDevAdvanceDecision, AutonomousDevChainRecord, AutonomousDevPlanningDecision, AutonomousDevValidationResult
from .autonomy_bundle import AutonomyBundle
from .autonomy_bundle_formatter import AutonomyBundleFormatter
from .autonomy_bundle_store import AutonomyBundleStore
from .build_plan_formatter import BuildPlanFormatter
from .build_plan_store import BuildPlanStore
from .build_planner import BuildPlanner
from .generated_project_models import GeneratedProjectRecord
from .generated_project_store import GeneratedProjectStore
from .last_run_models import LastRunRecord
from .last_run_store import LastRunStore
from .model_advisory import CommandGrammarAdvisoryModel
from .model_experiment_formatter import ModelExperimentFormatter
from .model_experiment_models import ModelExperimentRecord, normalize_adaptation_method, normalize_baseline_kind, normalize_experiment_mode, normalize_integration_status, normalize_task_type
from .model_experiment_runner import ModelExperimentError, ModelExperimentRunner
from .model_experiment_store import ModelExperimentStore
from .feature_bundle_formatter import FeatureBundleFormatter
from .conversational_dev_planner import ConversationalDevPlanner, ConversationalDevReply
from .feature_bundle_models import FeatureBundleCommitPlan, FeatureBundleCommitReceipt, FeatureBundleCompletionAdvisory, FeatureBundleMilestoneRecord, FeatureBundlePrPlan, FeatureBundlePushPlan, FeatureBundleRecord
from .feature_bundle_store import FeatureBundleStore
from .commit_execution import FeatureBundleCommitError, FeatureBundleCommitExecutionResult, FeatureBundleCommitExecutor
from .push_execution import FeatureBundlePushError, FeatureBundlePushExecutionResult, FeatureBundlePushExecutor
from .multi_file_feature_planner import FeaturePlanningDecision, MultiFileFeaturePlanner
from .pr_review_planner import PrReviewPlanner
from .project_bootstrap_formatter import ProjectBootstrapFormatter
from .project_bootstrap_planner import ProjectBootstrapPlanner
from .project_bootstrap_store import ProjectBootstrapStore
from .production_orchestrator import ProductionConversationOutcome, ProductionOrchestrator
from .production_state_store import ProductionStateStore
from .production_summary import ProductionSummaryFormatter
from .plan_bridge import PlanBridge
from .plan_bridge_formatter import PlanBridgeFormatter
from .plan_bridge_store import PlanBridgeStore
from .capability_evaluator import CapabilityEvaluator
from .capability_executor import CapabilityExecutor
from .capability_models import CapabilityContext, CapabilityEvaluation, CapabilityManifest
from .capability_registry import COMMAND_CAPABILITY_MAP, get_capability_manifest, list_summary_capabilities
from .context_models import BufferedContext
from .context_store import ContextStore
from .data_capture import DataCapture
from .data_policy_formatter import DataPolicyFormatter
from .data_policy_models import SourcePolicyApprovalRecord, SourcePolicyRecord, normalize_allowed_operation, normalize_policy_tag, normalize_review_status, normalize_source_policy_status, normalize_source_type, normalize_usage_class
from .data_policy_rules import DataPolicyRules
from .data_policy_store import DataPolicyStore
from .data_record_models import DataRecord
from .data_record_store import DataRecordStore
from .dataset_formatter import DatasetFormatter
from .dataset_models import DatasetMembershipRecord, DatasetRecord, RecordLabelState, normalize_dataset_split, normalize_export_format, normalize_primary_label, normalize_tag
from .confirmation_models import ConfirmationContextSnapshot, PendingConfirmation
from .confirmation_store import ConfirmationStore
from .channel_models import TelegramChannelStatus, TelegramLoopStatus
from .diagnostic_models import DiagnosticReport
from .evaluation_formatter import EvaluationFormatter
from .evaluation_runner import EvaluationRunner
from .evaluation_session_models import EvaluationSessionRecord
from .evaluation_session_store import EvaluationSessionStore
from .execution_runner import ExecutionRunner, ExecutionRunnerError
from .execution_models import CapabilityExecutionResult, LocalCommandExecutionRequest
from .file_mutator import FileMutator
from .file_reader import FileReadSnapshot, FileReader, FileReaderError
from .intent_formatter import IntentFormatter
from .intent_store import IntentStore
from .intent_translator import IntentTranslator
from .node_formatter import NodeFormatter
from .node_models import NodeDescriptor, NodeDispatchRecord, NodeDispatchTarget, NodeResolution
from .node_config import NodeConfigStore, NodeLocalConfig
from .node_dispatcher import NodeDispatcher
from .node_registry import NodeRegistry
from .node_router import NodeRouter
from .diagnostics import ControllerDiagnosticsService
from .chat_orchestrator import ChatOrchestrator
from .chat_command_parser import ParsedChatCommand, parse_chat_command
from .command_grammar import build_help_text
from .chat_ingress import ChatIngress
from .models import ControllerSnapshot
from .profile_store import ControllerConfig, ControllerConfigStore, Mode, Policy, ProviderType
from .scope_models import ExecutionScope, ScopeValidationResult
from .scope_validator import ScopeValidator
from .web_fetcher import WebFetchError, WebFetchSnapshot, WebFetcher
from .workflow_executor import WorkflowExecutor
from .workflow_models import WorkflowRecord
from .workflow_store import WorkflowStore
from .workflow_scope import WorkflowScopeAnalyzer
from .repo_inspector import RepoInspectionSnapshot, RepoInspector, RepoInspectorError
from .telegram_service import TelegramApiError, TelegramChannelService, TelegramInboundMessage, mask_telegram_token
from .task_chain_formatter import TaskChainFormatter
from .task_chain_models import TaskChainRecord
from .task_chain_runner import TaskChainRunner
from .task_chain_store import TaskChainStore
from .task_execution_conversation import (
    TaskExecutionConversationOutcome,
    TaskExecutionConversationPlanner,
    TaskExecutionConversationRequest,
)
from ..platform.secrets import SecretStore, get_secret_store
from ..providers import OllamaProviderAdapter, OpenAIProviderAdapter, ProviderReply, ProviderStatus, ProviderType as AdapterProviderType, mask_secret
from ..runtime.manager import OpenClawRuntimeManager
from ..runtime.agent_router import RuntimeAgentReply, RuntimeAgentRouter
from ..runtime.log_sanitizer import sanitize_log_text

try:
    _dataset_export_module = import_module("app.controller.dataset_export")
    DatasetExportError = _dataset_export_module.DatasetExportError
    DatasetExporter = _dataset_export_module.DatasetExporter
except ModuleNotFoundError as exc:
    if exc.name != "app.controller.dataset_export":
        raise

    class DatasetExportError(ValueError):
        pass

    class DatasetExporter:
        def __init__(self, *args: object, **kwargs: object) -> None:
            pass

        def export_dataset(self, *args: object, **kwargs: object) -> None:
            raise DatasetExportError(
                "Dataset export support is unavailable because app.controller.dataset_export is missing."
            )

try:
    _dataset_store_module = import_module("app.controller.dataset_store")
    DatasetStore = _dataset_store_module.DatasetStore
except ModuleNotFoundError as exc:
    if exc.name != "app.controller.dataset_store":
        raise

    class DatasetStore:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self._root_path = Path(kwargs.get("root_path") if "root_path" in kwargs else (args[0] if args else ""))

        def __getattr__(self, name: str) -> object:
            raise RuntimeError(
                f"Dataset storage support is unavailable because app.controller.dataset_store is missing (attempted: {name})."
            )

try:
    _startup_diagnostics_module = import_module("app.controller.startup_diagnostics")
    StartupDiagnosticsFormatter = _startup_diagnostics_module.StartupDiagnosticsFormatter
    StartupDiagnosticsSnapshot = _startup_diagnostics_module.StartupDiagnosticsSnapshot
except ModuleNotFoundError as exc:
    if exc.name != "app.controller.startup_diagnostics":
        raise

    @dataclass(frozen=True)
    class StartupDiagnosticsSnapshot:
        health_status: str
        security_status: str
        readiness_status: str
        readiness_reason_summary: str
        blockers: tuple[str, ...]
        repo_root: str | None
        repo_label: str | None
        repo_context_present: bool
        selected_node: str
        selected_node_summary: str
        registered_node_count: int
        allowed_capabilities: tuple[str, ...]
        blocked_capabilities: tuple[str, ...]
        generated_at_utc: str

    class StartupDiagnosticsFormatter:
        def _status_label(self, value: str) -> str:
            normalized = value.replace("_", " ").strip()
            return normalized.upper() if normalized else "UNKNOWN"

        def _readiness_label(self, value: str) -> str:
            return self._status_label(value)

        def format_terminal(self, snapshot: StartupDiagnosticsSnapshot) -> str:
            blocked = ", ".join(snapshot.blocked_capabilities) if snapshot.blocked_capabilities else "none"
            allowed = ", ".join(snapshot.allowed_capabilities) if snapshot.allowed_capabilities else "none"
            lines = [
                "[STARTUP] AI-E controller booting",
                f"[CHECK] Health: {self._status_label(snapshot.health_status)}",
                f"[CHECK] Security: {self._status_label(snapshot.security_status)}",
                f"[CHECK] Readiness: {self._readiness_label(snapshot.readiness_status)}",
            ]
            if snapshot.repo_root:
                lines.append(f"[CHECK] Repo root: {snapshot.repo_root}")
            lines.extend(
                [
                    f"[CHECK] Selected node: {snapshot.selected_node}",
                    f"[CHECK] Registered nodes: {snapshot.registered_node_count}",
                    f"[CHECK] Allowed: {allowed}",
                    f"[CHECK] Blocked: {blocked}",
                ]
            )
            lines.extend(f"[BLOCKER] {blocker}" for blocker in snapshot.blockers)
            lines.append(
                "[STATUS] System ready for operator-approved execution"
                if snapshot.readiness_status == "ready"
                else "[STATUS] Local execution remains locked"
            )
            return "\n".join(lines)

        def format_telegram(self, snapshot: StartupDiagnosticsSnapshot) -> str:
            lines = [
                f"Startup readiness: {self._readiness_label(snapshot.readiness_status)}",
                f"Health: {self._status_label(snapshot.health_status)}",
                f"Security: {self._status_label(snapshot.security_status)}",
            ]
            if snapshot.blockers:
                lines.extend(f"- {blocker}" for blocker in snapshot.blockers)
            return "\n".join(lines)


_OPERATOR_CONSOLE_LABEL = "Windows OpenClaw Operator Console v2.9"
_ASK_CONCISE_LIMIT = 700
_ASK_DETAILED_LIMIT = 1500
_PROVIDER_ASK_COMMANDS = frozenset({"/ask", "/askd", "/asklast", "/askctx"})
_PROVIDER_ASK_COOLDOWN_SECONDS = 4.0
_OLLAMA_ASK_TIMEOUT_SECONDS = 60.0
_OPENAI_ASK_TIMEOUT_SECONDS = 18.0
_CONFIRMATION_LIFETIME_SECONDS = 120.0
_AUDIT_LOG_MAX_RECORDS = 50
_CONTEXT_BUFFER_MAX_ITEMS = 6
_CONTEXT_LIFETIME_SECONDS = 1800.0
_CONTEXT_PROMPT_CHAR_LIMIT = 2200
_WORKFLOW_BUFFER_MAX_ITEMS = 8
_WORKFLOW_LIFETIME_SECONDS = 1800.0
_LOCAL_READINESS_HEALTH_IGNORED_CODES = frozenset(
    {
        "ollama.installation",
        "ollama.service",
        "provider.validation",
        "mode.usable",
        "secret.selected_provider",
    }
)
_LOCAL_READINESS_SECURITY_IGNORED_CODES = frozenset(
    {
        "secret.required",
        "state.degraded",
        "integrity.provider_active_invalid",
        "integrity.offline_usable",
        "integrity.online_secret",
        "integrity.policy_mode",
    }
)
_LOOP_ACTION_CAPABILITIES = frozenset(
    {
        "repo.status.read",
        "file.read",
        "file.create.write",
        "file.patch.write",
        "file.write.replace",
        "build.bootstrap.propose.read",
        "build.bootstrap.approve.query",
        "build.bootstrap.reset.query",
        "build.autonomous.dev.query",
        "shell.command.run",
        "test.command.run",
    }
)
_STARTUP_SUMMARY_CAPABILITIES: tuple[tuple[str, str], ...] = (
    ("repo.status.read", "repo.read"),
    ("file.create.write", "file.write"),
    ("shell.command.run", "run"),
    ("test.command.run", "test"),
    ("ask.provider_query", "ask"),
    ("web.fetch.read", "web.read"),
    ("build.bootstrap.approve.query", "bootstrap"),
)


@dataclass(frozen=True)
class _TelegramResponsePlan:
    reply: str
    command_label: str
    ask_status: str = ""
    hide_content_in_summary: bool = False
    response_style: str = "concise"
    acknowledge_work: bool = False


_ParsedTelegramCommand = ParsedChatCommand


@dataclass(frozen=True)
class _ProviderCallResult:
    state: str
    reply: ProviderReply | None = None
    error_message: str = ""


@dataclass(frozen=True)
class _PendingPatchDraft:
    relative_path: str
    raw_argument: str
    summary: str
    source_kind: str = ""
    source_context_id: str = ""
    created_at_utc: str = ""
    is_patch_eligible: bool = False


@dataclass(frozen=True)
class PendingPatchDraftInfo:
    relative_path: str
    summary: str
    source_kind: str
    source_context_id: str
    created_at_utc: str


class ControllerService:
    """Facade used by the UI to keep runtime orchestration simple."""

    def __init__(
        self,
        runtime_manager: OpenClawRuntimeManager | None = None,
        config_store: ControllerConfigStore | None = None,
        secret_store: SecretStore | None = None,
        provider_adapters: dict[AdapterProviderType, object] | None = None,
        telegram_service: TelegramChannelService | None = None,
        repo_inspector: RepoInspector | None = None,
        file_reader: FileReader | None = None,
        file_mutator: FileMutator | None = None,
        execution_runner: ExecutionRunner | None = None,
        web_fetcher: WebFetcher | None = None,
        terminal_logger: Callable[[str], None] | None = None,
    ) -> None:
        self._runtime_manager = runtime_manager or OpenClawRuntimeManager()
        self._config_store = config_store or ControllerConfigStore()
        self._secret_store = secret_store or get_secret_store()
        self._node_config_store = NodeConfigStore(config_path=self._config_store.path.with_name("node_config.json"))
        self._provider_adapters = provider_adapters or {
            "ollama": OllamaProviderAdapter(),
            "openai": OpenAIProviderAdapter(),
        }
        self._telegram_service = telegram_service or TelegramChannelService()
        self._repo_inspector = repo_inspector or RepoInspector()
        self._file_reader = file_reader or FileReader()
        self._file_mutator = file_mutator or FileMutator()
        self._execution_runner = execution_runner or ExecutionRunner()
        self._web_fetcher = web_fetcher or WebFetcher()
        self._node_formatter = NodeFormatter()
        self._intent_translator = IntentTranslator()
        self._intent_formatter = IntentFormatter()
        self._build_planner = BuildPlanner()
        self._build_plan_formatter = BuildPlanFormatter()
        self._project_bootstrap_planner = ProjectBootstrapPlanner()
        self._project_bootstrap_formatter = ProjectBootstrapFormatter()
        self._feature_bundle_planner = MultiFileFeaturePlanner()
        self._autonomous_dev_loop = AutonomousDevLoop()
        self._feature_bundle_formatter = FeatureBundleFormatter()
        self._feature_commit_executor = FeatureBundleCommitExecutor()
        self._feature_push_executor = FeatureBundlePushExecutor()
        self._pr_review_planner = PrReviewPlanner()
        self._conversational_dev_planner = ConversationalDevPlanner()
        self._plan_bridge = PlanBridge()
        self._plan_bridge_formatter = PlanBridgeFormatter(self._plan_bridge)
        self._autonomy_bundle = AutonomyBundle(self._plan_bridge)
        self._autonomy_bundle_formatter = AutonomyBundleFormatter()
        self._chat_orchestrator = ChatOrchestrator()
        self._chat_ingress = ChatIngress()
        self._config = self._config_store.load()
        self._node_config = self._node_config_store.load()
        self._normalize_repo_root_config()
        self._normalize_file_roots_config()
        self._normalize_web_domains_config()
        self._runtime_manager.configure(gateway_port=self._config.gateway_port, gateway_bind=self._config.gateway_bind)
        self._runtime_active = self._runtime_manager.get_status().runtime_state == "running"
        self._provider_status_cache: dict[str, ProviderStatus] = self._load_provider_status_cache(self._config)
        self._telegram_status = self._reconcile_telegram_status(self._config.telegram_status)
        self._telegram_loop_lock = threading.RLock()
        self._telegram_loop_thread: threading.Thread | None = None
        self._telegram_loop_stop_event: threading.Event | None = None
        self._telegram_loop_status = TelegramLoopStatus()
        self._provider_timeouts = {"ollama": _OLLAMA_ASK_TIMEOUT_SECONDS, "openai": _OPENAI_ASK_TIMEOUT_SECONDS}
        self._provider_ask_cooldown_seconds = _PROVIDER_ASK_COOLDOWN_SECONDS
        self._provider_chat_lock = threading.RLock()
        self._active_provider_chats: dict[str, tuple[str, threading.Thread]] = {}
        self._provider_cooldowns: dict[str, float] = {}
        self._task_execution_conversation_lock = threading.RLock()
        self._startup_prewarm_attempted = False
        self._terminal_logger = terminal_logger or print
        self._node_registry = NodeRegistry(
            local_node=self._build_local_node(),
            registry_root=self._node_config.registry_root,
            stale_after_seconds=self._node_config.stale_after_seconds,
        )
        self._node_dispatcher = NodeDispatcher(registry_root=self._node_config.registry_root)
        self._node_router = NodeRouter(self._execution_runner)
        self._startup_diagnostics_formatter = StartupDiagnosticsFormatter()
        self._diagnostics_service = ControllerDiagnosticsService(
            runtime_manager=self._runtime_manager,
            config_store=self._config_store,
            secret_store=self._secret_store,
        )
        self._runtime_agent_router = RuntimeAgentRouter(
            runtime_manager=self._runtime_manager,
            provider_adapters=self._provider_adapters,
            get_config=lambda: self._config,
            get_secret_store=lambda: self._secret_store,
            provider_timeout_seconds=self._provider_timeout_seconds,
            get_provider_status=lambda provider: self._provider_status_cache.get(provider),
        )
        self._scope_validator = ScopeValidator()
        self._capability_evaluator = CapabilityEvaluator()
        self._capability_executor = CapabilityExecutor(self)
        self._workflow_store = WorkflowStore(
            max_workflows_per_chat=_WORKFLOW_BUFFER_MAX_ITEMS,
            lifetime_seconds=_WORKFLOW_LIFETIME_SECONDS,
        )
        self._workflow_executor = WorkflowExecutor(self, self._capability_executor)
        self._workflow_scope_analyzer = WorkflowScopeAnalyzer()
        self._audit_store = AuditStore(max_records=_AUDIT_LOG_MAX_RECORDS)
        self._data_capture = DataCapture()
        self._data_record_store = DataRecordStore(root_path=self._config_store.path.parent / "data_records")
        self._data_policy_store = DataPolicyStore(root_path=self._config_store.path.parent / "data_policy")
        self._data_policy_formatter = DataPolicyFormatter()
        self._data_policy_rules = DataPolicyRules()
        self._dataset_store = DatasetStore(root_path=self._config_store.path.parent / "datasets")
        self._dataset_formatter = DatasetFormatter()
        self._dataset_exporter = DatasetExporter(store=self._dataset_store, formatter=self._dataset_formatter)
        self._model_experiment_store = ModelExperimentStore(root_path=self._config_store.path.parent / "model_experiments")
        self._model_experiment_formatter = ModelExperimentFormatter()
        self._model_experiment_runner = ModelExperimentRunner()
        self._context_store = ContextStore(
            max_contexts_per_chat=_CONTEXT_BUFFER_MAX_ITEMS,
            lifetime_seconds=_CONTEXT_LIFETIME_SECONDS,
        )
        self._pending_patch_drafts: dict[str, _PendingPatchDraft] = {}
        self._intent_store = IntentStore()
        self._build_plan_store = BuildPlanStore()
        self._project_bootstrap_store = ProjectBootstrapStore()
        self._generated_project_store = GeneratedProjectStore()
        self._feature_bundle_store = FeatureBundleStore()
        self._feature_bundle_commit_receipts: dict[str, FeatureBundleCommitReceipt] = {}
        self._feature_bundle_milestones: dict[str, FeatureBundleMilestoneRecord] = {}
        self._autonomous_dev_chains: dict[str, AutonomousDevChainRecord] = {}
        self._last_run_store = LastRunStore()
        self._plan_bridge_store = PlanBridgeStore()
        self._autonomy_bundle_store = AutonomyBundleStore()
        self._evaluation_store = EvaluationSessionStore(root_path=self._config_store.path.parent / "evaluation")
        self._evaluation_formatter = EvaluationFormatter()
        self._evaluation_runner = EvaluationRunner(self, self._evaluation_store)
        self._task_chain_store = TaskChainStore(root_path=self._config_store.path.parent / "task_chains")
        self._task_chain_formatter = TaskChainFormatter()
        self._task_chain_runner = TaskChainRunner(self, self._task_chain_store)
        self._task_execution_conversation_planner = TaskExecutionConversationPlanner()
        self._task_execution_conversation_requests: dict[str, TaskExecutionConversationRequest] = {}
        self._production_state_store = ProductionStateStore(root_path=self._config_store.path.parent / "production_state")
        self._production_summary_formatter = ProductionSummaryFormatter()
        self._production_orchestrator = ProductionOrchestrator(
            store=self._production_state_store,
            summary_formatter=self._production_summary_formatter,
        )
        self._last_capability_evaluation: CapabilityEvaluation | None = None
        self._last_execution_result: CapabilityExecutionResult | None = None
        self._last_loop_result: CapabilityExecutionResult | None = None
        self._last_context_source = "No buffered context yet."
        self._last_context_action = "No context action yet."
        self._last_repo_branch = "-"
        self._last_repo_state = "No repository insight result yet."
        self._last_repo_checked_at = "-"
        self._last_file_read = "No file preview result yet."
        self._last_file_status = "No file preview result yet."
        self._last_file_read_at = "-"
        self._last_web_fetch = "No web fetch result yet."
        self._last_web_status = "No web fetch result yet."
        self._last_web_content_type = "-"
        self._last_web_fetched_at = "-"
        self._confirmation_store = ConfirmationStore(lifetime_seconds=_CONFIRMATION_LIFETIME_SECONDS)
        self._last_confirmation_requested = "No pending confirmation requested yet."
        self._last_confirmation_result = "No confirmation handled yet."
        self._latest_health_report: DiagnosticReport | None = None
        self._latest_security_report: DiagnosticReport | None = None
        self._last_message = "Controller ready."
        self._startup_diagnostics_snapshot = self.build_startup_diagnostics_snapshot()

    def start_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.start_runtime()
        self._runtime_active = True
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def stop_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.stop_runtime()
        self._runtime_active = False
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def restart_runtime(self) -> ControllerSnapshot:
        self._runtime_manager.restart_runtime()
        self._runtime_active = True
        self._last_message = self._runtime_manager.get_status().status_message
        return self.snapshot()

    def activate_runtime_control_plane(self) -> tuple[bool, ControllerSnapshot]:
        already_active = self._runtime_active
        self._runtime_active = True
        self._last_message = "Runtime already active." if already_active else "Runtime started."
        return already_active, self.snapshot()

    def clear_logs(self) -> ControllerSnapshot:
        self._runtime_manager.clear_logs()
        self._last_message = "Runtime logs cleared."
        return self.snapshot()

    def start_telegram_loop(self) -> ControllerSnapshot:
        previous = self._telegram_status
        validation = self._telegram_service.validate(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            transient_token="",
        )
        validation = replace(
            validation,
            last_test_result=previous.last_test_result,
            last_test_message=previous.last_test_message,
            last_test_at=previous.last_test_at,
        )
        self._telegram_status = validation
        self._persist_telegram_status()

        with self._telegram_loop_lock:
            if self._telegram_loop_thread is not None and self._telegram_loop_thread.is_alive():
                self._update_telegram_loop_status(
                    state=self._telegram_loop_status.state,
                    message="Telegram loop is already running.",
                    activity=False,
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            if not validation.token_present:
                self._update_telegram_loop_status(
                    state="error",
                    message="Telegram loop cannot start because no stored bot token is available.",
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            if validation.validation_state == "invalid":
                self._update_telegram_loop_status(
                    state="error",
                    message=f"Telegram loop cannot start: {validation.message}",
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()

            stop_event = threading.Event()
            thread = threading.Thread(
                target=self._telegram_loop_worker,
                args=(stop_event,),
                name="TelegramPollingLoop",
                daemon=True,
            )
            self._telegram_loop_stop_event = stop_event
            self._telegram_loop_thread = thread
            self._update_telegram_loop_status(
                state="starting",
                message="Starting Telegram polling loop.",
            )
            thread.start()

        self._last_message = self._telegram_loop_status.message
        return self.snapshot()

    def stop_telegram_loop(self) -> ControllerSnapshot:
        thread: threading.Thread | None
        stop_event: threading.Event | None
        with self._telegram_loop_lock:
            thread = self._telegram_loop_thread
            stop_event = self._telegram_loop_stop_event
            if thread is None or not thread.is_alive():
                self._telegram_loop_thread = None
                self._telegram_loop_stop_event = None
                self._update_telegram_loop_status(
                    state="stopped",
                    message="Telegram loop is already stopped.",
                    activity=False,
                )
                self._last_message = self._telegram_loop_status.message
                return self.snapshot()
            if stop_event is not None:
                stop_event.set()

        if thread is not None:
            thread.join(timeout=5.0)

        with self._telegram_loop_lock:
            self._telegram_loop_thread = None
            self._telegram_loop_stop_event = None
            self._update_telegram_loop_status(
                state="stopped",
                message="Telegram loop stopped.",
            )
        self._last_message = self._telegram_loop_status.message
        return self.snapshot()

    def check_status(self) -> ControllerSnapshot:
        self._runtime_manager.refresh_status()
        self._refresh_provider_status(self._config.selected_provider)
        self._telegram_status = self._reconcile_telegram_status(self._telegram_status)
        runtime_status = self._runtime_manager.get_status()
        selected_status = self._provider_status_cache.get(self._config.selected_provider)
        if selected_status is not None and not selected_status.ready:
            self._last_message = selected_status.message
        else:
            self._last_message = runtime_status.status_message
        return self.snapshot()

    def route_conversation_prompt(self, prompt: str) -> RuntimeAgentReply:
        workflow_scope = self._workflow_scope_analyzer.analyze(prompt)
        reply = self._runtime_agent_router.route_prompt(prompt, workflow_scope=workflow_scope)
        if reply.routed:
            self._last_message = f"Conversation routed to {reply.agent_label}."
        else:
            self._last_message = reply.response_text
        return reply

    def snapshot(self) -> ControllerSnapshot:
        self._cleanup_expired_confirmations()
        self._cleanup_expired_contexts()
        self._cleanup_expired_workflows()
        status = self._runtime_manager.get_status()
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        telegram_status = self._reconcile_telegram_status(self._telegram_status)
        with self._telegram_loop_lock:
            telegram_loop_status = self._telegram_loop_status
        readiness_state, readiness_message = self._compute_readiness(
            runtime_active=self._runtime_active,
            telegram_status=telegram_status,
        )
        current_context = self._context_store.current_any()
        current_context_freshness = self._describe_current_context_freshness(current_context)
        workflow_record = self._current_or_latest_workflow()
        current_node = self.resolve_execution_node()
        return ControllerSnapshot(
            runtime_state=status.runtime_state,
            status_message=self._last_message or status.status_message,
            mode=self._config.current_mode,
            selected_mode=self._config.selected_mode,
            policy=self._config.policy,
            active_provider=self._active_provider_for_mode(self._config.current_mode),
            selected_provider=self._config.selected_provider,
            provider_status=selected_provider_status.validation_state,
            provider_message=selected_provider_status.message,
            provider_ready=selected_provider_status.ready,
            provider_model=selected_provider_status.model,
            available_provider_models=selected_provider_status.available_models,
            openai_key_masked=self._config.openai_key_masked,
            telegram_configured=telegram_status.configured,
            telegram_token_present=telegram_status.token_present,
            telegram_status=telegram_status.validation_state,
            telegram_message=telegram_status.message,
            telegram_token_masked=telegram_status.token_masked,
            telegram_bot_identity=telegram_status.identity_label if telegram_status.bot_id or telegram_status.bot_username or telegram_status.bot_display_name else "-",
            telegram_last_test_result=telegram_status.last_test_result,
            telegram_last_test_at=telegram_status.last_test_at or "-",
            telegram_loop_state=telegram_loop_status.state,
            telegram_loop_activity=telegram_loop_status.activity_state,
            telegram_loop_message=telegram_loop_status.message,
            telegram_last_activity_at=telegram_loop_status.last_activity_at or "-",
            telegram_last_command=telegram_loop_status.last_command,
            telegram_last_ask_status=telegram_loop_status.last_ask_status,
            telegram_last_inbound_summary=telegram_loop_status.last_inbound_summary,
            telegram_last_outbound_summary=telegram_loop_status.last_outbound_summary,
            configured_repo_root=self._config.repo_root or "-",
            configured_file_roots=self._file_roots_summary(self._config.file_allowed_roots),
            configured_web_domains=self._web_domains_summary(self._config.web_allowed_domains),
            registered_node_count=len(self._node_registry.list_nodes()),
            selected_node_id=current_node.node.node_id,
            selected_node_summary=f"{current_node.node.display_name} ({current_node.source})",
            buffered_context_count=self._context_store.total_count(),
            last_context_source=self._last_context_source,
            current_context_freshness=current_context_freshness,
            last_context_action=self._last_context_action,
            last_repo_branch=self._last_repo_branch,
            last_repo_status=self._last_repo_state,
            last_repo_checked_at=self._last_repo_checked_at,
            last_file_read=self._last_file_read,
            last_file_read_status=self._last_file_status,
            last_file_read_at=self._last_file_read_at,
            last_web_fetch=self._last_web_fetch,
            last_web_status=self._last_web_status,
            last_web_content_type=self._last_web_content_type,
            last_web_fetched_at=self._last_web_fetched_at,
            last_capability_id=self._last_capability_evaluation.capability_id if self._last_capability_evaluation else "-",
            last_capability_state=self._last_capability_evaluation.current_availability_state if self._last_capability_evaluation else "unknown",
            last_capability_message=self._last_capability_evaluation.message if self._last_capability_evaluation else "No capability evaluated yet.",
            last_capability_trust_summary=self._format_evaluation_trust_summary(self._last_capability_evaluation) if self._last_capability_evaluation else "No capability trust summary yet.",
            last_execution_outcome=self._last_execution_result.outcome if self._last_execution_result else "unknown",
            last_execution_reason_code=self._last_execution_result.outcome_reason_code if self._last_execution_result else "no_execution_yet",
            last_execution_summary=self._last_execution_result.internal_summary if self._last_execution_result else "No execution result yet.",
            last_execution_trust_summary=self._last_execution_result.trust_summary if self._last_execution_result else "No execution trust summary yet.",
            last_execution_scope_summary=self._last_execution_result.scope_summary if self._last_execution_result else "No execution scope summary yet.",
            last_execution_duration_ms=self._last_execution_result.duration_ms if self._last_execution_result else 0,
            last_execution_finished_at=self._last_execution_result.finished_at if self._last_execution_result else "-",
            last_audit_summary=self._format_audit_record_summary(self._audit_store.latest()) if self._audit_store.latest() else "No audit record yet.",
            last_workflow_type=workflow_record.workflow_type if workflow_record is not None else "-",
            last_workflow_state=self._workflow_state_label(workflow_record) if workflow_record is not None else "No workflow yet.",
            last_workflow_step=self._workflow_step_label(workflow_record) if workflow_record is not None else "No workflow step yet.",
            last_workflow_summary=self._workflow_summary_label(workflow_record) if workflow_record is not None else "No workflow executed yet.",
            pending_confirmation_count=self._confirmation_store.pending_count(),
            last_confirmation_requested=self._last_confirmation_requested,
            last_confirmation_result=self._last_confirmation_result,
            readiness_state=readiness_state,
            readiness_message=readiness_message,
            health_status=self._latest_health_report.overall_status if self._latest_health_report else "unknown",
            safety_status=self._latest_security_report.overall_status if self._latest_security_report else "unknown",
            last_health_check_at=self._latest_health_report.ran_at if self._latest_health_report else "-",
            last_security_check_at=self._latest_security_report.ran_at if self._latest_security_report else "-",
            health_summary=self._latest_health_report.summary if self._latest_health_report else "Health check has not been run yet.",
            safety_summary=self._latest_security_report.summary if self._latest_security_report else "Security check has not been run yet.",
            diagnostic_summary_lines=self._diagnostic_summary_lines(),
            openclaw_installed=status.openclaw.installed,
            openclaw_path=status.openclaw.entrypoint_path or status.openclaw.wrapper_path,
            ollama_installed=status.ollama.installed,
            ollama_path=status.ollama.path,
            runtime_pid=status.pid,
            recent_logs=self._runtime_manager.get_recent_logs(),
            runtime_active=self._runtime_active,
        )

    def validate_provider(
        self,
        *,
        provider: ProviderType,
        preferred_ollama_model: str = "",
        transient_openai_key: str = "",
    ) -> ControllerSnapshot:
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_ollama_model,
            transient_openai_key=transient_openai_key,
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)
        self._last_message = validation.message
        return self.snapshot()

    def save_telegram_settings(self, *, telegram_token: str = "") -> ControllerSnapshot:
        trimmed = telegram_token.strip()
        if not trimmed:
            if self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id):
                self._telegram_status = self._reconcile_telegram_status(self._telegram_status)
                self._last_message = "Telegram token is already stored."
                return self.snapshot()
            self._telegram_status = replace(
                self._telegram_status,
                configured=False,
                token_present=False,
                ready=False,
                validation_state="invalid",
                message="Enter a Telegram bot token before saving Telegram settings.",
            )
            self._persist_telegram_status()
            self._last_message = self._telegram_status.message
            return self.snapshot()

        self._secret_store.put_secret(self._config.telegram_secret_id, trimmed)
        self._telegram_status = TelegramChannelStatus(
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(trimmed),
            validation_state="unknown",
            available=False,
            ready=False,
            message="Telegram token saved. Validate Telegram to confirm bot connectivity.",
        )
        self._persist_telegram_status()
        self._last_message = self._telegram_status.message
        return self.snapshot()

    def validate_telegram(self, *, transient_token: str = "") -> ControllerSnapshot:
        previous = self._telegram_status
        using_transient = bool(transient_token.strip())
        validation = self._telegram_service.validate(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            transient_token=transient_token.strip(),
        )
        if using_transient:
            stored_present = self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id)
            validation = replace(
                validation,
                configured=stored_present,
                token_present=stored_present,
                ready=validation.ready and stored_present,
            )
        validation = replace(
            validation,
            last_test_result=previous.last_test_result,
            last_test_message=previous.last_test_message,
            last_test_at=previous.last_test_at,
        )
        self._telegram_status = validation
        if not using_transient:
            self._persist_telegram_status()
        self._last_message = validation.message
        return self.snapshot()

    def test_telegram_connection(self) -> ControllerSnapshot:
        tested = self._telegram_service.test_connection(
            secret_store=self._secret_store,
            secret_id=self._config.telegram_secret_id,
            existing_status=self._telegram_status,
        )
        self._telegram_status = tested
        self._persist_telegram_status()
        self._last_message = tested.last_test_message
        return self.snapshot()

    def save_settings(
        self,
        *,
        selected_mode: Mode,
        selected_provider: ProviderType,
        policy: Policy,
        preferred_ollama_model: str = "",
        openai_api_key: str = "",
        confirm_online: bool = False,
    ) -> ControllerSnapshot:
        candidate = replace(
            self._config,
            selected_mode=selected_mode,
            selected_provider=selected_provider,
            policy=policy,
            preferred_ollama_model=preferred_ollama_model.strip(),
        )

        openai_api_key = openai_api_key.strip()
        if openai_api_key:
            self._secret_store.put_secret(candidate.openai_secret_id, openai_api_key)
            candidate.openai_has_secret = True
            candidate.openai_key_masked = mask_secret(openai_api_key)
        elif self._secret_store.available and self._secret_store.has_secret(candidate.openai_secret_id):
            candidate.openai_has_secret = True

        compatibility_message = self._validate_mode_provider_pair(candidate.selected_mode, candidate.selected_provider, candidate.policy)
        if compatibility_message:
            self._config = candidate
            self._config_store.save(self._config)
            self._last_message = compatibility_message
            return self.snapshot()

        self._config = candidate
        self._config_store.save(self._config)

        if selected_mode == "online" and policy == "ask_before_online" and self._config.current_mode != "online" and not confirm_online:
            self._last_message = "Settings saved. Online requests will require one-shot confirmation before remote execution."
            return self.snapshot()

        validation = self._validate_provider(
            provider=selected_provider,
            preferred_ollama_model=preferred_ollama_model,
            transient_openai_key="",
        )
        self._provider_status_cache[selected_provider] = validation
        self._persist_provider_status(selected_provider, validation)

        if validation.ready:
            self._config.current_mode = selected_mode
            self._config_store.save(self._config)
            mode_label = "Online" if selected_mode == "online" else "Offline"
            self._last_message = f"Settings saved. {mode_label} Mode is active with {validation.display_name}."
        else:
            current_mode_label = "Online" if self._config.current_mode == "online" else "Offline"
            self._last_message = (
                f"Settings saved, but requested mode was not activated: {validation.message} "
                f"Current mode remains {current_mode_label}."
            )
        return self.snapshot()

    def run_health_check(self) -> ControllerSnapshot:
        self._refresh_provider_status(self._config.selected_provider)
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        self._latest_health_report = self._diagnostics_service.run_health_check(
            self._config,
            selected_provider_status,
            telegram_recent_success=self._telegram_recent_success(),
            telegram_last_success_at=self._telegram_loop_status.last_success_at,
        )
        self._last_message = self._latest_health_report.summary
        return self.snapshot()

    def run_security_check(self) -> ControllerSnapshot:
        self._refresh_provider_status(self._config.selected_provider)
        selected_provider_status = self._provider_status_cache.get(self._config.selected_provider) or self._default_provider_status(
            self._config.selected_provider
        )
        self._latest_security_report = self._diagnostics_service.run_security_check(self._config, selected_provider_status)
        self._last_message = self._latest_security_report.summary
        return self.snapshot()

    def shutdown(self) -> None:
        self.stop_telegram_loop()
        self._evaluation_runner.shutdown()
        self._task_chain_runner.shutdown()
        self._runtime_active = False
        self._runtime_manager.stop_runtime()

    def build_startup_diagnostics_snapshot(self) -> StartupDiagnosticsSnapshot:
        status = self._runtime_manager.get_status()
        telegram_status = self._reconcile_telegram_status(self._telegram_status)
        offline_status = self._provider_status_cache.get("ollama") or self._default_provider_status("ollama")
        online_status = self._provider_status_cache.get("openai") or self._default_provider_status("openai")
        selected_provider_status = online_status if self._config.selected_provider == "openai" else offline_status
        startup_health_check = getattr(self._diagnostics_service, "run_startup_health_check", self._diagnostics_service.run_health_check)
        health_report = self._latest_health_report or startup_health_check(
            self._config,
            selected_provider_status,
            telegram_recent_success=self._telegram_recent_success(),
            telegram_last_success_at=self._telegram_loop_status.last_success_at,
        )
        security_report = self._latest_security_report or self._diagnostics_service.run_security_check(
            self._config,
            selected_provider_status,
        )
        readiness_state, readiness_message = self._compute_readiness_from_reports(
            runtime_active=self._runtime_active,
            telegram_status=telegram_status,
            health_report=health_report,
            security_report=security_report,
        )
        network_readiness_state, network_readiness_message = self._compute_network_readiness_from_reports(
            runtime_active=self._runtime_active,
            selected_provider_status=selected_provider_status,
            telegram_status=telegram_status,
            health_report=health_report,
            security_report=security_report,
        )
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        file_allowed_roots, file_scope_valid, file_message, _ = self._file_scope_state()
        web_allowed_domains, web_scope_valid, web_message, _ = self._web_scope_state()
        current_node = self.resolve_execution_node()
        context = CapabilityContext(
            runtime_state=status.runtime_state,
            readiness_state=readiness_state,  # type: ignore[arg-type]
            network_readiness_state=network_readiness_state,  # type: ignore[arg-type]
            network_readiness_message=network_readiness_message,
            mode=self._config.current_mode,
            selected_mode=self._config.selected_mode,
            policy=self._config.policy,
            active_provider=self._active_provider_for_mode(self._config.current_mode),
            selected_provider=self._config.selected_provider,
            health_status=health_report.overall_status,
            safety_status=security_report.overall_status,
            offline_provider_status=offline_status,
            online_provider_status=online_status,
            repo_root=repo_root,
            repo_root_valid=repo_root_valid,
            repo_message=repo_message,
            file_allowed_roots=file_allowed_roots,
            file_scope_valid=file_scope_valid,
            file_message=file_message,
            web_allowed_domains=web_allowed_domains,
            web_scope_valid=web_scope_valid,
            web_message=web_message,
            runtime_active=self._runtime_active,
        )
        allowed_labels: list[str] = []
        blocked_labels: list[str] = []
        for capability_id, label in _STARTUP_SUMMARY_CAPABILITIES:
            evaluation = self._capability_evaluator.evaluate(
                capability_id,
                context,
                source="desktop",
                confirmation_granted=False,
            )
            if evaluation.current_availability_state == "allowed":
                allowed_labels.append(label)
            else:
                blocked_labels.append(label)
        raw_repo_root = repo_root or self._config.repo_root.strip() or None
        repo_label = self._repo_display_name(raw_repo_root or "") if raw_repo_root else None
        snapshot = StartupDiagnosticsSnapshot(
            health_status=health_report.overall_status,
            security_status=security_report.overall_status,
            readiness_status=readiness_state,
            readiness_reason_summary=readiness_message,
            blockers=self._startup_blockers(
                health_report=health_report,
                security_report=security_report,
                readiness_state=readiness_state,
                readiness_message=readiness_message,
            ),
            repo_root=raw_repo_root,
            repo_label=repo_label,
            repo_context_present=repo_root_valid,
            selected_node=current_node.node.node_id,
            selected_node_summary=f"{current_node.node.display_name} ({current_node.source})",
            registered_node_count=len(self._node_registry.list_nodes()),
            allowed_capabilities=tuple(dict.fromkeys(allowed_labels)),
            blocked_capabilities=tuple(dict.fromkeys(blocked_labels)),
            generated_at_utc=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        )
        self._startup_diagnostics_snapshot = snapshot
        return snapshot

    def emit_startup_diagnostics_summary(self) -> StartupDiagnosticsSnapshot:
        self._maybe_prewarm_ollama_model()
        snapshot = self.build_startup_diagnostics_snapshot()
        self._emit_terminal_lines(self._startup_diagnostics_formatter.format_terminal(snapshot).splitlines())
        return snapshot

    def _maybe_prewarm_ollama_model(self) -> None:
        if self._startup_prewarm_attempted:
            return
        self._startup_prewarm_attempted = True

        if self._config.selected_provider != "ollama" and self._active_provider_for_mode(self._config.current_mode) != "ollama":
            self._emit_terminal_lines(("[MODEL] Prewarm: skipped",))
            return

        validation = self._validate_provider(
            provider="ollama",
            preferred_ollama_model=self._config.preferred_ollama_model,
            transient_openai_key="",
        )
        self._provider_status_cache["ollama"] = validation
        self._persist_provider_status("ollama", validation)

        model = validation.model or self._config.preferred_ollama_model.strip()
        if model:
            self._emit_terminal_lines((f"[MODEL] Using: {model}",))

        if not validation.ready or not model:
            self._emit_terminal_lines(("[MODEL] Prewarm: skipped",))
            return

        adapter = self._provider_adapters.get("ollama")
        if adapter is None or not hasattr(adapter, "prewarm"):
            self._emit_terminal_lines(("[MODEL] Prewarm: skipped",))
            return

        started = time.perf_counter()
        try:
            reply = adapter.prewarm(  # type: ignore[attr-defined]
                runtime_status=self._runtime_manager.get_status(),
                base_url=self._config.ollama_base_url,
                preferred_model=model,
                timeout_seconds=self._provider_timeout_seconds("ollama"),
            )
        except Exception:  # noqa: BLE001
            self._emit_terminal_lines(("[MODEL] Prewarm: failed",))
            return

        elapsed = time.perf_counter() - started
        if isinstance(reply, ProviderReply) and reply.ok:
            self._emit_terminal_lines((f"[MODEL] Prewarm: success ({elapsed:.1f}s)",))
            return
        self._emit_terminal_lines(("[MODEL] Prewarm: failed",))

    def _validate_provider(
        self,
        *,
        provider: ProviderType,
        preferred_ollama_model: str,
        transient_openai_key: str,
    ) -> ProviderStatus:
        if provider == "ollama":
            adapter = self._provider_adapters["ollama"]
            return adapter.validate(  # type: ignore[call-arg]
                runtime_status=self._runtime_manager.get_status(),
                base_url=self._config.ollama_base_url,
                preferred_model=preferred_ollama_model.strip(),
            )
        adapter = self._provider_adapters["openai"]
        return adapter.validate(  # type: ignore[call-arg]
            secret_store=self._secret_store,
            secret_id=self._config.openai_secret_id,
            transient_secret=transient_openai_key.strip(),
        )

    def _refresh_provider_status(self, provider: ProviderType) -> None:
        preferred_model = self._config.preferred_ollama_model if provider == "ollama" else ""
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_model,
            transient_openai_key="",
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)

    def _provider_status_for_mode(self, mode: Mode) -> ProviderStatus:
        provider = self._active_provider_for_mode(mode)
        preferred_model = self._config.preferred_ollama_model if provider == "ollama" else ""
        validation = self._validate_provider(
            provider=provider,
            preferred_ollama_model=preferred_model,
            transient_openai_key="",
        )
        self._provider_status_cache[provider] = validation
        self._persist_provider_status(provider, validation)
        return validation

    def _persist_provider_status(self, provider: ProviderType, validation: ProviderStatus) -> None:
        self._config.last_provider_statuses[provider] = validation.as_payload()
        self._config_store.save(self._config)

    def _load_provider_status_cache(self, config: ControllerConfig) -> dict[str, ProviderStatus]:
        statuses: dict[str, ProviderStatus] = {}
        for provider, payload in config.last_provider_statuses.items():
            if provider not in {"ollama", "openai"} or not isinstance(payload, dict):
                continue
            statuses[provider] = ProviderStatus(
                provider=provider,  # type: ignore[arg-type]
                display_name=str(payload.get("display_name", provider.title())),
                configured=bool(payload.get("configured", False)),
                available=bool(payload.get("available", False)),
                validation_state=str(payload.get("validation_state", "unknown")),  # type: ignore[arg-type]
                ready=bool(payload.get("ready", False)),
                message=str(payload.get("message", "Provider has not been validated yet.")),
                is_local=bool(payload.get("is_local", provider == "ollama")),
                model=str(payload.get("model", "")),
                available_models=tuple(str(item) for item in payload.get("available_models", []) if str(item).strip()),
            )
        return statuses

    def _default_provider_status(self, provider: ProviderType) -> ProviderStatus:
        return ProviderStatus(
            provider=provider,
            display_name="Ollama" if provider == "ollama" else "OpenAI",
            configured=False,
            available=False,
            validation_state="unknown",
            ready=False,
            message="Provider has not been validated yet.",
            is_local=provider == "ollama",
        )

    def _persist_telegram_status(self) -> None:
        self._config.telegram_status = self._telegram_status
        self._config_store.save(self._config)

    def _persist_telegram_offset(self, update_id: int) -> None:
        if update_id <= self._config.telegram_last_processed_update_id:
            return
        self._config.telegram_last_processed_update_id = update_id
        self._config_store.save(self._config)

    def _reconcile_telegram_status(self, status: TelegramChannelStatus) -> TelegramChannelStatus:
        has_secret = self._secret_store.available and self._secret_store.has_secret(self._config.telegram_secret_id)
        if not has_secret:
            if not status.token_present:
                return status
            return replace(
                status,
                configured=False,
                token_present=False,
                token_masked="",
                available=False,
                ready=False,
                validation_state="unknown" if status.validation_state == "valid" else status.validation_state,
                message="Telegram is not configured. Save a bot token before validating the channel.",
                bot_id="",
                bot_username="",
                bot_display_name="",
            )

        if status.token_masked:
            return replace(status, configured=True, token_present=True)

        secret = self._secret_store.get_secret(self._config.telegram_secret_id)
        return replace(
            status,
            configured=True,
            token_present=True,
            token_masked=mask_telegram_token(secret),
        )

    @staticmethod
    def _active_provider_for_mode(mode: Mode) -> ProviderType:
        return "openai" if mode == "online" else "ollama"

    @staticmethod
    def _validate_mode_provider_pair(mode: Mode, provider: ProviderType, policy: Policy) -> str:
        if mode == "offline" and provider != "ollama":
            return "Offline Mode currently requires the Ollama provider."
        if mode == "online" and provider != "openai":
            return "Online Mode currently requires the OpenAI provider."
        if policy == "always_offline" and mode == "online":
            return "Always Offline policy blocks Online Mode activation. Choose Offline Mode or a different policy."
        if policy == "always_online" and mode == "offline":
            return "Always Online policy blocks Offline Mode activation. Choose Online Mode or a different policy."
        return ""

    def _normalize_repo_root_config(self) -> None:
        raw_value = self._config.repo_root.strip()
        if not raw_value:
            normalized = str(Path(__file__).resolve().parents[2])
        else:
            try:
                candidate = Path(raw_value)
                normalized = str(candidate.resolve(strict=False)) if not candidate.is_absolute() else str(candidate)
            except OSError:
                normalized = raw_value
        if normalized != self._config.repo_root:
            self._config.repo_root = normalized
            self._config_store.save(self._config)

    def _normalize_file_roots_config(self) -> None:
        raw_roots = tuple(root for root in self._config.file_allowed_roots if root.strip())
        if not raw_roots:
            raw_roots = (self._config.repo_root.strip(),)
        normalized_roots: list[str] = []
        seen: set[str] = set()
        for raw_root in raw_roots:
            candidate_text = raw_root.strip()
            if not candidate_text:
                continue
            try:
                candidate = Path(candidate_text)
                normalized = str(candidate.resolve(strict=False)) if not candidate.is_absolute() else str(candidate)
            except OSError:
                normalized = candidate_text
            if normalized not in seen:
                seen.add(normalized)
                normalized_roots.append(normalized)
        final_roots = tuple(normalized_roots)
        if final_roots != self._config.file_allowed_roots:
            self._config.file_allowed_roots = final_roots
            self._config_store.save(self._config)

    def _normalize_web_domains_config(self) -> None:
        raw_domains = tuple(domain for domain in self._config.web_allowed_domains if domain.strip())
        normalized_domains: list[str] = []
        seen: set[str] = set()
        for raw_domain in raw_domains:
            candidate = raw_domain.strip().lower()
            if not candidate:
                continue
            if "://" in candidate:
                candidate = self._host_from_url(candidate)
            else:
                candidate = candidate.split("/", 1)[0]
            if candidate.startswith("*."):
                candidate = f"*.{candidate[2:].lstrip('.')}"
            else:
                candidate = candidate.lstrip(".")
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            normalized_domains.append(candidate)
        final_domains = tuple(normalized_domains)
        if final_domains != self._config.web_allowed_domains:
            self._config.web_allowed_domains = final_domains
            self._config_store.save(self._config)

    def _repo_configuration_state(self) -> tuple[str, bool, str, str]:
        raw_value = self._config.repo_root.strip()
        if not raw_value:
            return "", False, "Repository root is not configured.", "repo_root_missing"
        candidate = Path(raw_value)
        if not candidate.is_absolute():
            return raw_value, False, "Repository root must be an absolute path.", "repo_root_not_absolute"
        try:
            resolved = candidate.resolve(strict=False)
        except OSError:
            return raw_value, False, "Repository root could not be resolved.", "repo_root_invalid"
        if not resolved.exists():
            return str(resolved), False, "Repository not found at configured path.", "repo_not_found"
        if not resolved.is_dir():
            return str(resolved), False, "Repository root is not a directory.", "repo_root_not_directory"
        return str(resolved), True, f"Repository root ready: {resolved.name}.", "repo_ready"

    def _file_scope_state(self) -> tuple[tuple[str, ...], bool, str, str]:
        usable_roots: list[str] = []
        invalid_absolute = False
        for raw_root in self._config.file_allowed_roots:
            candidate_text = raw_root.strip()
            if not candidate_text:
                continue
            candidate = Path(candidate_text)
            if not candidate.is_absolute():
                invalid_absolute = True
                continue
            try:
                resolved = candidate.resolve(strict=False)
            except OSError:
                continue
            if resolved.exists() and resolved.is_dir():
                usable_roots.append(str(resolved))
        roots = tuple(dict.fromkeys(usable_roots))
        if roots:
            return roots, True, f"File preview is scoped to {len(roots)} allowed director{'y' if len(roots) == 1 else 'ies'}.", "file_scope_ready"
        if invalid_absolute:
            return (), False, "Allowed file directories must use absolute paths.", "file_roots_not_absolute"
        return (), False, "No allowed file directories are configured.", "file_roots_missing"

    def _web_scope_state(self) -> tuple[tuple[str, ...], bool, str, str]:
        allowed_domains = tuple(domain for domain in self._config.web_allowed_domains if domain.strip())
        if allowed_domains:
            return allowed_domains, True, f"Web fetch is scoped to {len(allowed_domains)} allowed domain{'s' if len(allowed_domains) != 1 else ''}.", "web_scope_ready"
        return (), False, "No allowed web domains are configured.", "web_scope_missing"

    def _repo_display_name(self, repo_root: str = "") -> str:
        candidate = repo_root.strip() or self._config.repo_root.strip()
        if not candidate:
            return "Configured Repo"
        path = Path(candidate)
        return path.name or candidate

    @staticmethod
    def _file_roots_summary(roots: tuple[str, ...]) -> str:
        if not roots:
            return "-"
        labels = [Path(root).name or root for root in roots[:2]]
        if len(roots) > 2:
            labels.append(f"+{len(roots) - 2} more")
        return ", ".join(labels)

    @staticmethod
    def _web_domains_summary(domains: tuple[str, ...]) -> str:
        if not domains:
            return "-"
        labels = list(domains[:3])
        if len(domains) > 3:
            labels.append(f"+{len(domains) - 3} more")
        return ", ".join(labels)

    def _describe_current_context_freshness(self, current_context: BufferedContext | None) -> str:
        if current_context is None:
            return "none"
        freshness = self._context_store.freshness_of(current_context)
        if freshness == "stale":
            return "stale"
        if freshness == "expired":
            return "expired"
        return "active"

    def inspect_repo_status(self) -> RepoInspectionSnapshot:
        repo_root, repo_root_valid, repo_message, repo_code = self._repo_configuration_state()
        if not repo_root_valid:
            raise RepoInspectorError(repo_code, repo_message)
        return self._repo_inspector.inspect(repo_root, commit_limit=4)

    def resolve_file_request(self, relative_path: str) -> tuple[str, str, tuple[str, ...], str, str]:
        requested = relative_path.strip()
        if not requested:
            return "", "", (), "missing_file_path", "Use /file <relative_path>."
        candidate_path = Path(requested)
        if candidate_path.is_absolute():
            return requested, "", (), "absolute_path_not_allowed", "Use /file <relative_path> inside the allowed directories."
        if any(part == ".." for part in candidate_path.parts):
            return requested.replace("\\", "/"), "", (), "target_path_not_allowed", "File is outside allowed directories."

        allowed_roots, roots_valid, roots_message, roots_code = self._file_scope_state()
        if not roots_valid:
            return requested.replace("\\", "/"), "", allowed_roots, roots_code, roots_message

        requested_display = requested.replace("\\", "/")
        first_scoped_target = ""
        for root in allowed_roots:
            try:
                target = (Path(root) / candidate_path).resolve(strict=False)
                target.relative_to(Path(root).resolve())
            except (OSError, ValueError):
                continue
            if not first_scoped_target:
                first_scoped_target = str(target)
            if target.exists() and target.is_file():
                return requested_display, str(target), allowed_roots, "file_target_ready", "Scoped file target is ready."
        if first_scoped_target:
            return requested_display, first_scoped_target, allowed_roots, "file_not_found", "File not found in allowed scope."
        return requested_display, "", allowed_roots, "target_path_not_allowed", "File is outside allowed directories."

    def resolve_file_creation_request(self, relative_path: str) -> tuple[str, str, tuple[str, ...], tuple[str, ...], str, str]:
        requested = relative_path.strip()
        if not requested:
            return "", "", (), (), "missing_file_path", "Use /createfile <relative_path>."
        candidate_path = Path(requested)
        if candidate_path.is_absolute():
            return requested, "", (), (), "absolute_path_not_allowed", "Use /createfile <relative_path> inside the allowed directories."
        if any(part == ".." for part in candidate_path.parts):
            return requested.replace("\\", "/"), "", (), (), "target_path_not_allowed", "File is outside allowed directories."

        allowed_roots, roots_valid, roots_message, roots_code = self._file_scope_state()
        if not roots_valid:
            return requested.replace("\\", "/"), "", allowed_roots, (), roots_code, roots_message

        requested_display = requested.replace("\\", "/")
        candidate_matches: list[tuple[str, tuple[str, ...]]] = []
        for root in allowed_roots:
            try:
                resolved_root = Path(root).resolve()
                target = (resolved_root / candidate_path).resolve(strict=False)
                target.relative_to(resolved_root)
            except (OSError, ValueError):
                continue
            if target.exists():
                if target.is_file():
                    return requested_display, str(target), allowed_roots, (), "file_already_exists", "File already exists. Use /writefile or /patchfile for existing files."
                return requested_display, str(target), allowed_roots, (), "file_target_is_directory", "Target path already exists as a directory."
            if target.parent.exists() and not target.parent.is_dir():
                return requested_display, str(target), allowed_roots, (), "parent_not_directory", "Parent path is not a directory."

            missing_directories: list[str] = []
            current = target.parent
            while current != resolved_root and not current.exists():
                try:
                    relative_parent = current.relative_to(resolved_root)
                except ValueError:
                    return requested_display, "", allowed_roots, (), "target_path_not_allowed", "File is outside allowed directories."
                missing_directories.append(relative_parent.as_posix())
                current = current.parent
            candidate_matches.append((str(target), tuple(reversed(missing_directories))))

        if not candidate_matches:
            return requested_display, "", allowed_roots, (), "target_path_not_allowed", "File is outside allowed directories."
        if len(candidate_matches) > 1:
            return requested_display, "", allowed_roots, (), "file_scope_ambiguous", "File does not exist yet and multiple allowed roots are configured. Narrow the file scope before creating a new file."
        target_path, missing_directories = candidate_matches[0]
        return requested_display, target_path, allowed_roots, missing_directories, "file_create_ready", "Scoped file target is ready for creation."

    def read_file_preview(self, relative_path: str) -> FileReadSnapshot:
        display_path, target_path, _, reason_code, message = self.resolve_file_request(relative_path)
        if reason_code != "file_target_ready" or not target_path:
            raise FileReaderError(reason_code, message)
        return self._file_reader.read_text_preview(target_path, display_path=display_path)

    def resolve_web_request(self, target_url: str) -> tuple[str, str, tuple[str, ...], str, str, str]:
        requested = " ".join(target_url.split())
        if not requested:
            return "", "", (), "", "missing_url", "Use /web <https://allowed-domain/path>."

        allowed_domains, scope_valid, scope_message, scope_code = self._web_scope_state()
        if not scope_valid:
            return requested, "", allowed_domains, "", scope_code, scope_message

        try:
            normalized_url = WebFetcher.normalize_target_url(requested)
        except WebFetchError as exc:
            return requested, "", allowed_domains, "", exc.code, exc.message

        target_domain = self._host_from_url(normalized_url)
        return self._sanitize_url_for_display(normalized_url), normalized_url, allowed_domains, target_domain, "web_target_ready", "Scoped web target is ready."

    def fetch_web_preview(self, target_url: str) -> WebFetchSnapshot:
        display_url, normalized_url, allowed_domains, _, reason_code, message = self.resolve_web_request(target_url)
        if reason_code != "web_target_ready" or not normalized_url:
            raise WebFetchError(reason_code, message)
        return self._web_fetcher.fetch_text_preview(normalized_url, allowed_domains=allowed_domains)

    def _build_repo_reply(self, inspection: RepoInspectionSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"Repo: {inspection.repo_name}",
            f"Branch: {inspection.branch}",
            f"Status: {inspection.status_label}",
        ]
        if inspection.recent_commits:
            lines.append("Recent commits:")
            lines.extend(f"- {commit}" for commit in inspection.recent_commits[:4])
        else:
            lines.append("Recent commits: none yet")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/repo",
        )

    def _build_file_reply(self, preview: FileReadSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"File: {preview.display_path}",
            f"Size: {preview.size_label}",
            "Preview:",
            preview.preview_text,
        ]
        if preview.oversized:
            lines.append("Note: Large file preview truncated for safety.")
        elif preview.truncated:
            lines.append("Note: Preview truncated.")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/file",
        )

    def _build_web_reply(self, preview: WebFetchSnapshot) -> _TelegramResponsePlan:
        lines = [
            f"Web: {preview.domain}",
            f"Type: {preview.content_type}",
            f"URL: {preview.display_url}",
            "Preview:",
            preview.preview_text,
        ]
        if preview.display_url.startswith("http://"):
            lines.append("Note: HTTP preview allowed for this request; prefer HTTPS when available.")
        if preview.redirected:
            lines.append("Note: Followed an allowed redirect that stayed within the configured web scope.")
        if preview.oversized:
            lines.append("Note: Large web preview truncated for safety.")
        elif preview.truncated:
            lines.append("Note: Preview truncated.")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/web",
        )

    def create_context_buffer(
        self,
        *,
        source_capability_id: str,
        source_command: str,
        scope_type: str,
        source_summary: str,
        content_kind: str,
        normalized_content: str,
        content_preview: str,
        size_class: str,
        chat_id: str,
        user_id: str,
        request_id: str,
    ) -> BufferedContext:
        normalized = self._summarize_text(normalized_content, limit=2400)
        preview = self._summarize_text(content_preview or normalized, limit=240)
        summary = self._summarize_text(source_summary, limit=96)
        truncated = size_class in {"truncated", "large"}
        trust_summary = self._format_manifest_trust_summary(self._capability_manifest(source_capability_id))
        return self._context_store.create(
            source_capability_id=source_capability_id,
            source_command=source_command,
            scope_type=scope_type,  # type: ignore[arg-type]
            source_summary=summary,
            content_kind=content_kind,  # type: ignore[arg-type]
            content_preview=preview,
            normalized_content=normalized,
            size_class=size_class,  # type: ignore[arg-type]
            truncated=truncated,
            trust_summary=trust_summary,
            user_id=user_id,
            chat_id=chat_id,
            originating_request_id=request_id,
        )

    def latest_context_for_chat(self, *, chat_id: str) -> BufferedContext | None:
        self._cleanup_expired_contexts()
        return self._context_store.latest(chat_id=chat_id)

    def resolve_context_for_chat(self, *, chat_id: str, reference: str) -> BufferedContext | None:
        self._cleanup_expired_contexts()
        return self._context_store.resolve(chat_id=chat_id, reference=reference)

    def recent_contexts_for_chat(self, *, chat_id: str, limit: int = 5) -> tuple[BufferedContext, ...]:
        self._cleanup_expired_contexts()
        return self._context_store.recent(chat_id=chat_id, limit=limit)

    def clear_contexts_for_chat(self, *, chat_id: str) -> int:
        cleared = self._context_store.clear(chat_id=chat_id)
        if self._context_store.total_count() == 0:
            self._last_context_source = "No buffered context yet."
        return cleared

    def _cleanup_expired_contexts(self) -> None:
        expired = self._context_store.cleanup_expired()
        if expired and self._context_store.total_count() == 0:
            self._last_context_source = "No buffered context yet."
        latest = self._context_store.latest_any()
        if latest is None:
            self._last_context_source = "No buffered context yet."

    def _cleanup_expired_workflows(self) -> None:
        self._workflow_executor.cleanup_expired_workflows()

    def _context_ready_note(self, context: BufferedContext) -> str:
        return f"Context: {context.context_id} ready for /asklast or /askctx {context.context_id} <prompt>."

    def save_pending_patch_draft(
        self,
        *,
        chat_id: str,
        relative_path: str,
        raw_argument: str,
        summary: str,
        source_kind: str = "",
        source_context_id: str = "",
    ) -> None:
        normalized_path = relative_path.strip().replace("\\", "/")
        self._pending_patch_drafts[chat_id] = _PendingPatchDraft(
            relative_path=normalized_path,
            raw_argument=raw_argument,
            summary=self._summarize_text(summary.strip() or normalized_path, limit=160),
            source_kind=source_kind.strip(),
            source_context_id=source_context_id.strip().upper(),
            created_at_utc=self._now_iso(),
            is_patch_eligible=True,
        )

    def clear_pending_patch_draft(self, *, chat_id: str) -> None:
        self._pending_patch_drafts.pop(chat_id, None)

    def consume_pending_patch_draft(self, *, chat_id: str, relative_path: str) -> str:
        normalized_path = relative_path.strip().replace("\\", "/")
        draft = self._pending_patch_drafts.get(chat_id)
        if draft is None or draft.relative_path.lower() != normalized_path.lower():
            return ""
        self._pending_patch_drafts.pop(chat_id, None)
        return draft.raw_argument

    def pending_patch_draft_summary(self, *, chat_id: str, relative_path: str) -> str:
        normalized_path = relative_path.strip().replace("\\", "/")
        draft = self._pending_patch_drafts.get(chat_id)
        if draft is None or not draft.is_patch_eligible or draft.relative_path.lower() != normalized_path.lower():
            return ""
        return draft.summary

    def active_generated_project_for_chat(self, *, chat_id: str) -> GeneratedProjectRecord | None:
        return self._generated_project_store.get_active(chat_id=chat_id)

    def set_active_generated_project(self, *, chat_id: str, project: GeneratedProjectRecord) -> None:
        self._generated_project_store.set_active(chat_id=chat_id, project=project)

    def clear_active_generated_project(self, *, chat_id: str) -> GeneratedProjectRecord | None:
        return self._generated_project_store.clear_active(chat_id=chat_id)

    def latest_run_for_chat(self, *, chat_id: str) -> LastRunRecord | None:
        return self._last_run_store.get_latest(chat_id=chat_id)

    def list_data_records(self, *, limit: int = 8) -> tuple[DataRecord, ...]:
        return self._data_record_store.list_records(limit=max(1, min(limit, 20)))

    def list_all_data_records(self) -> tuple[DataRecord, ...]:
        return self._data_record_store.iter_records(reverse=True)

    def get_data_record(self, record_id: str) -> DataRecord | None:
        return self._data_record_store.get(record_id)

    def search_data_records(self, *, filters: dict[str, str], limit: int = 8) -> tuple[DataRecord, ...]:
        return self._data_record_store.search(filters=filters, limit=max(1, min(limit, 20)))

    def get_record_label_state(self, record_id: str) -> RecordLabelState | None:
        return self._dataset_store.get_record_label_state(record_id)

    def label_data_record(self, *, record_id: str, label: str) -> RecordLabelState:
        record = self.get_data_record(record_id)
        if record is None:
            raise ValueError(f"No record matched {record_id.strip().upper() or '(empty)'}.")
        normalized_label = normalize_primary_label(label)
        if not normalized_label:
            raise ValueError("Label must be one of training, evaluation_only, discarded, debug, or review_needed.")
        existing = self.get_record_label_state(record.record_id)
        state = RecordLabelState(
            record_id=record.record_id,
            primary_label=normalized_label,
            tags=existing.tags if existing is not None else (),
            updated_at=self._now_iso(),
        )
        stored = self._dataset_store.upsert_record_label_state(state)
        self._refresh_all_dataset_memberships_for_record(record.record_id)
        return stored

    def unlabel_data_record(self, *, record_id: str, expected_label: str = "") -> RecordLabelState:
        record = self.get_data_record(record_id)
        if record is None:
            raise ValueError(f"No record matched {record_id.strip().upper() or '(empty)'}.")
        existing = self.get_record_label_state(record.record_id)
        if existing is None or not existing.primary_label:
            raise ValueError(f"Record {record.record_id} does not have a curation label yet.")
        normalized_expected = normalize_primary_label(expected_label) if expected_label.strip() else ""
        if normalized_expected and normalized_expected != existing.primary_label:
            raise ValueError(f"Record {record.record_id} is labeled {existing.primary_label}, not {normalized_expected}.")
        stored = self._dataset_store.upsert_record_label_state(
            RecordLabelState(
                record_id=record.record_id,
                primary_label="",
                tags=existing.tags,
                updated_at=self._now_iso(),
            )
        )
        self._refresh_all_dataset_memberships_for_record(record.record_id)
        return stored

    def tag_data_record(self, *, record_id: str, tag: str) -> RecordLabelState:
        record = self.get_data_record(record_id)
        if record is None:
            raise ValueError(f"No record matched {record_id.strip().upper() or '(empty)'}.")
        normalized_tag = normalize_tag(tag)
        if not normalized_tag:
            raise ValueError("Tag must contain at least one letter or digit.")
        existing = self.get_record_label_state(record.record_id)
        tags: list[str] = list(existing.tags if existing is not None else ())
        if normalized_tag not in tags:
            tags.append(normalized_tag)
        stored = self._dataset_store.upsert_record_label_state(
            RecordLabelState(
                record_id=record.record_id,
                primary_label=existing.primary_label if existing is not None else "",
                tags=tuple(tags),
                updated_at=self._now_iso(),
            )
        )
        return stored

    def list_datasets(self) -> tuple[DatasetRecord, ...]:
        return tuple(self._refresh_dataset_record(record) for record in self._dataset_store.list_datasets())

    def get_dataset(self, dataset_id: str) -> DatasetRecord | None:
        dataset = self._dataset_store.get_dataset(dataset_id)
        if dataset is None:
            return None
        return self._refresh_dataset_record(dataset)

    def dataset_memberships(self, dataset_id: str) -> tuple[DatasetMembershipRecord, ...]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            return ()
        return self._dataset_store.memberships_for_dataset(dataset.dataset_id)

    def create_dataset_from_filters(
        self,
        *,
        title: str,
        description: str,
        filters: dict[str, str],
        allow_empty: bool = False,
    ) -> DatasetRecord:
        normalized_title = " ".join(title.split())
        if not normalized_title:
            raise ValueError("Dataset title is required.")
        normalized_filters = self._normalize_dataset_filters(filters)
        if not normalized_filters:
            raise ValueError("At least one dataset filter is required.")
        matches = self._filter_records_for_dataset(filters=normalized_filters)
        if not matches and not allow_empty:
            raise ValueError("No records matched the provided filters. Use --allow-empty true to create an empty dataset.")
        now = self._now_iso()
        dataset = DatasetRecord(
            dataset_id=self._dataset_store.generate_dataset_id(),
            title=normalized_title,
            description=" ".join(description.split()),
            created_at=now,
            updated_at=now,
            source_scope=f"records matching {self._describe_dataset_filters(normalized_filters)}",
            tags=tuple(item for item in (normalize_tag(normalized_filters.get("tag", "")),) if item),
            selection_filters=normalized_filters,
        )
        memberships = tuple(
            DatasetMembershipRecord(
                dataset_id=dataset.dataset_id,
                record_id=record.record_id,
                inclusion_reason=self._describe_dataset_filters(normalized_filters),
                label=self._current_curation_label(record.record_id),
                split="",
                added_at=now,
            )
            for record in sorted(matches, key=lambda item: (item.captured_at, item.record_id))
        )
        self._dataset_store.create_dataset(dataset)
        self._dataset_store.replace_memberships(dataset.dataset_id, memberships)
        return self.get_dataset(dataset.dataset_id) or dataset

    def add_record_to_dataset(self, *, dataset_id: str, record_id: str) -> tuple[DatasetRecord, bool]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        record = self.get_data_record(record_id)
        if record is None:
            raise ValueError(f"No record matched {record_id.strip().upper() or '(empty)'}.")
        membership, created = self._dataset_store.upsert_membership(
            DatasetMembershipRecord(
                dataset_id=dataset.dataset_id,
                record_id=record.record_id,
                inclusion_reason="manual add",
                label=self._current_curation_label(record.record_id),
                split="",
                added_at=self._now_iso(),
            )
        )
        if not created:
            membership = DatasetMembershipRecord.from_payload({**membership.to_payload(), "inclusion_reason": membership.inclusion_reason or "manual add"})
            self._dataset_store.upsert_membership(membership)
        refreshed = self.get_dataset(dataset.dataset_id)
        return refreshed or dataset, created

    def remove_record_from_dataset(self, *, dataset_id: str, record_id: str) -> DatasetRecord:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        removed = self._dataset_store.remove_membership(dataset.dataset_id, record_id)
        if not removed:
            raise ValueError(f"Record {record_id.strip().upper() or '(empty)'} is not in dataset {dataset.dataset_id}.")
        return self.get_dataset(dataset.dataset_id) or dataset

    def add_dataset_records_by_filter(self, *, dataset_id: str, filters: dict[str, str]) -> tuple[DatasetRecord, int]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        normalized_filters = self._normalize_dataset_filters(filters)
        if not normalized_filters:
            raise ValueError("At least one dataset filter is required.")
        matches = self._filter_records_for_dataset(filters=normalized_filters)
        if not matches:
            raise ValueError("No records matched the provided filters.")
        created_count = 0
        reason = self._describe_dataset_filters(normalized_filters)
        for record in matches:
            _, created = self._dataset_store.upsert_membership(
                DatasetMembershipRecord(
                    dataset_id=dataset.dataset_id,
                    record_id=record.record_id,
                    inclusion_reason=reason,
                    label=self._current_curation_label(record.record_id),
                    split="",
                    added_at=self._now_iso(),
                )
            )
            if created:
                created_count += 1
        refreshed = self.get_dataset(dataset.dataset_id)
        return refreshed or dataset, created_count

    def label_dataset_records(self, *, dataset_id: str, label: str) -> tuple[DatasetRecord, int]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        memberships = self._dataset_store.memberships_for_dataset(dataset.dataset_id)
        if not memberships:
            raise ValueError(f"Dataset {dataset.dataset_id} has no records to label.")
        count = 0
        for membership in memberships:
            self.label_data_record(record_id=membership.record_id, label=label)
            count += 1
        refreshed = self.get_dataset(dataset.dataset_id)
        return refreshed or dataset, count

    def assign_dataset_splits(
        self,
        *,
        dataset_id: str,
        mode: str,
        train_percent: int,
        eval_percent: int,
        holdout_percent: int,
    ) -> DatasetRecord:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        normalized_mode = " ".join(mode.split()).lower() or "deterministic"
        if normalized_mode != "deterministic":
            raise ValueError("Only deterministic split mode is supported in v001.")
        if min(train_percent, eval_percent, holdout_percent) < 0:
            raise ValueError("Split percentages cannot be negative.")
        if train_percent + eval_percent + holdout_percent != 100:
            raise ValueError("Split percentages must add up to 100.")
        memberships = list(self._dataset_store.memberships_for_dataset(dataset.dataset_id))
        if not memberships:
            raise ValueError(f"Dataset {dataset.dataset_id} has no records to split.")
        ordered = sorted(memberships, key=lambda item: self._split_sort_key(dataset.dataset_id, item.record_id))
        total = len(ordered)
        train_count = (total * train_percent) // 100
        eval_count = (total * eval_percent) // 100
        holdout_count = total - train_count - eval_count
        updated: list[DatasetMembershipRecord] = []
        for index, membership in enumerate(ordered):
            split = "holdout"
            if index < train_count:
                split = "train"
            elif index < train_count + eval_count:
                split = "eval"
            elif holdout_count >= 0:
                split = "holdout"
            updated.append(replace(membership, split=split, label=self._current_curation_label(membership.record_id)))
        self._dataset_store.replace_memberships(dataset.dataset_id, tuple(updated))
        return self.get_dataset(dataset.dataset_id) or dataset

    def export_dataset(self, *, dataset_id: str, export_format: str = "jsonl", split: str = ""):
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        memberships = self._dataset_store.memberships_for_dataset(dataset.dataset_id)
        if not memberships:
            raise ValueError(f"Dataset {dataset.dataset_id} has no records to export.")
        normalized_format = normalize_export_format(export_format)
        normalized_split = normalize_dataset_split(split)
        records: list[DataRecord] = []
        curations: dict[str, RecordLabelState] = {}
        for membership in memberships:
            if normalized_split and membership.split != normalized_split:
                continue
            record = self.get_data_record(membership.record_id)
            if record is None:
                continue
            records.append(record)
            curation = self.get_record_label_state(record.record_id)
            if curation is not None:
                curations[record.record_id] = curation
        if not records:
            split_message = f" for split {normalized_split}" if normalized_split else ""
            raise ValueError(f"Dataset {dataset.dataset_id} has no exportable records{split_message}.")
        export = self._dataset_exporter.export_dataset(
            dataset=dataset,
            memberships=memberships,
            records=tuple(records),
            curations=curations,
            export_id=self._dataset_store.generate_export_id(),
            exported_at=self._now_iso(),
            export_format=normalized_format,
            split=normalized_split,
        )
        self._dataset_store.append_export(export)
        self._dataset_store.update_dataset(replace(dataset, updated_at=self._now_iso(), status="exported"))
        return export

    def dataset_records_with_membership(self, dataset_id: str) -> tuple[tuple[DatasetMembershipRecord, DataRecord, RecordLabelState | None], ...]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            return ()
        rows: list[tuple[DatasetMembershipRecord, DataRecord, RecordLabelState | None]] = []
        for membership in self._dataset_store.memberships_for_dataset(dataset.dataset_id):
            record = self.get_data_record(membership.record_id)
            if record is None:
                continue
            rows.append((membership, record, self.get_record_label_state(record.record_id)))
        return tuple(rows)

    def list_source_policies(
        self,
        *,
        usage_class: str = "",
        review_status: str = "",
        status: str = "",
        source_type: str = "",
        tag: str = "",
        operation: str = "",
    ) -> tuple[SourcePolicyRecord, ...]:
        usage_filter = normalize_usage_class(usage_class) if usage_class.strip() else ""
        review_filter = normalize_review_status(review_status) if review_status.strip() else ""
        status_filter = normalize_source_policy_status(status) if status.strip() else ""
        type_filter = normalize_source_type(source_type) if source_type.strip() else ""
        tag_filter = normalize_policy_tag(tag) if tag.strip() else ""
        operation_filter = normalize_allowed_operation(operation) if operation.strip() else ""
        rows: list[SourcePolicyRecord] = []
        for record in self._data_policy_store.list_source_policies():
            normalized = self._data_policy_rules.normalize_record(record)
            if usage_filter and normalized.usage_class != usage_filter:
                continue
            if review_filter and normalized.review_status != review_filter:
                continue
            if status_filter and normalized.status != status_filter:
                continue
            if type_filter and normalized.source_type != type_filter:
                continue
            if tag_filter and tag_filter not in normalized.tags:
                continue
            if operation_filter and operation_filter not in normalized.allowed_operations:
                continue
            rows.append(normalized)
        return tuple(rows)

    def get_source_policy(self, source_id: str) -> SourcePolicyRecord | None:
        record = self._data_policy_store.get_source_policy(source_id)
        if record is None:
            return None
        return self._data_policy_rules.normalize_record(record)

    def create_source_policy(
        self,
        *,
        source_name: str,
        source_type: str,
        source_locator: str,
        usage_class: str = "requires_review",
        status: str = "draft",
        review_status: str = "draft",
        owner: str = "",
        source_scope: str = "",
        collection_method_class: str = "manual_declaration",
        policy_notes: str = "",
        content_license_note: str = "",
        robots_note: str = "",
        terms_note: str = "",
        retention_policy: str = "",
        training_eligibility_reason: str = "",
        blocked_reason: str = "",
        review_required: bool = True,
        reviewer: str = "",
        tags: tuple[str, ...] = (),
        provenance_requirements: tuple[str, ...] = (),
        allowed_operations: tuple[str, ...] = (),
    ) -> SourcePolicyRecord:
        normalized_name = " ".join(source_name.split())
        normalized_locator = source_locator.strip()
        if not normalized_name:
            raise ValueError("Datasource name is required.")
        if not normalized_locator:
            raise ValueError("Datasource locator is required.")
        now = self._now_iso()
        record = SourcePolicyRecord(
            source_id=self._data_policy_store.generate_source_id(),
            source_name=normalized_name,
            source_type=normalize_source_type(source_type),
            source_locator=normalized_locator,
            created_at=now,
            updated_at=now,
            usage_class=normalize_usage_class(usage_class),
            status=normalize_source_policy_status(status),
            review_status=normalize_review_status(review_status),
            owner=" ".join(owner.split()),
            source_scope=" ".join(source_scope.split()),
            collection_method_class="_".join(collection_method_class.strip().lower().replace("-", "_").split()) or "manual_declaration",
            policy_notes=" ".join(policy_notes.split()),
            content_license_note=" ".join(content_license_note.split()),
            robots_note=" ".join(robots_note.split()),
            terms_note=" ".join(terms_note.split()),
            retention_policy=" ".join(retention_policy.split()),
            training_eligibility_reason=" ".join(training_eligibility_reason.split()),
            blocked_reason=" ".join(blocked_reason.split()),
            review_required=review_required,
            reviewer=" ".join(reviewer.split()),
            reviewed_at=now if reviewer.strip() and normalize_review_status(review_status) in {"approved", "rejected", "suspended"} else "",
            tags=tuple(normalize_policy_tag(item) for item in tags if normalize_policy_tag(item)),
            provenance_requirements=tuple(" ".join(item.split()) for item in provenance_requirements if " ".join(item.split())),
            allowed_operations=tuple(normalized for item in allowed_operations if (normalized := normalize_allowed_operation(item))),
        )
        normalized_record = self._data_policy_rules.normalize_record(record)
        return self._data_policy_store.save_source_policy(normalized_record)

    def update_source_policy(
        self,
        *,
        source_id: str,
        source_name: str | None = None,
        source_type: str | None = None,
        source_locator: str | None = None,
        usage_class: str | None = None,
        status: str | None = None,
        owner: str | None = None,
        source_scope: str | None = None,
        collection_method_class: str | None = None,
        policy_notes: str | None = None,
        content_license_note: str | None = None,
        robots_note: str | None = None,
        terms_note: str | None = None,
        retention_policy: str | None = None,
        training_eligibility_reason: str | None = None,
        blocked_reason: str | None = None,
        review_required: bool | None = None,
        tags: tuple[str, ...] | None = None,
        provenance_requirements: tuple[str, ...] | None = None,
        allowed_operations: tuple[str, ...] | None = None,
    ) -> SourcePolicyRecord:
        record = self.get_source_policy(source_id)
        if record is None:
            raise ValueError(f"No datasource matched {source_id.strip().upper() or '(empty)'}.")
        updated = replace(
            record,
            source_name=" ".join(source_name.split()) if source_name is not None else record.source_name,
            source_type=normalize_source_type(source_type) if source_type is not None else record.source_type,
            source_locator=source_locator.strip() if source_locator is not None else record.source_locator,
            usage_class=normalize_usage_class(usage_class) if usage_class is not None else record.usage_class,
            status=normalize_source_policy_status(status) if status is not None else record.status,
            owner=" ".join(owner.split()) if owner is not None else record.owner,
            source_scope=" ".join(source_scope.split()) if source_scope is not None else record.source_scope,
            collection_method_class=("_".join(collection_method_class.strip().lower().replace("-", "_").split()) or "manual_declaration") if collection_method_class is not None else record.collection_method_class,
            policy_notes=" ".join(policy_notes.split()) if policy_notes is not None else record.policy_notes,
            content_license_note=" ".join(content_license_note.split()) if content_license_note is not None else record.content_license_note,
            robots_note=" ".join(robots_note.split()) if robots_note is not None else record.robots_note,
            terms_note=" ".join(terms_note.split()) if terms_note is not None else record.terms_note,
            retention_policy=" ".join(retention_policy.split()) if retention_policy is not None else record.retention_policy,
            training_eligibility_reason=" ".join(training_eligibility_reason.split()) if training_eligibility_reason is not None else record.training_eligibility_reason,
            blocked_reason=" ".join(blocked_reason.split()) if blocked_reason is not None else record.blocked_reason,
            review_required=review_required if review_required is not None else record.review_required,
            tags=tuple(normalize_policy_tag(item) for item in tags if normalize_policy_tag(item)) if tags is not None else record.tags,
            provenance_requirements=tuple(" ".join(item.split()) for item in provenance_requirements if " ".join(item.split())) if provenance_requirements is not None else record.provenance_requirements,
            allowed_operations=tuple(normalized for item in allowed_operations if (normalized := normalize_allowed_operation(item))) if allowed_operations is not None else record.allowed_operations,
            updated_at=self._now_iso(),
        )
        normalized = self._data_policy_rules.normalize_record(updated)
        return self._data_policy_store.save_source_policy(normalized)

    def review_source_policy(
        self,
        *,
        source_id: str,
        review_status: str,
        reviewer: str = "",
        note: str = "",
    ) -> SourcePolicyRecord:
        record = self.get_source_policy(source_id)
        if record is None:
            raise ValueError(f"No datasource matched {source_id.strip().upper() or '(empty)'}.")
        normalized_review = normalize_review_status(review_status)
        reviewed_at = self._now_iso()
        history = list(record.approval_history)
        history.append(
            SourcePolicyApprovalRecord(
                review_status=normalized_review,
                reviewer=" ".join(reviewer.split()),
                note=" ".join(note.split()),
                reviewed_at=reviewed_at,
            )
        )
        updated = replace(
            record,
            review_status=normalized_review,
            reviewer=" ".join(reviewer.split()),
            reviewed_at=reviewed_at,
            approval_history=tuple(history),
            updated_at=reviewed_at,
            status="active" if normalized_review == "approved" and record.status == "draft" else record.status,
        )
        normalized = self._data_policy_rules.normalize_record(updated)
        return self._data_policy_store.save_source_policy(normalized)

    def set_source_policy_usage(
        self,
        *,
        source_id: str,
        usage_class: str,
        reviewer: str = "",
        note: str = "",
        training_eligibility_reason: str | None = None,
    ) -> SourcePolicyRecord:
        record = self.get_source_policy(source_id)
        if record is None:
            raise ValueError(f"No datasource matched {source_id.strip().upper() or '(empty)'}.")
        updated = replace(
            record,
            usage_class=normalize_usage_class(usage_class),
            allowed_operations=(),
            reviewer=" ".join(reviewer.split()) or record.reviewer,
            training_eligibility_reason=(" ".join(training_eligibility_reason.split()) if training_eligibility_reason is not None else record.training_eligibility_reason),
            policy_notes=" ".join(part for part in (record.policy_notes, " ".join(note.split())) if part),
            updated_at=self._now_iso(),
        )
        normalized = self._data_policy_rules.normalize_record(updated)
        return self._data_policy_store.save_source_policy(normalized)

    def block_source_policy(
        self,
        *,
        source_id: str,
        reason: str,
        reviewer: str = "",
        note: str = "",
    ) -> SourcePolicyRecord:
        normalized_reason = " ".join(reason.split())
        if not normalized_reason:
            raise ValueError("Blocked datasources require a reason.")
        record = self.get_source_policy(source_id)
        if record is None:
            raise ValueError(f"No datasource matched {source_id.strip().upper() or '(empty)'}.")
        updated = replace(
            record,
            status="blocked",
            usage_class="blocked",
            blocked_reason=normalized_reason,
            reviewer=" ".join(reviewer.split()) or record.reviewer,
            reviewed_at=self._now_iso(),
            policy_notes=" ".join(part for part in (record.policy_notes, " ".join(note.split())) if part),
            updated_at=self._now_iso(),
        )
        normalized = self._data_policy_rules.normalize_record(updated)
        return self._data_policy_store.save_source_policy(normalized)

    def link_source_policies_to_dataset(self, *, dataset_id: str, source_policy_ids: tuple[str, ...]) -> DatasetRecord:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        normalized_ids = self._normalize_source_policy_ids(source_policy_ids)
        updated_dataset = replace(dataset, source_policy_ids=normalized_ids, updated_at=self._now_iso())
        self._dataset_store.update_dataset(updated_dataset)
        for source_id in normalized_ids:
            record = self.get_source_policy(source_id)
            if record is None:
                continue
            linked = list(record.linked_dataset_ids)
            if updated_dataset.dataset_id not in linked:
                linked.append(updated_dataset.dataset_id)
                self._data_policy_store.save_source_policy(
                    self._data_policy_rules.normalize_record(
                        replace(record, linked_dataset_ids=tuple(linked), updated_at=self._now_iso())
                    )
                )
        return self.get_dataset(updated_dataset.dataset_id) or updated_dataset

    def summarize_source_policies(self) -> dict[str, dict[str, int]]:
        usage_counts: dict[str, int] = {}
        review_counts: dict[str, int] = {}
        status_counts: dict[str, int] = {}
        type_counts: dict[str, int] = {}
        for record in self.list_source_policies():
            usage_counts[record.usage_class] = usage_counts.get(record.usage_class, 0) + 1
            review_counts[record.review_status] = review_counts.get(record.review_status, 0) + 1
            status_counts[record.status] = status_counts.get(record.status, 0) + 1
            type_counts[record.source_type] = type_counts.get(record.source_type, 0) + 1
        return {
            "usage_classes": usage_counts,
            "review_statuses": review_counts,
            "statuses": status_counts,
            "source_types": type_counts,
        }

    def summarize_dataset_composition(self, dataset_id: str) -> dict[str, dict[str, int]]:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        type_counts: dict[str, int] = {}
        source_counts: dict[str, int] = {}
        for _, record, _ in self.dataset_records_with_membership(dataset.dataset_id):
            type_counts[record.record_type] = type_counts.get(record.record_type, 0) + 1
            source_counts[record.source] = source_counts.get(record.source, 0) + 1
        return {
            "types": type_counts,
            "sources": source_counts,
            "labels": dict(dataset.labels_summary),
            "splits": dict(dataset.split_summary),
        }

    def list_model_experiments(self) -> tuple[ModelExperimentRecord, ...]:
        return self._model_experiment_store.list_experiments()

    def get_model_experiment(self, experiment_id: str) -> ModelExperimentRecord | None:
        return self._model_experiment_store.get_experiment(experiment_id)

    def create_model_experiment(
        self,
        *,
        title: str,
        task_type: str,
        dataset_id: str,
        baseline: str = "rules",
        adaptation_method: str = "char_bigram_knn_v1",
        base_model: str = "rules",
        train_split: str = "train",
        eval_split: str = "eval",
        mode: str = "advisory",
        notes: str = "",
    ) -> ModelExperimentRecord:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            raise ValueError(f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")
        normalized_title = " ".join(title.split())
        if not normalized_title:
            raise ValueError("Experiment title is required.")
        normalized_task = normalize_task_type(task_type)
        if normalized_task != "command_grammar_correction":
            raise ValueError("Task must be one of: command_grammar_correction.")
        now = self._now_iso()
        experiment_id = self._model_experiment_store.generate_experiment_id()
        record = ModelExperimentRecord(
            experiment_id=experiment_id,
            title=normalized_title,
            task_type=normalized_task,
            dataset_id=dataset.dataset_id,
            created_at=now,
            updated_at=now,
            status="draft",
            base_model=" ".join(base_model.split()) or "rules",
            adaptation_method=normalize_adaptation_method(adaptation_method),
            train_split=" ".join(train_split.split()) or "train",
            eval_split=" ".join(eval_split.split()) or "eval",
            notes=" ".join(notes.split()),
            integration_status="draft",
            baseline=normalize_baseline_kind(baseline),
            mode=normalize_experiment_mode(mode),
            label_filters=dict(dataset.selection_filters),
            artifact_root=str(self._model_experiment_store.artifact_root(experiment_id)),
            source_policy_ids=tuple(dataset.source_policy_ids),
        )
        stored = self._model_experiment_store.create_experiment(record)
        self._link_source_policies_to_experiment(experiment_id=stored.experiment_id, source_policy_ids=stored.source_policy_ids)
        return stored

    def run_model_experiment(self, *, experiment_id: str) -> ModelExperimentRecord:
        experiment = self.get_model_experiment(experiment_id)
        if experiment is None:
            raise ValueError(f"No experiment matched {experiment_id.strip().upper() or '(empty)'}.")
        if experiment.status == "running":
            raise ValueError(f"Experiment {experiment.experiment_id} is already running.")
        if experiment.task_type != "command_grammar_correction":
            raise ValueError(f"Task {experiment.task_type or '(empty)'} is not supported in v001.")
        started_at = self._now_iso()
        running = self._model_experiment_store.update_experiment(
            replace(
                experiment,
                status="running",
                updated_at=started_at,
                last_error="",
                stop_requested=False,
                artifact_root=experiment.artifact_root or str(self._model_experiment_store.artifact_root(experiment.experiment_id)),
            )
        )
        try:
            export = self.export_dataset(dataset_id=running.dataset_id, export_format="jsonl", split="")
        except (ValueError, DatasetExportError) as exc:
            return self._model_experiment_store.update_experiment(
                replace(
                    running,
                    updated_at=self._now_iso(),
                    status="failed",
                    last_error=str(exc),
                    stop_requested=False,
                )
            )
        try:
            result = self._model_experiment_runner.run(
                experiment=running,
                dataset_export_path=export.file_path,
                artifact_root=running.artifact_root,
                stop_requested=lambda: bool((self.get_model_experiment(running.experiment_id) or running).stop_requested),
            )
        except ModelExperimentError as exc:
            refreshed = self.get_model_experiment(running.experiment_id) or running
            stopped = refreshed.stop_requested and "stop requested" in str(exc).lower()
            return self._model_experiment_store.update_experiment(
                replace(
                    refreshed,
                    updated_at=self._now_iso(),
                    status="stopped" if stopped else "failed",
                    integration_status="draft" if stopped else refreshed.integration_status,
                    dataset_export_id=export.export_id,
                    dataset_export_path=export.file_path,
                    last_error=str(exc),
                )
            )
        return self._model_experiment_store.update_experiment(
            replace(
                running,
                updated_at=self._now_iso(),
                status=str(result.get("status", "evaluated")),
                integration_status=str(result.get("integration_status", "evaluated")),
                metrics=dict(result.get("metrics", {})),
                artifact_paths={str(key): str(value) for key, value in dict(result.get("artifact_paths", {})).items()},
                dataset_export_id=export.export_id,
                dataset_export_path=export.file_path,
                dataset_record_count=int(result.get("dataset_record_count", 0) or 0),
                training_example_count=int(result.get("training_example_count", 0) or 0),
                evaluation_example_count=int(result.get("evaluation_example_count", 0) or 0),
                builder_name=str(result.get("builder_name", running.builder_name)),
                last_error="",
                stop_requested=False,
            )
        )

    def stop_model_experiment(self, *, experiment_id: str) -> ModelExperimentRecord:
        experiment = self.get_model_experiment(experiment_id)
        if experiment is None:
            raise ValueError(f"No experiment matched {experiment_id.strip().upper() or '(empty)'}.")
        if experiment.status != "running":
            raise ValueError(f"Experiment {experiment.experiment_id} is not currently running.")
        return self._model_experiment_store.update_experiment(
            replace(
                experiment,
                stop_requested=True,
                updated_at=self._now_iso(),
            )
        )

    def set_model_experiment_integration_status(self, *, experiment_id: str, integration_status: str) -> ModelExperimentRecord:
        experiment = self.get_model_experiment(experiment_id)
        if experiment is None:
            raise ValueError(f"No experiment matched {experiment_id.strip().upper() or '(empty)'}.")
        normalized_status = normalize_integration_status(integration_status)
        if normalized_status not in {"approved_for_advisory_use", "rejected"}:
            raise ValueError("Integration status must be approved_for_advisory_use or rejected.")
        if normalized_status == "approved_for_advisory_use":
            if experiment.status not in {"trained", "evaluated"}:
                raise ValueError(f"Experiment {experiment.experiment_id} must be trained or evaluated before advisory approval.")
            if not experiment.artifact_paths.get("model_artifact"):
                raise ValueError(f"Experiment {experiment.experiment_id} does not have a model artifact to approve.")
        return self._model_experiment_store.update_experiment(
            replace(
                experiment,
                integration_status=normalized_status,
                updated_at=self._now_iso(),
            )
        )

    def command_grammar_advisory(self, *, text: str) -> tuple[str, ModelExperimentRecord | None, float]:
        experiment = self._model_experiment_store.latest_approved_for_task(task_type="command_grammar_correction")
        if experiment is None:
            return "", None, 0.0
        model_artifact_path = experiment.artifact_paths.get("model_artifact", "")
        if not model_artifact_path:
            return "", None, 0.0
        try:
            advisory = CommandGrammarAdvisoryModel.load(artifact_path=model_artifact_path)
            suggestion, score = advisory.suggest(text=text)
        except (OSError, ValueError, json.JSONDecodeError):
            return "", None, 0.0
        normalized_input = " ".join(text.split())
        if not suggestion or suggestion == normalized_input:
            return "", None, 0.0
        if score < max(experiment.advisory_threshold, advisory.advisory_threshold):
            return "", None, score
        if parse_chat_command(text=suggestion, has_text=True).command_label == "parse_failure":
            return "", None, score
        return suggestion, experiment, score

    def _refresh_all_dataset_memberships_for_record(self, record_id: str) -> None:
        normalized = record_id.strip().upper()
        for dataset in self._dataset_store.list_datasets():
            memberships = list(self._dataset_store.memberships_for_dataset(dataset.dataset_id))
            changed = False
            for index, membership in enumerate(memberships):
                if membership.record_id != normalized:
                    continue
                next_label = self._current_curation_label(normalized)
                if membership.label != next_label:
                    memberships[index] = replace(membership, label=next_label)
                    changed = True
            if changed:
                self._dataset_store.replace_memberships(dataset.dataset_id, tuple(memberships))
                self._refresh_dataset_record(dataset)

    def _refresh_dataset_record(self, dataset: DatasetRecord) -> DatasetRecord:
        memberships = list(self._dataset_store.memberships_for_dataset(dataset.dataset_id))
        labels_summary: dict[str, int] = {}
        split_summary: dict[str, int] = {}
        changed_memberships = False
        normalized_memberships: list[DatasetMembershipRecord] = []
        for membership in memberships:
            current_label = self._current_curation_label(membership.record_id)
            next_membership = membership if membership.label == current_label else replace(membership, label=current_label)
            changed_memberships = changed_memberships or (next_membership != membership)
            normalized_memberships.append(next_membership)
            label_key = next_membership.label or "unlabeled"
            labels_summary[label_key] = labels_summary.get(label_key, 0) + 1
            if next_membership.split:
                split_summary[next_membership.split] = split_summary.get(next_membership.split, 0) + 1
        if changed_memberships:
            self._dataset_store.replace_memberships(dataset.dataset_id, tuple(normalized_memberships))
        exports = self._dataset_store.list_exports(dataset.dataset_id)
        next_status = "draft"
        if normalized_memberships:
            next_status = "curated"
        if exports:
            next_status = "exported"
        refreshed = replace(
            dataset,
            updated_at=self._now_iso() if dataset.record_count != len(normalized_memberships) or dataset.labels_summary != labels_summary or dataset.split_summary != split_summary or dataset.status != next_status else dataset.updated_at,
            record_count=len(normalized_memberships),
            labels_summary=labels_summary,
            split_summary=split_summary,
            status=next_status,
        )
        if refreshed != dataset or changed_memberships:
            self._dataset_store.update_dataset(refreshed)
        return refreshed

    def _normalize_source_policy_ids(self, source_policy_ids: tuple[str, ...] | list[str]) -> tuple[str, ...]:
        normalized: list[str] = []
        for source_id in source_policy_ids:
            candidate = str(source_id).strip().upper()
            if not candidate:
                continue
            if self.get_source_policy(candidate) is None:
                raise ValueError(f"No datasource matched {candidate}.")
            if candidate not in normalized:
                normalized.append(candidate)
        return tuple(normalized)

    def _link_source_policies_to_experiment(self, *, experiment_id: str, source_policy_ids: tuple[str, ...]) -> None:
        normalized_ids = self._normalize_source_policy_ids(source_policy_ids)
        if not normalized_ids:
            return
        for source_id in normalized_ids:
            record = self.get_source_policy(source_id)
            if record is None:
                continue
            linked = list(record.linked_experiment_ids)
            if experiment_id not in linked:
                linked.append(experiment_id)
                self._data_policy_store.save_source_policy(
                    self._data_policy_rules.normalize_record(
                        replace(record, linked_experiment_ids=tuple(linked), updated_at=self._now_iso())
                    )
                )

    def _filter_records_for_dataset(self, *, filters: dict[str, str]) -> tuple[DataRecord, ...]:
        matches: list[DataRecord] = []
        for record in self.list_all_data_records():
            curation = self.get_record_label_state(record.record_id)
            if self._record_matches_dataset_filters(record=record, curation=curation, filters=filters):
                matches.append(record)
        return tuple(matches)

    def _record_matches_dataset_filters(
        self,
        *,
        record: DataRecord,
        curation: RecordLabelState | None,
        filters: dict[str, str],
    ) -> bool:
        tag_values = set(record.tags)
        if curation is not None:
            tag_values.update(curation.tags)
        expected_label = filters.get("label", "")
        if expected_label and expected_label != (curation.primary_label if curation is not None else ""):
            return False
        expected_tag = filters.get("tag", "")
        if expected_tag and expected_tag not in tag_values:
            return False
        haystacks = {
            "id": record.record_id,
            "record_id": record.record_id,
            "type": record.record_type,
            "status": record.outcome,
            "source": record.source,
            "session_id": record.session_id,
            "chain_id": record.chain_id,
            "bundle_id": record.bundle_id,
        }
        for key, expected in filters.items():
            if key in {"label", "tag"}:
                continue
            actual = haystacks.get(key, "")
            if actual.lower() != expected.lower():
                return False
        return True

    @staticmethod
    def _normalize_dataset_filters(filters: dict[str, str]) -> dict[str, str]:
        normalized: dict[str, str] = {}
        supported = {"id", "record_id", "source", "type", "label", "tag", "status", "session_id", "chain_id", "bundle_id"}
        type_aliases = {"eval": "evaluation_run", "evaluation": "evaluation_run", "chain": "chain_step", "bundle": "feature_bundle"}
        for key, value in filters.items():
            normalized_key = str(key).strip().lower().replace("-", "_")
            normalized_value = str(value).strip()
            if not normalized_value or normalized_key not in supported:
                continue
            if normalized_key == "label":
                normalized_value = normalize_primary_label(normalized_value)
                if not normalized_value:
                    raise ValueError("Label filters must use training, evaluation_only, discarded, debug, or review_needed.")
            elif normalized_key == "tag":
                normalized_value = normalize_tag(normalized_value)
                if not normalized_value:
                    raise ValueError("Tag filters must contain at least one letter or digit.")
            elif normalized_key == "type":
                normalized_value = type_aliases.get(normalized_value.lower(), normalized_value)
            normalized[normalized_key] = normalized_value
        return normalized

    @staticmethod
    def _describe_dataset_filters(filters: dict[str, str]) -> str:
        return " ".join(f"{key}={value}" for key, value in filters.items()) or "manual selection"

    def _current_curation_label(self, record_id: str) -> str:
        state = self.get_record_label_state(record_id)
        return state.primary_label if state is not None else ""

    @staticmethod
    def _split_sort_key(dataset_id: str, record_id: str) -> str:
        return sha256(f"{dataset_id.strip().upper()}:{record_id.strip().upper()}".encode("utf-8")).hexdigest()

    def set_latest_run_for_chat(self, *, chat_id: str, record: LastRunRecord) -> None:
        self._last_run_store.set_latest(chat_id=chat_id, record=record)

    def clear_latest_run_for_chat(self, *, chat_id: str) -> LastRunRecord | None:
        return self._last_run_store.clear_latest(chat_id=chat_id)

    def latest_pending_patch_draft_for_chat(self, *, chat_id: str) -> PendingPatchDraftInfo | None:
        draft = self._pending_patch_drafts.get(chat_id)
        if draft is None or not draft.is_patch_eligible:
            return None
        return PendingPatchDraftInfo(
            relative_path=draft.relative_path,
            summary=draft.summary,
            source_kind=draft.source_kind,
            source_context_id=draft.source_context_id,
            created_at_utc=draft.created_at_utc,
        )

    def active_feature_bundle_for_chat(self, *, chat_id: str) -> FeatureBundleRecord | None:
        return self._feature_bundle_store.get_active(chat_id=chat_id)

    def active_autonomous_dev_chain_for_chat(self, *, chat_id: str) -> AutonomousDevChainRecord | None:
        return self._autonomous_dev_chains.get(chat_id)

    def set_active_feature_bundle(self, *, chat_id: str, bundle: FeatureBundleRecord) -> None:
        self._feature_bundle_store.set_active(chat_id=chat_id, bundle=bundle)

    def clear_active_feature_bundle(self, *, chat_id: str) -> FeatureBundleRecord | None:
        return self._feature_bundle_store.clear_active(chat_id=chat_id)

    def latest_feature_bundle_commit_receipt_for_chat(self, *, chat_id: str) -> FeatureBundleCommitReceipt | None:
        return self._feature_bundle_commit_receipts.get(chat_id)

    def latest_feature_bundle_milestone_for_chat(self, *, chat_id: str) -> FeatureBundleMilestoneRecord | None:
        return self._feature_bundle_milestones.get(chat_id)

    def plan_autonomous_dev_chain_for_chat(self, *, chat_id: str, prompt: str) -> tuple[AutonomousDevPlanningDecision, FeaturePlanningDecision | None]:
        planning = self._autonomous_dev_loop.plan_request(prompt=prompt, active_chain=self.active_autonomous_dev_chain_for_chat(chat_id=chat_id))
        if planning.kind != "planned":
            return planning, None
        feature_decision = self._feature_bundle_planner.plan(
            bundle_id=self._generate_feature_bundle_id(),
            prompt=planning.cleaned_prompt,
            timestamp=self._now_iso(),
            read_text=self._read_repo_text_for_feature_planner,
            path_exists=self._repo_path_exists_for_feature_planner,
        )
        if feature_decision.bundle is not None:
            self._feature_bundle_store.set_active(chat_id=chat_id, bundle=feature_decision.bundle)
            self._autonomous_dev_chains[chat_id] = self._autonomous_dev_loop.build_chain(
                chain_id=self._generate_autonomous_dev_chain_id(),
                prompt=prompt,
                cleaned_prompt=planning.cleaned_prompt,
                bundle=feature_decision.bundle,
                timestamp=self._now_iso(),
            )
        return planning, feature_decision

    def autonomous_dev_chain_status_reply(self, *, chat_id: str, include_plan: bool = False) -> str:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        if chain is None:
            return self._feature_bundle_formatter.format_no_autonomous_dev_chain()
        return self._feature_bundle_formatter.format_autonomous_dev_chain(chain, include_plan=include_plan)

    def stop_autonomous_dev_chain(self, *, chat_id: str, reason: str) -> AutonomousDevChainRecord | None:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        if chain is None:
            return None
        pending = self.latest_pending_confirmation_for_chat(chat_id=chat_id)
        if pending is not None and str(pending.metadata.get("autonomous_dev_chain_id") or "").strip() == chain.chain_id:
            self._confirmation_store.expire(pending.confirmation_id)
        updated = self._autonomous_dev_loop.mark_stopped(chain, reason=reason, updated_at=self._now_iso())
        self._autonomous_dev_chains[chat_id] = updated
        return updated

    def resume_autonomous_dev_chain(self, *, chat_id: str) -> AutonomousDevAdvanceDecision:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        if chain is None:
            return AutonomousDevAdvanceDecision(
                matched=False,
                reply=self._feature_bundle_formatter.format_no_autonomous_dev_chain(),
                summary="No active autonomous dev chain.",
            )
        if chain.status == "stopped":
            return AutonomousDevAdvanceDecision(matched=True, chain=chain, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=False), summary="Autonomous dev chain is stopped.")
        if chain.status == "completed":
            return AutonomousDevAdvanceDecision(matched=True, chain=chain, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), summary="Autonomous dev chain already completed.")
        pending = self.latest_pending_confirmation_for_chat(chat_id=chat_id)
        if pending is not None and str(pending.metadata.get("autonomous_dev_chain_id") or "").strip() == chain.chain_id:
            return AutonomousDevAdvanceDecision(
                matched=True,
                chain=chain,
                reply="\n".join((self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=False), f"Awaiting confirmation: {pending.confirmation_id}")),
                summary="Autonomous dev chain is waiting for a pending confirmation.",
            )
        while True:
            chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id) or chain
            step_name = chain.current_step
            routed_command = self._autonomous_dev_loop.next_command_for_step(step_name)
            if routed_command:
                updated = self._autonomous_dev_loop.mark_awaiting_confirmation(
                    chain,
                    step_name=step_name,
                    summary=f"{step_name} is ready and waiting for approval.",
                    updated_at=self._now_iso(),
                )
                self._autonomous_dev_chains[chat_id] = updated
                return AutonomousDevAdvanceDecision(
                    matched=True,
                    chain=updated,
                    routed_command=routed_command,
                    current_step=step_name,
                    reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=False),
                    summary=f"Autonomous dev chain reached {step_name} and requires confirmation.",
                    telemetry={"autonomous_dev_chain_id": updated.chain_id, "autonomous_dev_step": step_name},
                )
            if step_name == "validation":
                validation = self._run_autonomous_dev_validation(chat_id=chat_id)
                if validation is None:
                    blocked = self._autonomous_dev_loop.mark_blocked(chain, step_name="validation", reason="The active feature bundle no longer has a bounded validation command.", updated_at=self._now_iso())
                    self._autonomous_dev_chains[chat_id] = blocked
                    return AutonomousDevAdvanceDecision(matched=True, chain=blocked, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), summary="Autonomous dev validation could not run.")
                if validation.outcome != "success":
                    blocked = self._autonomous_dev_loop.mark_blocked(chain, step_name="validation", reason=validation.summary, updated_at=self._now_iso())
                    self._autonomous_dev_chains[chat_id] = blocked
                    return AutonomousDevAdvanceDecision(matched=True, chain=blocked, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), summary="Autonomous dev chain stopped at validation.")
                updated = self._autonomous_dev_loop.mark_completed(
                    chain,
                    step_name="validation",
                    summary=validation.summary,
                    updated_at=self._now_iso(),
                    next_step="commit_prepare",
                )
                self._autonomous_dev_chains[chat_id] = updated
                continue
            if step_name == "commit_prepare":
                plan = self.build_feature_bundle_commit_plan(chat_id=chat_id, mode="preview")
                if plan is None:
                    blocked = self._autonomous_dev_loop.mark_blocked(chain, step_name="commit_prepare", reason="The bounded commit preview could not be rebuilt for the active feature bundle.", updated_at=self._now_iso())
                    self._autonomous_dev_chains[chat_id] = blocked
                    return AutonomousDevAdvanceDecision(matched=True, chain=blocked, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), summary="Autonomous dev chain stopped at commit preparation.")
                if not plan.can_execute:
                    blocked = self._autonomous_dev_loop.mark_blocked(
                        chain,
                        step_name="commit_prepare",
                        reason=plan.commit_readiness_reason or f"Commit readiness is {plan.commit_readiness_status}.",
                        updated_at=self._now_iso(),
                    )
                    self._autonomous_dev_chains[chat_id] = blocked
                    return AutonomousDevAdvanceDecision(matched=True, chain=blocked, reply="\n\n".join((self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), self.feature_bundle_commit_preview_reply(plan=plan))), summary="Autonomous dev chain stopped at commit preparation.")
                updated = self._autonomous_dev_loop.mark_completed(
                    chain,
                    step_name="commit_prepare",
                    summary=plan.milestone_summary or plan.commit_message,
                    updated_at=self._now_iso(),
                    next_step="commit_execute",
                )
                self._autonomous_dev_chains[chat_id] = updated
                continue
            if step_name == "pr_preview":
                plan = self.build_feature_bundle_pr_plan(chat_id=chat_id, mode="preview")
                updated = self._autonomous_dev_loop.mark_completed_terminal(
                    chain,
                    step_name="pr_preview",
                    summary=plan.summary or "PR preview prepared.",
                    updated_at=self._now_iso(),
                )
                updated = replace(updated, latest_pr_title=plan.title)
                self._autonomous_dev_chains[chat_id] = updated
                return AutonomousDevAdvanceDecision(
                    matched=True,
                    chain=updated,
                    reply="\n\n".join((self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), self.feature_bundle_pr_preview_reply(plan=plan))),
                    summary="Autonomous dev chain completed at PR preview.",
                    telemetry={"autonomous_dev_chain_id": updated.chain_id, "autonomous_dev_completed": True},
                )
            return AutonomousDevAdvanceDecision(matched=True, chain=chain, reply=self.autonomous_dev_chain_status_reply(chat_id=chat_id, include_plan=True), summary="Autonomous dev chain status returned.")

    def attach_autonomous_dev_confirmation(self, *, chat_id: str, step_name: str) -> PendingConfirmation | None:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        pending = self.latest_pending_confirmation_for_chat(chat_id=chat_id)
        if chain is None or pending is None:
            return pending
        self._confirmation_store.update_metadata(
            pending.confirmation_id,
            metadata={
                "autonomous_dev_chain_id": chain.chain_id,
                "autonomous_dev_step": step_name,
            },
        )
        return self._confirmation_store.get(pending.confirmation_id)

    def record_autonomous_dev_step_success(
        self,
        *,
        chat_id: str,
        step_name: str,
        summary: str,
        next_step: str,
        branch: str = "",
        commit_sha: str = "",
    ) -> AutonomousDevChainRecord | None:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        if chain is None or chain.current_step != step_name:
            return chain
        updated = self._autonomous_dev_loop.mark_completed(
            chain,
            step_name=step_name,  # type: ignore[arg-type]
            summary=summary,
            updated_at=self._now_iso(),
            next_step=next_step,  # type: ignore[arg-type]
        )
        updated = replace(updated, latest_branch=branch or updated.latest_branch, latest_commit_sha=commit_sha or updated.latest_commit_sha)
        self._autonomous_dev_chains[chat_id] = updated
        return updated

    def record_autonomous_dev_step_failure(self, *, chat_id: str, step_name: str, reason: str) -> AutonomousDevChainRecord | None:
        chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        if chain is None:
            return None
        updated = self._autonomous_dev_loop.mark_blocked(chain, step_name=step_name, reason=reason, updated_at=self._now_iso())  # type: ignore[arg-type]
        self._autonomous_dev_chains[chat_id] = updated
        return updated

    def plan_feature_bundle_for_chat(self, *, chat_id: str, prompt: str) -> FeaturePlanningDecision:
        decision = self._feature_bundle_planner.plan(
            bundle_id=self._generate_feature_bundle_id(),
            prompt=prompt,
            timestamp=self._now_iso(),
            read_text=self._read_repo_text_for_feature_planner,
            path_exists=self._repo_path_exists_for_feature_planner,
        )
        if decision.bundle is not None:
            self._feature_bundle_store.set_active(chat_id=chat_id, bundle=decision.bundle)
        return decision

    def feature_bundle_status_reply(self, *, chat_id: str) -> str:
        bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None:
            return self._feature_bundle_formatter.format_no_active_bundle()
        return self._feature_bundle_formatter.format_status(bundle)

    def build_feature_bundle_commit_plan(
        self,
        *,
        chat_id: str,
        mode: str = "preview",
    ) -> FeatureBundleCommitPlan | None:
        bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None:
            return None
        updated_bundle = self.attach_feature_bundle_completion_advisory(bundle=bundle)
        if updated_bundle != bundle:
            self.set_active_feature_bundle(chat_id=chat_id, bundle=updated_bundle)
        advisory = updated_bundle.completion_advisory
        if advisory is None:
            return None
        repo_root, repo_root_valid, _, _ = self._repo_configuration_state()
        scope_fingerprint = ""
        if repo_root_valid and advisory.included_paths:
            try:
                scope_fingerprint = self._feature_commit_executor.scope_fingerprint(repo_root, paths=advisory.included_paths)
            except FeatureBundleCommitError:
                scope_fingerprint = ""
        return FeatureBundleCommitPlan(
            bundle_id=updated_bundle.bundle_id,
            feature_title=updated_bundle.feature_title,
            mode="execute" if str(mode).strip().lower() == "execute" else "preview",
            repo_branch=advisory.repo_branch,
            repo_status=advisory.repo_status,
            milestone_summary=advisory.milestone_summary,
            commit_message=advisory.suggested_commit_message,
            commit_readiness_status=advisory.commit_readiness_status,
            commit_readiness_reason=advisory.commit_readiness_reason,
            included_paths=advisory.included_paths,
            excluded_paths=advisory.excluded_paths,
            ambiguous_paths=advisory.ambiguous_paths,
            readme_status=advisory.readme_status,
            readme_guidance=advisory.readme_guidance,
            playtest_required=advisory.playtest_required,
            playtest_reason=advisory.playtest_reason,
            scope_fingerprint=scope_fingerprint,
        )

    def feature_bundle_commit_preview_reply(self, *, plan: FeatureBundleCommitPlan) -> str:
        lines = [
            "[FEATURE COMMIT]",
            f"Bundle: {plan.bundle_id}",
            f"Feature: {plan.feature_title}",
            f"Mode: {plan.mode}",
            f"Repo: {plan.repo_status}",
            f"Commit readiness: {plan.commit_readiness_status}",
        ]
        if plan.commit_readiness_reason:
            lines.append(f"Commit readiness reason: {plan.commit_readiness_reason}")
        if plan.milestone_summary:
            lines.append(f"Milestone summary: {plan.milestone_summary}")
        if plan.commit_message:
            lines.append(f"Commit message: {plan.commit_message}")
        lines.append(f"README status: {plan.readme_status}")
        if plan.playtest_required:
            lines.append(f"Playtest required: yes - {plan.playtest_reason or 'Human or runtime verification is still required before commit.'}")
        else:
            lines.append("Playtest required: no")
        if plan.included_paths:
            lines.append(f"Included paths: {', '.join(plan.included_paths)}")
        if plan.excluded_paths:
            lines.append(f"Excluded paths: {', '.join(plan.excluded_paths)}")
        if plan.ambiguous_paths:
            lines.append(f"Ambiguous paths: {', '.join(plan.ambiguous_paths)}")
        if plan.readme_guidance:
            lines.append(f"README guidance: {plan.readme_guidance}")
        if plan.can_execute:
            lines.append("Next: Use /featurecommit execute to request one-shot approval for the bounded commit.")
        else:
            lines.append("Next: Resolve the blocked readiness condition before requesting /featurecommit execute.")
        return "\n".join(lines)

    def build_feature_bundle_push_plan(
        self,
        *,
        chat_id: str,
        mode: str = "preview",
    ) -> FeatureBundlePushPlan:
        receipt = self.latest_feature_bundle_commit_receipt_for_chat(chat_id=chat_id)
        normalized_mode = "execute" if str(mode).strip().lower() == "execute" else "preview"
        if receipt is None:
            return FeatureBundlePushPlan(
                status="blocked",
                mode=normalized_mode,
                branch="",
                remote_name="origin",
                command_text="",
                commit_sha="",
                reason="No new commit to push.",
            )
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        if not repo_root_valid:
            return FeatureBundlePushPlan(
                status="blocked",
                mode=normalized_mode,
                branch=receipt.branch,
                remote_name="origin",
                command_text=self._feature_push_executor.build_push_command(remote_name="origin", branch=receipt.branch),
                commit_sha=receipt.commit_sha,
                reason=repo_message,
            )
        snapshot = self.inspect_repo_status()
        remote_name = "origin"
        command_text = self._feature_push_executor.build_push_command(remote_name=remote_name, branch=receipt.branch)
        try:
            branch, head_commit, command_text = self._feature_push_executor.validate_push_readiness(
                repo_root,
                expected_branch=receipt.branch,
                expected_commit=receipt.commit_sha,
                expected_status_fingerprint=receipt.repo_status_fingerprint,
                remote_name=remote_name,
            )
        except FeatureBundlePushError as exc:
            return FeatureBundlePushPlan(
                status="blocked",
                mode=normalized_mode,
                branch=receipt.branch or snapshot.branch,
                remote_name=remote_name,
                command_text=command_text,
                commit_sha=receipt.commit_sha,
                reason=exc.message,
            )
        return FeatureBundlePushPlan(
            status="ready_to_push",
            mode=normalized_mode,
            branch=branch,
            remote_name=remote_name,
            command_text=command_text,
            commit_sha=head_commit,
            reason="",
        )

    def feature_bundle_push_preview_reply(self, *, plan: FeatureBundlePushPlan) -> str:
        lines = [
            "[FEATURE PUSH]",
            f"Status: {plan.status}",
            f"Mode: {plan.mode}",
        ]
        if plan.branch:
            lines.append(f"Branch: {plan.branch}")
        if plan.remote_name:
            lines.append(f"Remote: {plan.remote_name}")
        if plan.command_text:
            lines.append(f"Action: {plan.command_text}")
        if plan.commit_sha:
            lines.append(f"Commit: {plan.commit_sha}")
        if plan.reason:
            lines.append(f"Reason: {plan.reason}")
        if plan.can_execute:
            lines.append("Next: Use /featurepush execute to request one-shot approval for the bounded push.")
        else:
            lines.append("Next: Resolve the blocked push condition before requesting /featurepush execute.")
        return "\n".join(lines)

    def build_feature_bundle_pr_plan(
        self,
        *,
        chat_id: str,
        mode: str = "preview",
    ) -> FeatureBundlePrPlan:
        milestone = self.latest_feature_bundle_milestone_for_chat(chat_id=chat_id)
        normalized_mode = "execute" if str(mode).strip().lower() == "execute" else "preview"
        if milestone is None:
            return FeatureBundlePrPlan(
                status="blocked",
                mode=normalized_mode,
                bundle_id="",
                feature_title="",
                branch="",
                commit_sha="",
                title="",
                summary="",
                changed_paths=(),
                validation_summary="",
                validation_command="",
                merge_readiness="blocked_pending_checks",
                merge_readiness_reason="No pushed milestone is available for PR packaging yet.",
                readme_note="",
                playtest_required=False,
                playtest_reason="",
                next_steps=("Commit and push a bounded milestone before requesting /featurepr.",),
            )
        return self._pr_review_planner.build_plan(milestone=milestone, mode=normalized_mode)

    def feature_bundle_pr_preview_reply(self, *, plan: FeatureBundlePrPlan) -> str:
        return self._feature_bundle_formatter.format_pr_preview(plan)

    def _run_autonomous_dev_validation(self, *, chat_id: str) -> AutonomousDevValidationResult | None:
        bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None or bundle.validation_plan is None or not bundle.validation_plan.command_text.strip():
            return None
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        if not repo_root_valid:
            return AutonomousDevValidationResult(outcome="failed", summary=repo_message)
        try:
            request = self._execution_runner.build_run_request(
                capability_id="build.autonomous.dev.query",
                repo_root=repo_root,
                command_text=bundle.validation_plan.command_text,
                operator_reason="autonomous dev validation",
                expected_scope=self._repo_display_name(repo_root),
            )
            execution = self._execution_runner.execute(request)
        except ExecutionRunnerError as exc:
            return AutonomousDevValidationResult(outcome="failed", summary=exc.message)
        outcome = "timed_out" if execution.timed_out else ("success" if execution.exit_code == 0 else "failed")
        self.record_feature_bundle_validation_result(
            chat_id=chat_id,
            command_text=bundle.validation_plan.command_text,
            outcome=outcome,
            output_summary=execution.output_summary,
            first_issue=execution.first_issue,
        )
        return AutonomousDevValidationResult(outcome=outcome, summary=execution.output_summary, first_issue=execution.first_issue)

    def execute_feature_bundle_commit(
        self,
        *,
        chat_id: str,
        bundle_id: str,
        expected_branch: str,
        approved_paths: tuple[str, ...],
        approved_commit_message: str,
        approved_scope_fingerprint: str,
    ) -> FeatureBundleCommitExecutionResult:
        bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None or bundle.bundle_id != bundle_id.strip():
            raise FeatureBundleCommitError(
                "feature_commit_bundle_missing",
                "The active feature bundle no longer matches the approved commit request.",
            )
        plan = self.build_feature_bundle_commit_plan(chat_id=chat_id, mode="execute")
        if plan is None or plan.bundle_id != bundle.bundle_id:
            raise FeatureBundleCommitError(
                "feature_commit_plan_missing",
                "The bounded commit preview could not be rebuilt for the active feature bundle.",
            )
        if plan.commit_readiness_status != "safe_to_commit":
            raise FeatureBundleCommitError(
                "feature_commit_not_ready",
                f"Commit readiness is {plan.commit_readiness_status}: {plan.commit_readiness_reason or 'refresh the preview before committing.'}",
            )
        normalized_approved_paths = self._normalize_paths(approved_paths)
        if normalized_approved_paths != plan.included_paths:
            raise FeatureBundleCommitError(
                "feature_commit_scope_drifted",
                "The approved milestone paths changed since preview; refresh the preview before committing.",
            )
        if approved_commit_message.strip() != plan.commit_message:
            raise FeatureBundleCommitError(
                "feature_commit_message_drifted",
                "The suggested commit message changed since preview; refresh the preview before committing.",
            )
        if approved_scope_fingerprint.strip() and approved_scope_fingerprint.strip() != plan.scope_fingerprint:
            raise FeatureBundleCommitError(
                "feature_commit_scope_drifted",
                "Approved milestone changes drifted after preview; refresh the preview before committing.",
            )
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        if not repo_root_valid:
            raise FeatureBundleCommitError("feature_commit_repo_root_invalid", repo_message)
        result = self._feature_commit_executor.commit_paths(
            repo_root,
            paths=plan.included_paths,
            commit_message=plan.commit_message,
            expected_branch=expected_branch.strip() or plan.repo_branch,
        )
        milestone = FeatureBundleMilestoneRecord(
            bundle_id=bundle.bundle_id,
            feature_title=bundle.feature_title,
            milestone_summary=plan.milestone_summary,
            branch=result.branch,
            commit_sha=result.commit_sha,
            commit_message=result.commit_message,
            committed_paths=result.committed_paths,
            validation_summary=bundle.validation_summary,
            validation_command=bundle.validation_plan.command_text if bundle.validation_plan is not None else "",
            repo_status=plan.repo_status,
            readme_status=plan.readme_status,
            readme_guidance=plan.readme_guidance,
            playtest_required=plan.playtest_required,
            playtest_reason=plan.playtest_reason,
            completion_summary=bundle.completion_advisory.completion_summary if bundle.completion_advisory is not None else "",
        )
        self._feature_bundle_commit_receipts[chat_id] = FeatureBundleCommitReceipt(
            bundle_id=bundle.bundle_id,
            branch=result.branch,
            commit_sha=result.commit_sha,
            commit_message=result.commit_message,
            committed_paths=result.committed_paths,
            repo_status_fingerprint=self._feature_push_executor.repo_status_fingerprint(repo_root),
            committed_at=self._now_iso(),
        )
        self._feature_bundle_milestones[chat_id] = milestone
        self.clear_active_feature_bundle(chat_id=chat_id)
        return result

    def execute_feature_bundle_push(
        self,
        *,
        chat_id: str,
        expected_branch: str,
        expected_commit: str,
        expected_status_fingerprint: str,
        expected_remote_name: str,
    ) -> FeatureBundlePushExecutionResult:
        receipt = self.latest_feature_bundle_commit_receipt_for_chat(chat_id=chat_id)
        if receipt is None:
            raise FeatureBundlePushError("feature_push_receipt_missing", "No new commit to push.")
        if receipt.branch != expected_branch.strip() or receipt.commit_sha != expected_commit.strip():
            raise FeatureBundlePushError(
                "feature_push_receipt_mismatch",
                "The approved push target no longer matches the latest bounded commit receipt.",
            )
        if receipt.repo_status_fingerprint != expected_status_fingerprint.strip():
            raise FeatureBundlePushError(
                "feature_push_drifted",
                "Repository state changed after push approval; refresh the push preview before pushing.",
            )
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        if not repo_root_valid:
            raise FeatureBundlePushError("feature_push_repo_root_invalid", repo_message)
        result = self._feature_push_executor.push_branch(
            repo_root,
            expected_branch=receipt.branch,
            expected_commit=receipt.commit_sha,
            expected_status_fingerprint=receipt.repo_status_fingerprint,
            remote_name=expected_remote_name.strip() or "origin",
        )
        self._feature_bundle_commit_receipts.pop(chat_id, None)
        milestone = self._feature_bundle_milestones.get(chat_id)
        if milestone is not None:
            self._feature_bundle_milestones[chat_id] = replace(
                milestone,
                push_remote_name=result.remote_name,
                pushed_at=self._now_iso(),
            )
        return result

    def plan_conversational_dev_reply(self, *, chat_id: str, message: str) -> ConversationalDevReply:
        active_bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        latest_milestone = self.latest_feature_bundle_milestone_for_chat(chat_id=chat_id)
        pr_plan = self.build_feature_bundle_pr_plan(chat_id=chat_id, mode="preview") if latest_milestone is not None else None
        active_chain = self.active_autonomous_dev_chain_for_chat(chat_id=chat_id)
        return self._conversational_dev_planner.plan(
            message=message,
            active_bundle=active_bundle,
            latest_milestone=latest_milestone,
            pr_plan=pr_plan,
            active_chain=active_chain,
        )

    def attach_feature_bundle_completion_advisory(self, *, bundle: FeatureBundleRecord) -> FeatureBundleRecord:
        advisory = self._build_feature_bundle_completion_advisory(bundle)
        if advisory is None:
            return bundle
        return bundle.with_completion_advisory(advisory, updated_at=self._now_iso())

    def record_feature_bundle_validation_result(
        self,
        *,
        chat_id: str,
        command_text: str,
        outcome: str,
        output_summary: str,
        first_issue: str = "",
    ) -> None:
        bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
        if bundle is None or bundle.validation_plan is None:
            return
        if self._normalize_feature_validation_command(command_text) != self._normalize_feature_validation_command(bundle.validation_plan.command_text):
            return
        validation_state_map = {
            "success": "passed",
            "failed": "failed",
            "timed_out": "timed_out",
        }
        validation_state = validation_state_map.get(outcome)
        if validation_state is None:
            return
        summary = self._summarize_text(output_summary or first_issue or f"Validation {outcome}.", limit=180)
        if first_issue:
            summary = self._summarize_text(f"{summary} First issue: {first_issue}", limit=180)
        next_state = "validated" if validation_state == "passed" else "invalidated"
        updated = bundle.with_validation(
            validation_state=validation_state,
            updated_at=self._now_iso(),
            validation_summary=summary,
            state=next_state,
        )
        updated = self.attach_feature_bundle_completion_advisory(bundle=updated)
        self._feature_bundle_store.set_active(chat_id=chat_id, bundle=updated)
        self.capture_feature_bundle_data(
            chat_id=chat_id,
            bundle=updated,
            event_kind="validation",
            command_text=command_text,
            outcome=validation_state,
            output_summary=summary,
            first_issue=first_issue,
        )

    def _build_feature_bundle_completion_advisory(
        self,
        bundle: FeatureBundleRecord,
    ) -> FeatureBundleCompletionAdvisory | None:
        try:
            snapshot = self.inspect_repo_status()
        except RepoInspectorError:
            snapshot = None
        changed_paths = snapshot.changed_paths if snapshot is not None else ()
        included_paths = self._feature_bundle_included_paths(bundle=bundle, changed_paths=changed_paths)
        ambiguous_paths = self._feature_bundle_ambiguous_paths(bundle=bundle, included_paths=included_paths, changed_paths=changed_paths)
        excluded_paths = self._feature_bundle_excluded_paths(
            included_paths=included_paths,
            ambiguous_paths=ambiguous_paths,
            changed_paths=changed_paths,
        )
        readme_status = self._feature_bundle_readme_status(
            bundle=bundle,
            included_paths=included_paths,
            changed_paths=changed_paths,
        )
        playtest_required, playtest_reason = self._feature_bundle_playtest_signal(
            bundle=bundle,
            included_paths=included_paths,
        )
        commit_readiness_status, commit_readiness_reason = self._feature_bundle_commit_readiness(
            bundle=bundle,
            included_paths=included_paths,
            excluded_paths=excluded_paths,
            ambiguous_paths=ambiguous_paths,
            playtest_required=playtest_required,
        )
        repo_branch = snapshot.branch if snapshot is not None else "unknown"
        repo_status = snapshot.audit_summary if snapshot is not None else "Repository inspection unavailable"
        completion_summary = self._feature_bundle_completion_summary(
            commit_readiness_status=commit_readiness_status,
            playtest_required=playtest_required,
        )
        milestone_parts = [bundle.feature_title, f"state={bundle.state}", f"validation={bundle.validation_state}"]
        if bundle.validation_summary:
            milestone_parts.append(self._summarize_text(bundle.validation_summary, limit=100))
        milestone_log = " | ".join(part for part in milestone_parts if part)
        commit_message = self._feature_bundle_commit_message(bundle)
        readme_guidance = self._feature_bundle_readme_guidance(readme_status=readme_status)
        milestone_summary = self._feature_bundle_milestone_summary(bundle)
        return FeatureBundleCompletionAdvisory(
            repo_branch=repo_branch,
            repo_status=repo_status,
            completion_summary=completion_summary,
            milestone_log=milestone_log,
            suggested_stage_paths=included_paths,
            suggested_commit_message=commit_message,
            readme_guidance=readme_guidance,
            commit_readiness_status=commit_readiness_status,
            commit_readiness_reason=commit_readiness_reason,
            included_paths=included_paths,
            excluded_paths=excluded_paths,
            ambiguous_paths=ambiguous_paths,
            readme_status=readme_status,
            playtest_required=playtest_required,
            playtest_reason=playtest_reason,
            milestone_summary=milestone_summary,
        )

    def _feature_bundle_commit_message(self, bundle: FeatureBundleRecord) -> str:
        normalized_title = self._summarize_text(bundle.feature_title, limit=72)
        if bundle.validation_state == "passed":
            return f"Complete bounded feature bundle: {normalized_title}"
        if bundle.state == "applied":
            return f"Apply bounded feature bundle: {normalized_title}"
        return f"Update bounded feature bundle: {normalized_title}"

    @staticmethod
    def _normalize_paths(paths: tuple[str, ...]) -> tuple[str, ...]:
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_path in paths:
            cleaned = raw_path.replace('\\', '/').strip()
            if not cleaned or cleaned in seen:
                continue
            normalized.append(cleaned)
            seen.add(cleaned)
        return tuple(normalized)

    def _feature_bundle_included_paths(self, *, bundle: FeatureBundleRecord, changed_paths: tuple[str, ...]) -> tuple[str, ...]:
        candidate_paths = self._normalize_paths(bundle.applied_files or tuple(item.relative_path for item in bundle.editable_files()))
        changed_set = set(self._normalize_paths(changed_paths))
        if not changed_set:
            return candidate_paths
        included = tuple(path for path in candidate_paths if path in changed_set)
        return included or candidate_paths

    def _feature_bundle_ambiguous_paths(
        self,
        *,
        bundle: FeatureBundleRecord,
        included_paths: tuple[str, ...],
        changed_paths: tuple[str, ...],
    ) -> tuple[str, ...]:
        changed_set = set(self._normalize_paths(changed_paths))
        bundle_paths = set(self._normalize_paths(bundle.file_paths()))
        included_set = set(included_paths)
        ambiguous = tuple(path for path in self._normalize_paths(changed_paths) if path in bundle_paths and path not in included_set)
        return ambiguous

    def _feature_bundle_excluded_paths(
        self,
        *,
        included_paths: tuple[str, ...],
        ambiguous_paths: tuple[str, ...],
        changed_paths: tuple[str, ...],
    ) -> tuple[str, ...]:
        included_set = set(included_paths)
        ambiguous_set = set(ambiguous_paths)
        return tuple(
            path
            for path in self._normalize_paths(changed_paths)
            if path not in included_set and path not in ambiguous_set
        )

    def _feature_bundle_readme_status(
        self,
        *,
        bundle: FeatureBundleRecord,
        included_paths: tuple[str, ...],
        changed_paths: tuple[str, ...],
    ) -> str:
        bundle_paths = set(self._normalize_paths(bundle.file_paths()))
        changed_set = set(self._normalize_paths(changed_paths))
        if "README.md" in included_paths:
            return "relevant_and_includable"
        if "README.md" not in changed_set:
            return "clean"
        if "README.md" in bundle_paths:
            return "requires_isolated_follow_up"
        return "dirty_but_unrelated"

    def _feature_bundle_playtest_signal(
        self,
        *,
        bundle: FeatureBundleRecord,
        included_paths: tuple[str, ...],
    ) -> tuple[bool, str]:
        if bundle.validation_state == "not_run":
            return True, "Validation chain not yet run."
        if bundle.validation_state in {"failed", "timed_out"}:
            return True, "Validation is not yet passing for this milestone."
        normalized_risks = " ".join(bundle.risk_notes).lower()
        if any(token in normalized_risks for token in ("manual review", "human review")):
            return True, "Risk notes require manual or playtest review before commit."
        negated_playtest_markers = (
            "no runtime playtest is required",
            "no playtest required",
            "playtest is not required",
        )
        if "playtest" in normalized_risks and not any(marker in normalized_risks for marker in negated_playtest_markers):
            return True, "Risk notes require manual or playtest review before commit."
        sensitive_prefixes = (
            "app/cli/",
            "app/ui",
            "app/main.py",
            "app/window",
            "app/home_surface",
            "assets/",
            "packages/",
            "projectsettings/",
        )
        lower_paths = tuple(path.lower() for path in included_paths)
        if any(path.startswith(sensitive_prefixes) for path in lower_paths):
            return True, "User-facing or runtime behavior changed and still needs human review."
        return False, ""

    def _feature_bundle_commit_readiness(
        self,
        *,
        bundle: FeatureBundleRecord,
        included_paths: tuple[str, ...],
        excluded_paths: tuple[str, ...],
        ambiguous_paths: tuple[str, ...],
        playtest_required: bool,
    ) -> tuple[str, str]:
        if not included_paths:
            return "needs_human_review", "No milestone files were resolved for commit packaging."
        if bundle.validation_state == "not_run":
            return "blocked_pending_validation", "Validation must run before this milestone is commit-ready."
        if bundle.validation_state in {"failed", "timed_out"}:
            return "needs_human_review", "Validation is not passing, so the milestone should not be packaged yet."
        if ambiguous_paths:
            return "needs_human_review", f"Review ambiguous bundle paths: {', '.join(ambiguous_paths)}"
        interfering_paths = self._feature_bundle_interfering_unrelated_paths(
            included_paths=included_paths,
            excluded_paths=excluded_paths,
        )
        if interfering_paths:
            return "blocked_by_unrelated_changes", f"Unrelated changes overlap the milestone area: {', '.join(interfering_paths)}"
        if playtest_required:
            return "blocked_pending_playtest", "Runtime or human review is still required before commit."
        return "safe_to_commit", "Milestone files are scoped, validated, and ready for commit packaging."

    @staticmethod
    def _feature_bundle_scope_root(path: str) -> str:
        segments = [segment for segment in path.replace('\\', '/').split('/') if segment]
        if not segments:
            return ""
        if len(segments) >= 2 and segments[0] in {"app", "tests", "assets", "Packages", "ProjectSettings", "orchestrator_lane"}:
            return "/".join(segments[:2])
        return segments[0]

    def _feature_bundle_interfering_unrelated_paths(
        self,
        *,
        included_paths: tuple[str, ...],
        excluded_paths: tuple[str, ...],
    ) -> tuple[str, ...]:
        included_roots = {
            self._feature_bundle_scope_root(path)
            for path in included_paths
            if self._feature_bundle_scope_root(path)
        }
        if not included_roots:
            return ()
        return tuple(
            path
            for path in excluded_paths
            if path != "README.md" and self._feature_bundle_scope_root(path) in included_roots
        )

    @staticmethod
    def _feature_bundle_completion_summary(*, commit_readiness_status: str, playtest_required: bool) -> str:
        if commit_readiness_status == "safe_to_commit":
            return "Bundle validated and scoped packaging is ready for a milestone commit."
        if commit_readiness_status == "blocked_pending_validation":
            return "Bundle applied, but validation must run before commit packaging is ready."
        if commit_readiness_status == "blocked_pending_playtest":
            return "Validation passed, but playtesting or human review still blocks commit packaging."
        if commit_readiness_status == "blocked_by_unrelated_changes":
            return "Unrelated changes are interfering with this milestone's scoped commit package."
        if playtest_required:
            return "Commit preparation needs human review before this milestone should be recorded."
        return "Commit preparation needs human review before this milestone should be recorded."

    def _feature_bundle_milestone_summary(self, bundle: FeatureBundleRecord) -> str:
        summary = self._summarize_text(bundle.bundle_summary or bundle.intended_outcome or bundle.feature_request, limit=140)
        if bundle.validation_state == "passed":
            return summary
        if bundle.validation_state == "not_run":
            return self._summarize_text(f"{summary} Validation still pending.", limit=140)
        return self._summarize_text(f"{summary} Validation needs follow-up.", limit=140)

    @staticmethod
    def _feature_bundle_readme_guidance(*, readme_status: str) -> str:
        if readme_status == "relevant_and_includable":
            return "README.md is part of the bounded change set; include it only if the documentation update belongs to this feature."
        if readme_status == "dirty_but_unrelated":
            return "README.md already has unrelated changes; keep it out of this milestone commit unless this feature intentionally changed it."
        if readme_status == "requires_isolated_follow_up":
            return "README.md needs a separate follow-up commit so milestone documentation stays isolated from unrelated changes."
        return "README.md is not part of this bounded bundle; leave docs unstaged unless you intentionally updated them."

    def validate_main_run_target(self, *, target: str) -> tuple[str, bool, str]:
        normalized_target = " ".join(target.split())
        if not normalized_target:
            return "", False, "Use /main <relative_directory> or /run main <relative_directory>."
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        if not repo_root_valid:
            return normalized_target, False, repo_message
        command_text = f"main {normalized_target}"
        try:
            request = self._execution_runner.build_run_request(
                capability_id="shell.command.run",
                repo_root=repo_root,
                command_text=command_text,
            )
        except ExecutionRunnerError as exc:
            return normalized_target, False, exc.message
        resolved_target = "."
        if len(request.argv) > 2:
            resolved_target = str(request.argv[2]).strip().replace("\\", "/") or "."
        return resolved_target, True, f"Run target ready: {resolved_target}"

    def _build_contexts_reply(self, *, chat_id: str, limit: int = 5) -> _TelegramResponsePlan:
        contexts = self.recent_contexts_for_chat(chat_id=chat_id, limit=max(1, min(limit, 6)))
        if not contexts:
            return _TelegramResponsePlan(
                reply="Contexts\nNo recent context is available in this chat.",
                command_label="/contexts",
            )
        lines = ["Contexts (latest first)"]
        for item in contexts:
            lines.append(f"- {item.context_id} {item.source_capability_id} {item.source_summary}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/contexts",
        )

    def _build_clear_context_reply(self, *, cleared_count: int) -> _TelegramResponsePlan:
        if cleared_count <= 0:
            message = "Context buffer is already clear for this chat."
        elif cleared_count == 1:
            message = "Cleared 1 context entry for this chat."
        else:
            message = f"Cleared {cleared_count} context entries for this chat."
        return _TelegramResponsePlan(
            reply=message,
            command_label="/clearcontext",
        )

    def recent_workflows_for_chat(self, *, chat_id: str, limit: int = 5) -> tuple[WorkflowRecord, ...]:
        self._cleanup_expired_workflows()
        return self._workflow_store.recent(chat_id=chat_id, limit=limit)

    def resolve_workflow_for_chat(self, *, chat_id: str, reference: str) -> WorkflowRecord | None:
        self._cleanup_expired_workflows()
        return self._workflow_store.resolve(chat_id=chat_id, reference=reference)

    def current_or_latest_workflow_for_chat(self, *, chat_id: str) -> WorkflowRecord | None:
        self._cleanup_expired_workflows()
        return self._workflow_store.current(chat_id=chat_id) or self._workflow_store.latest(chat_id=chat_id)

    def _build_workflows_reply(self, *, chat_id: str, limit: int = 5) -> _TelegramResponsePlan:
        workflows = self.recent_workflows_for_chat(chat_id=chat_id, limit=max(1, min(limit, 6)))
        if not workflows:
            return _TelegramResponsePlan(
                reply="Workflows\nNo recent workflow is available in this chat.",
                command_label="/workflows",
            )
        lines = ["Workflows (latest first)"]
        for index, record in enumerate(workflows, start=1):
            lines.append(
                f"- {index}. {record.workflow_id} {record.workflow_type} | {self._workflow_state_label(record)} | {self._workflow_step_label(record)}"
            )
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/workflows",
        )

    def _build_workflow_status_reply(self, *, chat_id: str, reference: str = "") -> _TelegramResponsePlan:
        record = self.resolve_workflow_for_chat(chat_id=chat_id, reference=reference) if reference.strip() else self.current_or_latest_workflow_for_chat(chat_id=chat_id)
        if record is None:
            return _TelegramResponsePlan(
                reply="Workflow\nNo workflow is available in this chat.",
                command_label="/workflowstatus",
            )
        pending_confirmation_id = record.metadata.get("pending_confirmation_id", "").strip().upper()
        lines = [
            "Workflow",
            f"ID: {record.workflow_id}",
            f"Type: {record.workflow_type}",
            f"State: {self._workflow_state_label(record)}",
            f"Step: {self._workflow_step_label(record)}",
            f"Created: {self._short_time(record.created_at)}",
        ]
        if record.started_at:
            lines.append(f"Started: {self._short_time(record.started_at)}")
        if record.finished_at:
            lines.append(f"Finished: {self._short_time(record.finished_at)}")
        else:
            lines.append(f"Expires: {self._short_time(record.expires_at)}")
        if pending_confirmation_id:
            lines.append(f"Pending confirmation: {pending_confirmation_id}")
        lines.append(f"Summary: {self._summarize_text(self._workflow_summary_label(record), limit=220)}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/workflowstatus",
        )

    def _build_contextual_prompt(self, *, prompt: str, context: BufferedContext) -> tuple[str, bool]:
        content = context.normalized_content.strip()
        trimmed = False
        if len(content) > _CONTEXT_PROMPT_CHAR_LIMIT:
            content = f"{content[: _CONTEXT_PROMPT_CHAR_LIMIT - 3].rstrip()}..."
            trimmed = True
        combined = "\n".join(
            (
                "Use the explicit operator-provided context below if it helps answer the request.",
                f"Context Source: {context.source_summary}",
                "Context:",
                content,
                "User Request:",
                prompt.strip(),
            )
        )
        return combined, trimmed

    def _build_multi_contextual_prompt(self, *, prompt: str, contexts: tuple[BufferedContext, ...]) -> tuple[str, bool]:
        chunks: list[str] = ["Use the explicit operator-provided context below if it helps answer the request."]
        budget = _CONTEXT_PROMPT_CHAR_LIMIT
        trimmed = False
        for index, context in enumerate(contexts, start=1):
            content = context.normalized_content.strip()
            header = f"Context {index}: {context.source_summary}\n"
            remaining_budget = max(120, budget - len("\n".join(chunks)) - len(prompt.strip()) - 32)
            if len(content) > remaining_budget:
                content = f"{content[: max(0, remaining_budget - 3)].rstrip()}..."
                trimmed = True
            chunks.append(header + content)
        chunks.extend(("User Request:", prompt.strip()))
        combined = "\n".join(chunks)
        if len(combined) > budget:
            combined = f"{combined[: budget - 3].rstrip()}..."
            trimmed = True
        return combined, trimmed

    def _diagnostic_summary_lines(self) -> tuple[str, ...]:
        lines: list[str] = []
        if self._latest_health_report is not None:
            lines.append(f"[Health] {self._latest_health_report.summary}")
            for item in self._latest_health_report.items:
                if item.severity != "info":
                    lines.append(f"  - {item.code}: {item.message} | Action: {item.recommended_action}")
        if self._latest_security_report is not None:
            lines.append(f"[Security] {self._latest_security_report.summary}")
            for item in self._latest_security_report.items:
                if item.severity != "info":
                    lines.append(f"  - {item.code}: {item.message} | Action: {item.recommended_action}")
        if not lines:
            lines.append("Run Health Check or Security Check to populate diagnostics.")
        return tuple(lines[:10])


    def _telegram_loop_worker(self, stop_event: threading.Event) -> None:
        self._update_telegram_loop_status(
            state="running",
            activity_state="polling",
            message="Telegram polling loop is active.",
        )
        while not stop_event.is_set():
            try:
                if self._telegram_loop_status.state != "running" or self._telegram_loop_status.activity_state != "polling":
                    self._update_telegram_loop_status(
                        state="running",
                        activity_state="polling",
                        message="Telegram polling loop is active.",
                        activity=False,
                    )
                updates = self._telegram_service.get_updates(
                    secret_store=self._secret_store,
                    secret_id=self._config.telegram_secret_id,
                    offset=self._config.telegram_last_processed_update_id + 1,
                    timeout=2,
                )
                batch_provider_chats: set[str] = set()
                for update in updates:
                    if stop_event.is_set():
                        break
                    parsed_command = self._parse_telegram_command(update)
                    batch_busy = False
                    if parsed_command.command_label in _PROVIDER_ASK_COMMANDS:
                        if update.chat_id in batch_provider_chats:
                            batch_busy = True
                        else:
                            batch_provider_chats.add(update.chat_id)
                    self._handle_telegram_update(update, parsed_command=parsed_command, batch_busy=batch_busy)
            except TelegramApiError as exc:
                self._update_telegram_loop_status(
                    state="error",
                    activity_state="provider_failed",
                    message=f"Telegram polling failed: {sanitize_log_text(str(exc))}",
                )
                if stop_event.wait(1.5):
                    break
            except Exception as exc:  # noqa: BLE001
                self._update_telegram_loop_status(
                    state="error",
                    activity_state="provider_failed",
                    message=f"Telegram loop failed: {sanitize_log_text(str(exc))}",
                )
                if stop_event.wait(1.5):
                    break

        with self._telegram_loop_lock:
            if self._telegram_loop_stop_event is stop_event:
                self._telegram_loop_thread = None
                self._telegram_loop_stop_event = None
                self._update_telegram_loop_status(
                    state="stopped",
                    activity_state="idle",
                    message="Telegram loop stopped.",
                    activity=False,
                )

    def _handle_telegram_update(
        self,
        update: TelegramInboundMessage,
        *,
        parsed_command: _ParsedTelegramCommand | None = None,
        batch_busy: bool = False,
    ) -> None:
        if update.update_id <= self._config.telegram_last_processed_update_id:
            self._update_telegram_loop_status(
                state=self._telegram_loop_status.state if self._telegram_loop_status.state != "error" else "running",
                activity_state="processing_command",
                message=f"Skipped duplicate Telegram update {update.update_id}.",
                inbound_summary=f"Duplicate update {update.update_id} skipped.",
                activity=True,
            )
            return

        parsed = parsed_command or self._parse_telegram_command(update)
        command_hint = parsed.command_label
        inbound_summary = self._summarize_inbound_update(update, command_hint)
        self._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=f"Handling Telegram command {command_hint}.",
            inbound_summary=inbound_summary,
            activity=True,
            last_command=command_hint,
        )
        if command_hint in _PROVIDER_ASK_COMMANDS and not batch_busy:
            self._update_telegram_loop_status(
                state="running",
                activity_state="waiting_on_provider",
                message=f"Working on {command_hint} request.",
                inbound_summary=inbound_summary,
                outbound_summary=self._summarize_text(f"{command_hint} in progress."),
                activity=True,
                last_command=command_hint,
                last_ask_status=f"{command_hint} in progress.",
            )

        plan = self._build_telegram_reply(update, parsed_command=parsed, batch_busy=batch_busy)
        if self._last_execution_result is not None:
            self._log_command_processing(parsed=parsed, result=self._last_execution_result)
        outbound_summary = self._outbound_summary_for_plan(update, plan)
        loop_message = f"Processed Telegram update {update.update_id}."

        try:
            message_id = self._telegram_service.send_text(
                secret_store=self._secret_store,
                secret_id=self._config.telegram_secret_id,
                chat_id=update.chat_id,
                text=plan.reply,
            )
            if message_id:
                loop_message = f"Processed Telegram update {update.update_id} and sent reply {message_id}."
            else:
                loop_message = f"Processed Telegram update {update.update_id} and sent reply."
        except TelegramApiError as exc:
            outbound_summary = self._summarize_text(f"{plan.command_label} reply failed: {sanitize_log_text(str(exc))}")
            loop_message = sanitize_log_text(str(exc))
            self._update_telegram_loop_status(
                state="error",
                activity_state="provider_failed",
                message=f"Telegram reply failed: {loop_message}",
                inbound_summary=inbound_summary,
                outbound_summary=outbound_summary,
                activity=True,
                last_command=plan.command_label,
                last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status) else None,
            )
            self._persist_telegram_offset(update.update_id)
            return

        self._persist_telegram_offset(update.update_id)
        self._update_telegram_loop_status(
            state="running",
            activity_state="sent_reply",
            message=loop_message,
            inbound_summary=inbound_summary,
            outbound_summary=outbound_summary,
            activity=True,
            success=True,
            last_command=plan.command_label,
            last_ask_status=plan.ask_status if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status) else None,
        )


    def _build_telegram_reply(
        self,
        update: TelegramInboundMessage,
        *,
        parsed_command: _ParsedTelegramCommand | None = None,
        batch_busy: bool = False,
    ) -> _TelegramResponsePlan:
        parsed = parsed_command or self._parse_telegram_command(update)
        snapshot = self.snapshot()
        result = self._capability_executor.execute_telegram(
            update=update,
            parsed_command=parsed,
            snapshot=snapshot,
            batch_busy=batch_busy,
        )
        self._remember_execution_result(result)
        return self._plan_from_execution_result(result)

    def execute_local_chat_input(
        self,
        *,
        text: str,
        chat_id: str = "local-cli",
        sender_label: str = "local-cli",
    ) -> CapabilityExecutionResult:
        parsed = parse_chat_command(text=text, has_text=True)
        update = TelegramInboundMessage(
            update_id=0,
            chat_id=chat_id,
            text=text,
            sender_label=sender_label,
        )
        batch_busy = parsed.command_label in _PROVIDER_ASK_COMMANDS and self._is_provider_chat_busy(chat_id)
        result = self._capability_executor.execute_telegram(
            update=update,
            parsed_command=parsed,
            snapshot=self.snapshot(),
            batch_busy=batch_busy,
        )
        self._remember_execution_result(result)
        self._log_command_processing(parsed=parsed, result=result)
        return result

    def latest_pending_confirmation_for_chat(self, *, chat_id: str) -> PendingConfirmation | None:
        return self._confirmation_store.latest_pending(chat_id=chat_id)

    def _remember_execution_result(self, result: CapabilityExecutionResult) -> None:
        self._last_execution_result = result
        self._remember_loop_execution_result(result)
        self._remember_context_execution_result(result)
        self.capture_command_data(result)
        self._audit_store.append(self._build_audit_record(result))
        self._remember_repo_execution_result(result)
        self._remember_file_execution_result(result)
        self._remember_web_execution_result(result)
        self._last_message = result.internal_summary or self._last_message
        local_status = "disabled" if not self._node_registry.local_node().enabled else "online"
        self._node_registry.update_local_node(
            status=local_status,
            last_seen_at=self._now_iso(),
            last_job_status=result.outcome,
            last_result_summary=self._summarize_text(result.internal_summary or result.user_message, limit=120),
            current_job_id="",
        )

    def capture_command_data(self, result: CapabilityExecutionResult) -> None:
        self._capture_data_record(self._data_capture.command_record(record_id=self._data_record_store.generate_record_id(), result=result))
        bundle_record = DataCapture.feature_bundle_record_from_result(record_id=self._data_record_store.generate_record_id(), result=result)
        if bundle_record is not None:
            self._capture_data_record(bundle_record)

    def capture_evaluation_run_data(self, *, session: EvaluationSessionRecord, run) -> None:
        self._capture_data_record(
            self._data_capture.evaluation_run_record(
                record_id=self._data_record_store.generate_record_id(),
                session=session,
                run=run,
            )
        )

    def capture_task_chain_step_data(self, *, chain: TaskChainRecord, step) -> None:
        self._capture_data_record(
            self._data_capture.chain_step_record(
                record_id=self._data_record_store.generate_record_id(),
                chain=chain,
                step=step,
            )
        )

    def capture_feature_bundle_data(
        self,
        *,
        chat_id: str,
        bundle: FeatureBundleRecord,
        event_kind: str,
        command_text: str,
        outcome: str,
        output_summary: str,
        first_issue: str = "",
    ) -> None:
        self._capture_data_record(
            self._data_capture.feature_bundle_record(
                record_id=self._data_record_store.generate_record_id(),
                bundle=bundle,
                chat_id=chat_id,
                event_kind=event_kind,
                command_text=command_text,
                outcome=outcome,
                output_summary=output_summary,
                first_issue=first_issue,
            )
        )

    def _capture_data_record(self, record: DataRecord) -> None:
        try:
            self._data_record_store.append(record)
        except Exception as exc:  # noqa: BLE001
            self._emit_terminal_lines(
                [
                    f"[DATA] capture failed | {type(exc).__name__}: {self._summarize_text(str(exc), limit=140)}",
                ]
            )

    def _remember_loop_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id in _LOOP_ACTION_CAPABILITIES:
            self._last_loop_result = result

    def _remember_context_execution_result(self, result: CapabilityExecutionResult) -> None:
        created_context_id = str(result.telemetry.get("context_created_id") or "").strip()
        context_source = str(result.telemetry.get("context_source_summary") or "").strip()
        if created_context_id and context_source:
            self._last_context_source = self._summarize_text(f"{created_context_id} {context_source}", limit=120)
            self._last_context_action = self._summarize_text(
                f"Created {created_context_id} from {result.capability_id}.",
                limit=120,
            )
            return
        if result.capability_id == "context.clear":
            summary = str(result.telemetry.get("context_clear_summary") or result.internal_summary).strip()
            self._last_context_action = self._summarize_text(summary or "Context buffer cleared.", limit=120)
            if self._context_store.total_count() == 0:
                self._last_context_source = "No buffered context yet."
            return
        if result.capability_id == "context.read":
            self._last_context_action = self._summarize_text(result.internal_summary, limit=120)
            return
        used_context_id = str(result.telemetry.get("context_used_id") or "").strip()
        used_source = str(result.telemetry.get("context_source_summary") or "").strip()
        if used_context_id:
            label = used_source or "stored context"
            self._last_context_action = self._summarize_text(
                f"Used {used_context_id} from {label} via {result.command_label}.",
                limit=120,
            )

    def _remember_repo_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id != "repo.status.read":
            return
        repo_branch = str(result.telemetry.get("repo_branch") or "").strip()
        repo_status = str(result.telemetry.get("repo_status_label") or "").strip()
        repo_name = str(result.telemetry.get("repo_name") or self._repo_display_name()).strip() or self._repo_display_name()
        if repo_branch:
            self._last_repo_branch = repo_branch
        if repo_status:
            self._last_repo_state = self._summarize_text(f"{repo_name}: {repo_status}", limit=120)
        else:
            self._last_repo_state = self._summarize_text(result.internal_summary, limit=120)
        self._last_repo_checked_at = result.finished_at or self._now_iso()

    def _remember_file_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id not in {"file.read", "file.create.write", "file.patch.write", "file.write.replace"}:
            return
        file_name = str(result.telemetry.get("file_name") or "").strip()
        file_status = str(result.telemetry.get("file_status") or "").strip()
        file_display = str(result.telemetry.get("display_path") or file_name or "unknown file").strip()
        self._last_file_read = file_display
        if file_status:
            self._last_file_status = self._summarize_text(file_status, limit=120)
        else:
            self._last_file_status = self._summarize_text(result.internal_summary, limit=120)
        self._last_file_read_at = result.finished_at or self._now_iso()

    def _remember_web_execution_result(self, result: CapabilityExecutionResult) -> None:
        if result.capability_id != "web.fetch.read":
            return
        web_domain = str(result.telemetry.get("web_domain") or "unknown domain").strip()
        web_status = str(result.telemetry.get("web_status") or "").strip()
        content_type = str(result.telemetry.get("web_content_type") or "").strip()
        self._last_web_fetch = web_domain
        self._last_web_status = self._summarize_text(web_status or result.internal_summary, limit=120)
        self._last_web_content_type = content_type or "-"
        self._last_web_fetched_at = result.finished_at or self._now_iso()

    @staticmethod
    def _plan_from_execution_result(result: CapabilityExecutionResult) -> _TelegramResponsePlan:
        response_style = str(result.request.metadata.get("response_style", "detailed" if result.command_label == "/askd" else "concise"))
        return _TelegramResponsePlan(
            reply=result.user_message,
            command_label=result.command_label,
            ask_status=result.ask_status,
            hide_content_in_summary=result.hide_content_in_summary,
            response_style=response_style,
        )

    @staticmethod
    def _operator_console_label() -> str:
        return _OPERATOR_CONSOLE_LABEL

    def _build_help_reply(self) -> _TelegramResponsePlan:
        return _TelegramResponsePlan(
            reply=build_help_text(),
            command_label="/help",
        )

    def _build_last_action_reply(self, *, chat_id: str) -> _TelegramResponsePlan:
        result = self._last_loop_result
        workflow = self.current_or_latest_workflow_for_chat(chat_id=chat_id)
        last_run = self.latest_run_for_chat(chat_id=chat_id)
        if result is None:
            lines = [
                "Last action",
                "No loop action is recorded yet.",
                "Next: Use /repo, /file, /bootstrapproject, /createfile, /patchlast, /patchfile, /writefile, /run, or /test explicitly.",
            ]
            if workflow is not None:
                lines.insert(2, f"Workflow: {workflow.workflow_id} {self._workflow_state_label(workflow)}")
            return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/lastaction")

        lines = ["Last action"]
        lines.extend(self._last_action_lines(result=result, last_run=last_run))
        if workflow is not None:
            lines.append(f"Workflow: {workflow.workflow_id} {self._workflow_state_label(workflow)}")
        lines.append(f"Next: {self._last_action_next_step(result=result, workflow=workflow)}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/lastaction",
        )

    def _generate_feature_bundle_id(self) -> str:
        return f"FB-{secrets.token_hex(3).upper()}"

    def _generate_autonomous_dev_chain_id(self) -> str:
        return f"AD-{secrets.token_hex(3).upper()}"

    def _read_repo_text_for_feature_planner(self, relative_path: str) -> str | None:
        resolved = self._resolve_repo_relative_path_for_feature_planner(relative_path)
        if resolved is None or not resolved.exists() or not resolved.is_file():
            return None
        try:
            return resolved.read_text(encoding="utf-8")
        except OSError:
            return None

    def _repo_path_exists_for_feature_planner(self, relative_path: str) -> bool:
        resolved = self._resolve_repo_relative_path_for_feature_planner(relative_path)
        return bool(resolved is not None and resolved.exists())

    def _resolve_repo_relative_path_for_feature_planner(self, relative_path: str) -> Path | None:
        normalized = relative_path.strip().replace("\\", "/")
        if not normalized:
            return None
        repo_root, repo_root_valid, _, _ = self._repo_configuration_state()
        if not repo_root_valid:
            return None
        try:
            resolved_root = Path(repo_root).resolve()
            candidate = (resolved_root / normalized).resolve(strict=False)
            candidate.relative_to(resolved_root)
        except (OSError, ValueError):
            return None
        return candidate

    @staticmethod
    def _normalize_feature_validation_command(command_text: str) -> str:
        return " ".join(command_text.strip().split()).lower()

    def _last_action_lines(self, *, result: CapabilityExecutionResult, last_run: LastRunRecord | None) -> tuple[str, ...]:
        telemetry = result.telemetry
        capability_id = result.capability_id
        if capability_id == "repo.status.read":
            summary = str(telemetry.get("repo_summary") or result.internal_summary)
            return (
                f"Action: repo {self._outcome_label(result.outcome)}",
                f"Summary: {self._summarize_text(summary, limit=180)}",
            )
        if capability_id == "file.read":
            display_path = str(telemetry.get("display_path") or self._last_file_read or "unknown file")
            status = str(telemetry.get("file_status") or result.internal_summary)
            return (
                "Action: file preview ready",
                f"File: {display_path}",
                f"Summary: {self._summarize_text(status, limit=180)}",
            )
        if capability_id in {"file.create.write", "file.patch.write", "file.write.replace"}:
            display_path = str(telemetry.get("display_path") or self._last_file_read or "unknown file")
            operation = str(
                telemetry.get("mutation_operation")
                or (
                    "create"
                    if capability_id == "file.create.write"
                    else ("patch" if capability_id == "file.patch.write" else "replace")
                )
            )
            status = str(telemetry.get("file_status") or result.internal_summary)
            return (
                f"Action: {operation} {self._outcome_label(result.outcome)}",
                f"File: {display_path}",
                f"Summary: {self._summarize_text(status, limit=180)}",
            )
        if capability_id == "build.bootstrap.propose.read":
            bootstrap_id = str(telemetry.get("bootstrap_id") or "unknown bootstrap")
            bootstrap_type = str(telemetry.get("bootstrap_type") or "unknown")
            file_count = int(telemetry.get("bootstrap_file_count") or 0)
            summary = str(telemetry.get("bootstrap_summary") or result.internal_summary)
            return (
                "Action: bootstrap proposal ready",
                f"Bootstrap: {bootstrap_id} ({bootstrap_type})",
                f"Files: {file_count}",
                f"Summary: {self._summarize_text(summary, limit=180)}",
            )
        if capability_id == "build.bootstrap.approve.query":
            bootstrap_id = str(telemetry.get("bootstrap_id") or "unknown bootstrap")
            created_count = int(telemetry.get("bootstrap_created_count") or 0)
            planned_count = int(telemetry.get("bootstrap_file_count") or 0)
            summary = str(telemetry.get("bootstrap_summary") or result.internal_summary)
            return (
                f"Action: bootstrap {self._outcome_label(result.outcome)}",
                f"Bootstrap: {bootstrap_id}",
                f"Created: {created_count}/{planned_count}",
                f"Summary: {self._summarize_text(summary, limit=180)}",
            )
        if capability_id == "build.bootstrap.reset.query":
            summary = str(telemetry.get("bootstrap_summary") or result.internal_summary)
            return (
                "Action: bootstrap reset completed",
                f"Summary: {self._summarize_text(summary, limit=180)}",
            )
        if capability_id in {"shell.command.run", "test.command.run"}:
            command_summary = str(telemetry.get("execution_command_summary") or result.request.metadata.get("argument_summary") or result.command_label)
            output_summary = str(telemetry.get("execution_output_summary") or result.internal_summary)
            lines = [
                f"Action: {('test' if capability_id == 'test.command.run' else 'run')} {self._outcome_label(result.outcome)}",
                f"Command: {command_summary}",
            ]
            target_root = str(telemetry.get("execution_target_root") or "").strip()
            if not target_root and last_run is not None:
                target_root = (last_run.target_root or "").strip()
            if target_root:
                lines.append(f"Target: {target_root}")
            node_summary = str(telemetry.get("target_node_summary") or "").strip()
            if node_summary:
                lines.append(f"Node: {node_summary}")
            exit_code = telemetry.get("execution_exit_code")
            if isinstance(exit_code, int):
                lines.append(f"Exit code: {exit_code}" if exit_code >= 0 else "Exit: timeout")
            lines.append(f"Summary: {self._summarize_text(output_summary, limit=180)}")
            first_issue = str(telemetry.get("execution_first_issue") or "").strip()
            if first_issue:
                lines.append(f"First issue: {self._summarize_text(first_issue, limit=120)}")
            return tuple(lines)
        return (
            f"Action: {capability_id} {self._outcome_label(result.outcome)}",
            f"Summary: {self._summarize_text(result.internal_summary, limit=180)}",
        )

    def _last_action_next_step(self, *, result: CapabilityExecutionResult, workflow: WorkflowRecord | None) -> str:
        if result.outcome == "confirmation_required":
            confirmation_id = str(result.telemetry.get("confirmation_id") or "").strip().upper()
            if confirmation_id:
                return f"Reply with /confirm {confirmation_id} or /deny {confirmation_id}."
            return "Approve or deny the pending action explicitly."
        if workflow is not None and workflow.current_state in {"paused", "running", "pending"}:
            pending_confirmation_id = workflow.metadata.get("pending_confirmation_id", "").strip().upper()
            if pending_confirmation_id:
                return f"Use /workflowstatus or /confirm {pending_confirmation_id} explicitly."
            return "Use /workflowstatus or /cancelworkflow explicitly."
        if result.capability_id == "build.bootstrap.propose.read":
            return "Use /bootstrapview to review, /bootstrapapprove to create files, or /bootstrapreset to discard it."
        if result.capability_id == "build.bootstrap.approve.query" and result.outcome == "success":
            follow_up = str(result.telemetry.get("bootstrap_follow_up") or "").strip()
            if follow_up:
                return follow_up
            return "Inspect the scaffold with /file or continue with an explicit /run or /test."
        if result.capability_id == "build.bootstrap.reset.query":
            return "Use /bootstrapproject after /planbuild if you want a fresh starter scaffold."
        if result.capability_id == "file.read":
            return "Use /createfile, /patchlast, /patchfile, /writefile, /run, or /test explicitly."
        if result.capability_id in {"file.create.write", "file.patch.write", "file.write.replace"} and result.outcome == "success":
            return "Run /test or /run explicitly if you want to validate the edit."
        if result.capability_id in {"shell.command.run", "test.command.run"}:
            return "Inspect with /file, patch with /patchlast or /patchfile, or run another bounded command explicitly."
        return "Continue explicitly with the next operator command you want."

    @staticmethod
    def _outcome_label(outcome: str) -> str:
        return {
            "success": "completed",
            "failed": "failed",
            "timed_out": "timed out",
            "out_of_scope": "blocked",
            "unavailable": "unavailable",
            "invalid_request": "rejected",
            "confirmation_required": "pending confirmation",
        }.get(outcome, outcome.replace("_", " "))

    def _build_status_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        startup_snapshot = self.build_startup_diagnostics_snapshot()
        return _TelegramResponsePlan(
            reply=self._startup_diagnostics_formatter.format_telegram(startup_snapshot),
            command_label="/status",
        )

    def _build_mode_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        active_status = self._provider_status_for_mode(self._config.current_mode)
        online_state, online_message = self._online_use_state()
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Mode",
                    f"Selected: {snapshot.selected_mode}",
                    f"Current: {snapshot.mode}",
                    f"Policy: {self._policy_label(snapshot.policy)}",
                    f"Provider: {self._provider_label(snapshot.active_provider, active_status.model)}",
                    f"Remote use: {self._online_use_label(online_state)}",
                    f"Reason: {online_message}",
                )
            ),
            command_label="/mode",
        )

    def _build_models_reply(
        self,
        capability: CapabilityEvaluation | None,
        context: CapabilityContext | None,
    ) -> _TelegramResponsePlan:
        ollama_status = context.offline_provider_status if context is not None else self._provider_status_for_mode("offline")
        if capability is not None and capability.reason_code == "ollama_unavailable":
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "Unavailable right now.",
                        f"Reason: {capability.blocking_reason}",
                    )
                ),
                command_label="/models",
            )
        if capability is not None and capability.reason_code == "no_local_models":
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "No local Ollama models are available yet.",
                    )
                ),
                command_label="/models",
            )
        if not ollama_status.available:
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "Unavailable right now.",
                        f"Reason: {ollama_status.message}",
                    )
                ),
                command_label="/models",
            )
        if not ollama_status.available_models:
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Local models",
                        "No local Ollama models are available yet.",
                    )
                ),
                command_label="/models",
            )
        models = list(ollama_status.available_models[:5])
        remaining = len(ollama_status.available_models) - len(models)
        lines = ["Local models"]
        lines.extend(f"- {model}" for model in models)
        if remaining > 0:
            lines.append(f"... and {remaining} more")
        if ollama_status.model:
            lines.append(f"Active: {ollama_status.model}")
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/models",
        )


    def _build_ask_reply(
        self,
        prompt: str,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
        requester_label: str,
        response_style: str,
        command_label: str,
        batch_busy: bool,
    ) -> _TelegramResponsePlan:
        if batch_busy or self._is_provider_chat_busy(chat_id):
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before sending another ask.",
                activity_state="processing_command",
            )

        prompt = " ".join(prompt.split())
        if not prompt:
            usage = "/askd <prompt>" if command_label == "/askd" else "/ask <prompt>"
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="No prompt was provided.",
                next_step=f"Try {usage}.",
                activity_state="processing_command",
            )

        rate_limited, wait_seconds = self._provider_ask_is_rate_limited(chat_id)
        if rate_limited:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=f"Provider ask rate limit is active for this chat. Wait about {wait_seconds:.1f}s.",
                next_step="Wait a moment, then resend your ask command.",
                activity_state="processing_command",
            )

        capability, context = self._evaluate_command_capability(command_label, snapshot)
        if capability is None or context is None:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Capability evaluation is unavailable.",
                next_step="Run /status from Telegram or the desktop app, then try again.",
                activity_state="processing_command",
            )
        if capability.current_availability_state == "confirmation_required":
            return self._build_confirmation_required_reply(
                command_label=command_label,
                capability=capability,
                context=context,
                snapshot=snapshot,
                prompt=prompt,
                response_style=response_style,
                chat_id=chat_id,
                requester_label=requester_label,
            )
        if capability.current_availability_state != "allowed":
            return self._blocked_ask_reply_from_capability(command_label=command_label, capability=capability)

        execution_mode = self._config.current_mode
        if self._config.selected_mode == "online" and self._config.current_mode != "online":
            execution_mode = "online"
        if execution_mode == "offline":
            provider_status = context.offline_provider_status
            self._update_telegram_loop_status(
                state="running",
                activity_state="waiting_on_provider",
                message=f"Waiting on {command_label} via Ollama.",
                activity=True,
                last_command=command_label,
                last_ask_status=f"{command_label} in progress.",
            )
            self._mark_provider_ask_started(chat_id)
            result = self._run_provider_request(
                provider="ollama",
                chat_id=chat_id,
                func=lambda: self._provider_adapters["ollama"].ask(  # type: ignore[call-arg]
                    runtime_status=self._runtime_manager.get_status(),
                    base_url=self._config.ollama_base_url,
                    preferred_model=self._config.preferred_ollama_model,
                    prompt=prompt,
                    response_style=response_style,
                    timeout_seconds=self._provider_timeout_seconds("ollama"),
                ),
            )
            if result.state == "timeout":
                return self._timeout_ask_reply(command_label=command_label, provider_name="Ollama")
            if result.state != "ok" or not isinstance(result.reply, ProviderReply):
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason="Provider request failed before a reply was returned.",
                    next_step="Check Ollama and try again.",
                    activity_state="provider_failed",
                )
            reply = result.reply
            if not reply.ok:
                return self._blocked_ask_reply(
                    command_label=command_label,
                    reason=reply.message,
                    next_step="Check Ollama and rerun /models or provider validation.",
                    activity_state="provider_failed",
                )
            model = reply.model or provider_status.model or "Ollama"
            return _TelegramResponsePlan(
                reply=self._format_ask_success(
                    reply.text,
                    provider_label=self._provider_label("ollama", model),
                    mode_label="Offline",
                    response_style=response_style,
                ),
                command_label=command_label,
                ask_status=f"{command_label} completed via Ollama / {model}.",
                hide_content_in_summary=True,
                response_style=response_style,
            )

        provider_status = context.online_provider_status
        self._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on {command_label} via OpenAI.",
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} in progress.",
        )
        self._mark_provider_ask_started(chat_id)
        result = self._run_provider_request(
            provider="openai",
            chat_id=chat_id,
            func=lambda: self._provider_adapters["openai"].ask(  # type: ignore[call-arg]
                secret_store=self._secret_store,
                secret_id=self._config.openai_secret_id,
                transient_secret="",
                prompt=prompt,
                response_style=response_style,
            ),
        )
        if result.state == "timeout":
            return self._timeout_ask_reply(command_label=command_label, provider_name="OpenAI")
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._blocked_ask_reply(
                command_label=command_label,
                reason="Provider request failed before a reply was returned.",
                next_step="Check the online provider configuration and try again.",
                activity_state="provider_failed",
            )
        reply = result.reply
        if not reply.ok:
            return self._blocked_ask_reply(
                command_label=command_label,
                reason=reply.message,
                next_step="Check the online provider configuration and try again.",
                activity_state="provider_failed",
            )
        model = reply.model or provider_status.model or "OpenAI"
        return _TelegramResponsePlan(
            reply=self._format_ask_success(
                reply.text,
                provider_label=self._provider_label("openai", model),
                mode_label="Online",
                response_style=response_style,
            ),
            command_label=command_label,
            ask_status=f"{command_label} completed via OpenAI / {model}.",
            hide_content_in_summary=True,
            response_style=response_style,
        )

    def _build_parse_failure_reply(self, parsed: _ParsedTelegramCommand) -> _TelegramResponsePlan:
        usage_hint = parsed.usage_hint or "Use /help to see supported commands."
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Couldn't parse that command.",
                    f"Next: {usage_hint}",
                )
            ),
            command_label="parse_failure",
        )

    def _blocked_ask_reply(
        self,
        *,
        command_label: str,
        reason: str,
        next_step: str,
        activity_state: str,
    ) -> _TelegramResponsePlan:
        title = "Can't run /askd right now." if command_label == "/askd" else "Can't run /ask right now."
        self._update_telegram_loop_status(
            state="running",
            activity_state=activity_state,
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} blocked: {reason}",
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    title,
                    f"Reason: {reason}",
                    f"Next: {next_step}",
                )
            ),
            command_label=command_label,
            ask_status=f"{command_label} blocked: {reason}",
            hide_content_in_summary=True,
            response_style="detailed" if command_label == "/askd" else "concise",
        )

    def _timeout_ask_reply(self, *, command_label: str, provider_name: str) -> _TelegramResponsePlan:
        reason = f"{provider_name} did not finish before the timeout."
        self._update_telegram_loop_status(
            state="running",
            activity_state="timed_out",
            message=reason,
            activity=True,
            last_command=command_label,
            last_ask_status=f"{command_label} timed out via {provider_name}.",
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Provider request timed out.",
                    f"Reason: {reason}",
                    "Next: Wait a moment, then try again.",
                )
            ),
            command_label=command_label,
            ask_status=f"{command_label} timed out via {provider_name}.",
            hide_content_in_summary=True,
            response_style="detailed" if command_label == "/askd" else "concise",
        )

    def _format_ask_success(
        self,
        answer: str,
        *,
        provider_label: str,
        mode_label: str,
        response_style: str,
    ) -> str:
        heading = "Detailed answer" if response_style == "detailed" else "Answer"
        normalized = self._normalize_telegram_reply(answer, response_style=response_style)
        source = f"{mode_label} | {provider_label}"
        return chr(10).join((f"{heading} ({source})", normalized))

    def _update_telegram_loop_status(

        self,
        *,
        state: str,
        activity_state: str | None = None,
        message: str,
        inbound_summary: str | None = None,
        outbound_summary: str | None = None,
        activity: bool = True,
        success: bool = False,
        last_command: str | None = None,
        last_ask_status: str | None = None,
    ) -> None:
        with self._telegram_loop_lock:
            timestamp = self._now_iso() if activity else self._telegram_loop_status.last_activity_at
            self._telegram_loop_status = TelegramLoopStatus(
                state=state,  # type: ignore[arg-type]
                activity_state=(activity_state or self._telegram_loop_status.activity_state),  # type: ignore[arg-type]
                message=sanitize_log_text(message),
                last_activity_at=timestamp,
                last_success_at=timestamp if success and activity else self._telegram_loop_status.last_success_at,
                last_command=sanitize_log_text(last_command or self._telegram_loop_status.last_command),
                last_ask_status=sanitize_log_text(last_ask_status or self._telegram_loop_status.last_ask_status),
                last_inbound_summary=sanitize_log_text(inbound_summary or self._telegram_loop_status.last_inbound_summary),
                last_outbound_summary=sanitize_log_text(outbound_summary or self._telegram_loop_status.last_outbound_summary),
            )
    @staticmethod
    def _summarize_text(text: str, limit: int = 160) -> str:
        normalized = " ".join(text.split())
        sanitized = sanitize_log_text(normalized)
        if len(sanitized) <= limit:
            return sanitized
        return f"{sanitized[: limit - 3]}..."

    def _summarize_inbound_update(self, update: TelegramInboundMessage, command_label: str) -> str:
        if command_label in _PROVIDER_ASK_COMMANDS:
            return self._summarize_text(f"{update.sender_label}: {command_label} [prompt hidden]")
        if command_label in {"/file", "/createfile", "/patchlast", "/patchfile", "/writefile"}:
            return self._summarize_text(f"{update.sender_label}: {command_label} [path hidden]")
        if command_label in {"/run", "/test"}:
            return self._summarize_text(f"{update.sender_label}: {command_label} [command hidden]")
        if command_label == "/web":
            return self._summarize_text(f"{update.sender_label}: /web [url hidden]")
        if command_label in {"/contexts", "/clearcontext"}:
            return self._summarize_text(f"{update.sender_label}: {command_label}")
        if command_label == "plain_text":
            return self._summarize_text(f"{update.sender_label}: text message received")
        if command_label == "non_text":
            return self._summarize_text(f"{update.sender_label}: non-text message received")
        if command_label == "parse_failure":
            return self._summarize_text(f"{update.sender_label}: malformed command")
        text = update.text.strip() or command_label
        return self._summarize_text(f"{update.sender_label}: {text}")

    def _outbound_summary_for_plan(self, update: TelegramInboundMessage, plan: _TelegramResponsePlan) -> str:
        if plan.command_label in _PROVIDER_ASK_COMMANDS or (plan.command_label == "/confirm" and plan.ask_status):
            return self._summarize_text(plan.ask_status or f"Sent {plan.command_label} reply to {update.sender_label}.")
        if plan.command_label == "plain_text":
            return self._summarize_text(f"Sent natural chat reply to {update.sender_label}.")
        if plan.command_label == "non_text":
            return self._summarize_text(f"Sent non-text guidance reply to {update.sender_label}.")
        if plan.command_label == "parse_failure":
            return self._summarize_text(f"Sent command correction to {update.sender_label}.")
        if plan.command_label in {"/file", "/createfile", "/patchlast", "/patchfile", "/writefile", "/run", "/test"}:
            return self._summarize_text(f"Sent {plan.command_label} reply to {update.sender_label}.")
        if plan.command_label == "/web":
            return self._summarize_text(f"Sent /web reply to {update.sender_label}.")
        return self._summarize_text(f"Sent {plan.command_label} reply to {update.sender_label}.")

    @staticmethod
    def _parse_telegram_command(update: TelegramInboundMessage) -> _ParsedTelegramCommand:
        return parse_chat_command(text=update.text, has_text=update.has_text)

    def _build_local_node(self) -> NodeDescriptor:
        local_config = self._node_config if self._node_config_store.exists() else NodeLocalConfig()
        return NodeRegistry.build_configured_local_node(
            controller_config=self._config,
            node_config=local_config,
            now_iso=self._now_iso(),
        )

    def list_registered_nodes(self) -> tuple[NodeDescriptor, ...]:
        return self._node_registry.list_nodes()

    def get_registered_node(self, node_id: str) -> NodeDescriptor | None:
        return self._node_registry.get_node(node_id)

    def resolve_execution_node(self) -> NodeResolution:
        return self._node_registry.resolve_execution_node()

    def select_execution_node(self, node_id: str) -> NodeResolution | None:
        return self._node_registry.select_node(node_id)

    def clear_execution_node(self) -> NodeResolution:
        return self._node_registry.clear_selection()

    def next_dispatch_job_id(self) -> str:
        return self._node_dispatcher.new_job_id()

    def queue_dispatch_job(self, *, record: NodeDispatchRecord) -> NodeDispatchRecord:
        return self._node_dispatcher.create_job(record=record)

    def get_dispatch_job(self, job_id: str) -> NodeDispatchRecord | None:
        return self._node_dispatcher.get_job(job_id)

    def list_dispatch_jobs(self) -> tuple[NodeDispatchRecord, ...]:
        return self._node_dispatcher.list_jobs()

    def create_evaluation_session(self, record: EvaluationSessionRecord) -> EvaluationSessionRecord:
        return self._evaluation_store.create_session(record)

    def update_evaluation_session(self, record: EvaluationSessionRecord) -> EvaluationSessionRecord:
        return self._evaluation_store.update_session(record)

    def get_evaluation_session(self, session_id: str) -> EvaluationSessionRecord | None:
        return self._evaluation_store.get_session(session_id)

    def list_evaluation_sessions(self) -> tuple[EvaluationSessionRecord, ...]:
        return self._evaluation_store.list_sessions()

    def evaluation_runs_for_session(self, session_id: str, *, limit: int | None = None):
        return self._evaluation_store.runs_for_session(session_id, limit=limit)

    def next_evaluation_session_id(self) -> str:
        return self._evaluation_store.generate_session_id()

    def start_evaluation_session(self, session_id: str) -> EvaluationSessionRecord:
        return self._evaluation_runner.start_session(session_id)

    def stop_evaluation_session(self, session_id: str, *, reason: str) -> EvaluationSessionRecord:
        return self._evaluation_runner.stop_session(session_id, reason=reason)

    def await_evaluation_session(self, session_id: str, *, timeout_seconds: float) -> EvaluationSessionRecord | None:
        return self._evaluation_runner.await_session(session_id, timeout_seconds=timeout_seconds)

    def is_evaluation_running(self, session_id: str) -> bool:
        return self._evaluation_runner.is_running(session_id)

    def build_eval_dispatch_record(
        self,
        *,
        session: EvaluationSessionRecord,
        target: NodeDispatchTarget,
        local_request: LocalCommandExecutionRequest,
        chat_id: str,
    ) -> NodeDispatchRecord:
        return NodeDispatchRecord(
            job_id=self.next_dispatch_job_id(),
            status="queued",
            requested_capability_id=local_request.capability_id,
            requested_command_label="/test" if local_request.command_kind == "test" else "/run",
            requested_command_text=local_request.command_text,
            requested_command_summary=local_request.command_summary,
            target_selection_mode=target.selection_mode,
            target_selector=target.target_value,
            target_node_id=target.node.node_id,
            target_node_role=target.node.role,
            target_node_name=target.node.display_name,
            routing_reason=target.routing_reason,
            request_source="evaluation-runner",
            requester_label=session.owner_label,
            chat_id=chat_id,
            confirmation_required=False,
            confirmation_id="",
            queued_at=self._now_iso(),
            result_summary="",
            failure_reason="",
            current_job_state="queued",
            execution_payload={
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
            },
        )

    def create_task_chain(self, record: TaskChainRecord) -> TaskChainRecord:
        return self._task_chain_store.create_chain(record)

    def update_task_chain(self, record: TaskChainRecord) -> TaskChainRecord:
        return self._task_chain_store.update_chain(record)

    def get_task_chain(self, chain_id: str) -> TaskChainRecord | None:
        return self._task_chain_store.get_chain(chain_id)

    def list_task_chains(self) -> tuple[TaskChainRecord, ...]:
        return self._task_chain_store.list_chains()

    def task_chain_steps(self, chain_id: str, *, limit: int | None = None):
        return self._task_chain_store.steps_for_chain(chain_id, limit=limit)

    def next_task_chain_id(self) -> str:
        return self._task_chain_store.generate_chain_id()

    def start_task_chain(self, chain_id: str) -> TaskChainRecord:
        return self._task_chain_runner.start_chain(chain_id)

    def resume_task_chain(self, chain_id: str) -> TaskChainRecord:
        return self._task_chain_runner.resume_chain(chain_id)

    def pause_task_chain(self, chain_id: str, *, reason: str) -> TaskChainRecord:
        return self._task_chain_runner.pause_chain(chain_id, reason=reason)

    def stop_task_chain(self, chain_id: str, *, reason: str) -> TaskChainRecord:
        return self._task_chain_runner.stop_chain(chain_id, reason=reason)

    def await_task_chain(self, chain_id: str, *, timeout_seconds: float) -> TaskChainRecord | None:
        return self._task_chain_runner.await_chain(chain_id, timeout_seconds=timeout_seconds)

    def is_task_chain_running(self, chain_id: str) -> bool:
        return self._task_chain_runner.is_running(chain_id)

    def plan_task_execution_conversation(self, *, chat_id: str, message: str) -> TaskExecutionConversationOutcome:
        with self._task_execution_conversation_lock:
            previous_request = self._task_execution_conversation_requests.get(chat_id)
            active_feature_bundle = self.active_feature_bundle_for_chat(chat_id=chat_id)
            outcome = self._task_execution_conversation_planner.plan(
                message=message,
                previous_request=previous_request,
                active_feature_bundle=active_feature_bundle,
            )
            if not outcome.matched:
                return outcome
            if outcome.request is not None and outcome.request.requires_clarification:
                self._task_execution_conversation_requests[chat_id] = outcome.request
            else:
                self._task_execution_conversation_requests.pop(chat_id, None)
            return outcome

    def list_pending_confirmations(self, *, chat_id: str | None = None) -> tuple[PendingConfirmation, ...]:
        return self._confirmation_store.list_pending(chat_id=chat_id)

    def handle_production_conversation(self, *, chat_id: str, message: str) -> ProductionConversationOutcome:
        return self._production_orchestrator.handle_message(service=self, chat_id=chat_id, message=message)

    def ensure_production_project(
        self,
        *,
        chat_id: str,
        project_title: str = "",
        engine_family: str = "",
        milestone: str = "",
    ):
        return self._production_orchestrator.ensure_project(
            service=self,
            chat_id=chat_id,
            project_title=project_title,
            engine_family=engine_family,
            milestone=milestone,
        )

    def establish_production_project(self, *, chat_id: str, title: str, engine_family: str, milestone: str):
        return self._production_orchestrator.establish_project(
            service=self,
            chat_id=chat_id,
            title=title,
            engine_family=engine_family,
            milestone=milestone,
        )

    def production_status_reply(self, *, chat_id: str, mobile: bool = False, focus: str = "overview") -> str:
        return self._production_orchestrator.status_reply(service=self, chat_id=chat_id, mobile=mobile, focus=focus)

    def set_production_priority(self, *, chat_id: str, title: str, category: str, node_hint: str = ""):
        return self._production_orchestrator.set_priority(
            service=self,
            chat_id=chat_id,
            title=title,
            category=category,
            node_hint=node_hint,
        )

    def pause_production_target(self, *, chat_id: str, target: str) -> str:
        return self._production_orchestrator.pause_target(service=self, chat_id=chat_id, target=target)

    def resume_production_target(self, *, chat_id: str, target: str) -> str:
        return self._production_orchestrator.resume_target(service=self, chat_id=chat_id, target=target)

    def assign_production_work(self, *, chat_id: str, target: str, category: str, title: str) -> str:
        return self._production_orchestrator.assign_work(
            service=self,
            chat_id=chat_id,
            target=target,
            category=category,
            title=title,
        )

    def build_chain_dispatch_record(
        self,
        *,
        chain: TaskChainRecord,
        target: NodeDispatchTarget,
        local_request: LocalCommandExecutionRequest,
        chat_id: str,
    ) -> NodeDispatchRecord:
        return NodeDispatchRecord(
            job_id=self.next_dispatch_job_id(),
            status="queued",
            requested_capability_id=local_request.capability_id,
            requested_command_label="/test" if local_request.command_kind == "test" else "/run",
            requested_command_text=local_request.command_text,
            requested_command_summary=local_request.command_summary,
            target_selection_mode=target.selection_mode,
            target_selector=target.target_value,
            target_node_id=target.node.node_id,
            target_node_role=target.node.role,
            target_node_name=target.node.display_name,
            routing_reason=target.routing_reason,
            request_source="task-chain-runner",
            requester_label=chain.owner_label,
            chat_id=chat_id,
            confirmation_required=False,
            confirmation_id="",
            queued_at=self._now_iso(),
            result_summary="",
            failure_reason="",
            current_job_state="queued",
            execution_payload={
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
                "task_chain_id": chain.chain_id,
            },
        )

    def resolve_dispatch_target(self, *, selector: str, required_command_label: str, requested_command: str) -> tuple[NodeDispatchTarget | None, str, str]:
        normalized = selector.strip().lower()
        if not normalized:
            return None, "dispatch_target_missing", "No node id or role was provided."
        direct_node = self.get_registered_node(normalized)
        if direct_node is not None:
            validation_code, validation_message = self._validate_dispatch_node(node=direct_node, required_command_label=required_command_label)
            if validation_code != "ok":
                return None, validation_code, validation_message
            return (
                NodeDispatchTarget(
                    selection_mode="node_id",
                    target_value=normalized,
                    required_command_label=required_command_label,
                    requested_command=requested_command,
                    routing_reason=f"explicit node {direct_node.node_id}",
                    node=direct_node,
                ),
                "ok",
                "",
            )
        if normalized in {"controller", "executor", "validator", "sandbox"}:
            matches = self._node_registry.list_role_matches(role=normalized, required_command_label=required_command_label)
            if not matches:
                return None, "dispatch_role_unavailable", f"No enabled {normalized} node can accept {required_command_label}."
            chosen = matches[0]
            reason = f"role match {normalized}"
            if len(matches) > 1:
                reason = f"role match {normalized}; chose {chosen.node_id} deterministically"
            return (
                NodeDispatchTarget(
                    selection_mode="role",
                    target_value=normalized,
                    required_command_label=required_command_label,
                    requested_command=requested_command,
                    routing_reason=reason,
                    node=chosen,
                ),
                "ok",
                "",
            )
        return None, "dispatch_target_unknown", f"No registered node or supported role matches {selector.strip()}."

    def _validate_dispatch_node(self, *, node: NodeDescriptor, required_command_label: str) -> tuple[str, str]:
        if not node.enabled or node.status == "disabled":
            return "dispatch_node_disabled", f"Node {node.node_id} is disabled."
        if node.status in {"offline", "stale"}:
            return "dispatch_node_unavailable", f"Node {node.node_id} is {node.status}."
        if node.status == "busy" or node.current_job_id:
            return "dispatch_node_busy", f"Node {node.node_id} is already running {node.current_job_id or 'another job'}."
        if not node.supports_command(required_command_label):
            return "dispatch_capability_unsupported", f"Node {node.node_id} does not declare {required_command_label}."
        if not node.repo_root.strip():
            return "dispatch_repo_root_missing", f"Node {node.node_id} did not publish a repo root."
        return "ok", ""

    def _run_provider_request(self, *, provider: str, chat_id: str, func) -> _ProviderCallResult:
        request_id = f"{chat_id}:{time.monotonic()}"
        result_box: dict[str, object] = {}
        done_event = threading.Event()

        def _worker() -> None:
            try:
                result_box["reply"] = func()
            except Exception as exc:  # noqa: BLE001
                result_box["error"] = sanitize_log_text(str(exc))
            finally:
                done_event.set()
                self._finish_provider_chat(chat_id, request_id)

        worker = threading.Thread(target=_worker, name=f"Telegram{provider.title()}Ask", daemon=True)
        self._begin_provider_chat(chat_id, request_id, worker)
        worker.start()
        finished = done_event.wait(self._provider_timeout_seconds(provider))
        if not finished:
            return _ProviderCallResult(state="timeout")
        if "error" in result_box:
            return _ProviderCallResult(state="error", error_message=str(result_box["error"]))
        reply = result_box.get("reply")
        if not isinstance(reply, ProviderReply):
            return _ProviderCallResult(state="error", error_message="Provider call returned an invalid result.")
        return _ProviderCallResult(state="ok", reply=reply)

    def _provider_timeout_seconds(self, provider: str) -> float:
        return float(self._provider_timeouts.get(provider, _OLLAMA_ASK_TIMEOUT_SECONDS))

    def _begin_provider_chat(self, chat_id: str, request_id: str, worker: threading.Thread) -> None:
        with self._provider_chat_lock:
            self._active_provider_chats[chat_id] = (request_id, worker)

    def _finish_provider_chat(self, chat_id: str, request_id: str) -> None:
        with self._provider_chat_lock:
            current = self._active_provider_chats.get(chat_id)
            if current is None:
                return
            if current[0] == request_id:
                self._active_provider_chats.pop(chat_id, None)

    def _is_provider_chat_busy(self, chat_id: str) -> bool:
        with self._provider_chat_lock:
            current = self._active_provider_chats.get(chat_id)
            if current is None:
                return False
            _, worker = current
            if worker.is_alive():
                return True
            self._active_provider_chats.pop(chat_id, None)
            return False

    def _mark_provider_ask_started(self, chat_id: str) -> None:
        with self._provider_chat_lock:
            self._provider_cooldowns[chat_id] = time.monotonic()

    def _provider_ask_is_rate_limited(self, chat_id: str) -> tuple[bool, float]:
        with self._provider_chat_lock:
            last_started = self._provider_cooldowns.get(chat_id)
        if last_started is None:
            return False, 0.0
        elapsed = time.monotonic() - last_started
        remaining = self._provider_ask_cooldown_seconds - elapsed
        if remaining > 0:
            return True, round(remaining, 1)
        return False, 0.0

    def _evaluate_command_capability(
        self,
        command_label: str,
        snapshot: ControllerSnapshot,
        *,
        remember: bool = True,
        confirmation_granted: bool = False,
        source: str = "telegram",
    ) -> tuple[CapabilityEvaluation | None, CapabilityContext | None]:
        capability_id = COMMAND_CAPABILITY_MAP.get(command_label)
        if capability_id is None:
            return None, None
        return self._evaluate_capability_id(
            capability_id,
            snapshot,
            remember=remember,
            confirmation_granted=confirmation_granted,
            source=source,
        )

    def _evaluate_capability_id(
        self,
        capability_id: str,
        snapshot: ControllerSnapshot,
        *,
        remember: bool = True,
        confirmation_granted: bool = False,
        source: str = "telegram",
    ) -> tuple[CapabilityEvaluation, CapabilityContext]:
        context = self._build_capability_context(snapshot, capability_id=capability_id)
        evaluation = self._capability_evaluator.evaluate(
            capability_id,
            context,
            source=source,  # type: ignore[arg-type]
            confirmation_granted=confirmation_granted,
        )
        if remember:
            self._last_capability_evaluation = evaluation
        return evaluation, context

    def _build_capability_context(self, snapshot: ControllerSnapshot, *, capability_id: str) -> CapabilityContext:
        manifest = self._capability_manifest(capability_id)
        need_offline = manifest.provider_dependency in {"ollama", "active_provider"} and (
            manifest.offline_safety != "requires_online" or snapshot.mode == "offline" or self._config.selected_mode == "offline"
        )
        need_online = manifest.provider_dependency in {"openai", "active_provider"} and (
            manifest.offline_safety != "safe_offline" or snapshot.mode == "online" or self._config.selected_mode == "online"
        )
        need_offline = need_offline or snapshot.mode == "offline"
        need_online = need_online or snapshot.mode == "online" or self._config.selected_mode == "online"
        offline_status = self._provider_status_for_mode("offline") if need_offline else self._provider_status_cache.get("ollama") or self._default_provider_status("ollama")
        online_status = self._provider_status_for_mode("online") if need_online else self._provider_status_cache.get("openai") or self._default_provider_status("openai")
        local_readiness_state, _ = self._compute_readiness(
            runtime_active=snapshot.runtime_active,
            telegram_status=self._reconcile_telegram_status(self._telegram_status),
        )
        selected_provider_status = online_status if self._config.selected_provider == "openai" else offline_status
        network_readiness_state, network_readiness_message = self._compute_network_readiness(
            runtime_active=snapshot.runtime_active,
            selected_provider_status=selected_provider_status,
            telegram_status=self._reconcile_telegram_status(self._telegram_status),
        )
        repo_root, repo_root_valid, repo_message, _ = self._repo_configuration_state()
        file_allowed_roots, file_scope_valid, file_message, _ = self._file_scope_state()
        web_allowed_domains, web_scope_valid, web_message, _ = self._web_scope_state()
        return CapabilityContext(
            runtime_state=snapshot.runtime_state,
            readiness_state=local_readiness_state,
            network_readiness_state=network_readiness_state,
            network_readiness_message=network_readiness_message,
            mode=snapshot.mode,
            selected_mode=snapshot.selected_mode,
            policy=snapshot.policy,
            active_provider=snapshot.active_provider,
            selected_provider=snapshot.selected_provider,
            health_status=snapshot.health_status,
            safety_status=snapshot.safety_status,
            offline_provider_status=offline_status,
            online_provider_status=online_status,
            repo_root=repo_root,
            repo_root_valid=repo_root_valid,
            repo_message=repo_message,
            file_allowed_roots=file_allowed_roots,
            file_scope_valid=file_scope_valid,
            file_message=file_message,
            web_allowed_domains=web_allowed_domains,
            web_scope_valid=web_scope_valid,
            web_message=web_message,
            runtime_active=snapshot.runtime_active,
        )

    def _build_capabilities_reply(self, snapshot: ControllerSnapshot) -> _TelegramResponsePlan:
        lines = ["Capabilities"]
        for manifest in list_summary_capabilities():
            evaluation, _ = self._evaluate_capability_id(
                manifest.capability_id,
                snapshot,
                remember=False,
                source="telegram",
            )
            lines.append(self._format_capability_summary_line(evaluation))
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/capabilities",
        )

    def _build_audit_reply(self, *, limit: int = 5) -> _TelegramResponsePlan:
        records = self._audit_store.recent(limit=max(1, min(limit, 8)))
        if not records:
            return _TelegramResponsePlan(
                reply="Audit\nNo capability executions have been recorded yet.",
                command_label="/audit",
            )
        lines = ["Audit"]
        for record in records:
            lines.append(self._format_audit_record_summary(record))
        return _TelegramResponsePlan(
            reply=chr(10).join(lines),
            command_label="/audit",
        )

    def _build_data_list_reply(self, *, limit: int = 8) -> _TelegramResponsePlan:
        records = self.list_data_records(limit=limit)
        if not records:
            return _TelegramResponsePlan(
                reply="Data records\nNo durable data records have been captured yet.",
                command_label="/data",
            )
        lines = ["Data records"]
        for record in records:
            lines.append(self._format_data_record_summary(record))
        lines.append("Next: use /data <record_id> to inspect one record or /datasearch type=chain_step to filter.")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/data")

    def _build_data_record_reply(self, *, record_id: str) -> _TelegramResponsePlan:
        record = self.get_data_record(record_id)
        if record is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        "Data record",
                        f"No record matched {record_id.strip().upper() or '(empty)'}.",
                    )
                ),
                command_label="/data",
            )
        curation = self.get_record_label_state(record.record_id)
        lines = [
            f"Data record {record.record_id}",
            f"Type: {record.record_type}",
            f"Label: {record.label}",
            f"Training eligible: {'yes' if record.training_eligible else 'no'}",
            f"Outcome: {record.outcome}",
            f"Title: {record.title}",
            f"Captured: {record.captured_at}",
            f"Source: {record.source}",
        ]
        if curation is not None and curation.primary_label:
            lines.append(f"Curation label: {curation.primary_label}")
        if curation is not None and curation.tags:
            lines.append(f"Curation tags: {', '.join(curation.tags)}")
        grouping = [
            f"request={record.request_id}" if record.request_id else "",
            f"session={record.session_id}" if record.session_id else "",
            f"chain={record.chain_id}" if record.chain_id else "",
            f"step={record.step_id}" if record.step_id else "",
            f"run={record.run_id}" if record.run_id else "",
            f"bundle={record.bundle_id}" if record.bundle_id else "",
            f"chat={record.chat_id}" if record.chat_id else "",
        ]
        grouping_line = " | ".join(item for item in grouping if item)
        if grouping_line:
            lines.append(f"Grouping: {grouping_line}")
        if record.summary:
            lines.append(f"Summary: {record.summary}")
        if record.input_text:
            lines.append(f"Input: {self._summarize_text(record.input_text, limit=200)}")
        if record.output_text:
            lines.append(f"Output: {self._summarize_text(record.output_text, limit=200)}")
        lines.append(f"Normalized: {self._json_compact(record.normalized_input)}")
        lines.append(f"Context: {self._json_compact(record.context_payload)}")
        lines.append(f"Result: {self._json_compact(record.result_payload)}")
        lines.append(f"Provenance: {self._json_compact(record.provenance_payload)}")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/data")

    def _build_data_search_reply(self, *, filters: dict[str, str], limit: int = 8) -> _TelegramResponsePlan:
        records = self.search_data_records(filters=filters, limit=limit)
        if not records:
            filter_summary = " ".join(f"{key}={value}" for key, value in filters.items()) or "(none)"
            return _TelegramResponsePlan(
                reply=chr(10).join(("Data search", f"No records matched: {filter_summary}")),
                command_label="/datasearch",
            )
        lines = ["Data search", f"Filters: {' '.join(f'{key}={value}' for key, value in filters.items())}"]
        for record in records:
            lines.append(self._format_data_record_summary(record))
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasearch")

    def _build_datasets_reply(self) -> _TelegramResponsePlan:
        datasets = self.list_datasets()
        if not datasets:
            return _TelegramResponsePlan(
                reply="Datasets\nNo curated datasets exist yet.",
                command_label="/datasets",
            )
        lines = ["Datasets"]
        for dataset in datasets[:12]:
            lines.append(self._dataset_formatter.format_dataset_summary_line(dataset))
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasets")

    def _build_datasources_reply(self, *, records: tuple[SourcePolicyRecord, ...] | None = None) -> _TelegramResponsePlan:
        rows = records if records is not None else self.list_source_policies()
        if not rows:
            return _TelegramResponsePlan(
                reply="Datasources\nNo controlled datasources exist yet.",
                command_label="/datasources",
            )
        lines = ["Datasources"]
        for record in rows[:12]:
            lines.append(self._data_policy_formatter.format_summary_line(record))
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasources")

    def _build_datasource_reply(self, *, source_id: str) -> _TelegramResponsePlan:
        record = self.get_source_policy(source_id)
        if record is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Datasource", f"No datasource matched {source_id.strip().upper() or '(empty)'}.")),
                command_label="/datasource",
            )
        lines = [
            f"Datasource {record.source_id}",
            f"Name: {record.source_name}",
            f"Type: {record.source_type}",
            f"Locator: {record.source_locator}",
            f"Status: {record.status}",
            f"Usage: {record.usage_class}",
            f"Review: {record.review_status}",
            f"Review required: {'yes' if record.review_required else 'no'}",
            f"Operations: {self._data_policy_formatter.format_operations(record)}",
            f"Provenance: {self._data_policy_formatter.format_provenance(record)}",
            f"Created: {record.created_at}",
            f"Updated: {record.updated_at}",
        ]
        if record.owner:
            lines.append(f"Owner: {record.owner}")
        if record.source_scope:
            lines.append(f"Scope: {record.source_scope}")
        if record.collection_method_class:
            lines.append(f"Collection: {record.collection_method_class}")
        if record.tags:
            lines.append(f"Tags: {self._data_policy_formatter.format_tags(record)}")
        if record.training_eligibility_reason:
            lines.append(f"Training rationale: {record.training_eligibility_reason}")
        if record.blocked_reason:
            lines.append(f"Blocked reason: {record.blocked_reason}")
        if record.policy_notes:
            lines.append(f"Notes: {record.policy_notes}")
        if record.reviewer:
            lines.append(f"Reviewer: {record.reviewer}")
        if record.reviewed_at:
            lines.append(f"Reviewed at: {record.reviewed_at}")
        if record.linked_dataset_ids:
            lines.append(f"Linked datasets: {', '.join(record.linked_dataset_ids)}")
        if record.linked_experiment_ids:
            lines.append(f"Linked experiments: {', '.join(record.linked_experiment_ids)}")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasource")

    def _build_datasource_summary_reply(self) -> _TelegramResponsePlan:
        counts = self.summarize_source_policies()
        total = len(self.list_source_policies())
        lines = [
            "Datasource summary",
            f"Total: {total}",
            f"Usage classes: {self._data_policy_formatter.format_counts(counts['usage_classes'])}",
            f"Review states: {self._data_policy_formatter.format_counts(counts['review_statuses'])}",
            f"Statuses: {self._data_policy_formatter.format_counts(counts['statuses'])}",
            f"Types: {self._data_policy_formatter.format_counts(counts['source_types'])}",
        ]
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasourcesummary")

    def _build_dataset_reply(self, *, dataset_id: str) -> _TelegramResponsePlan:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Dataset", f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")),
                command_label="/dataset",
            )
        lines = [
            f"Dataset {dataset.dataset_id}",
            f"Title: {dataset.title}",
            f"Status: {dataset.status}",
            f"Records: {dataset.record_count}",
            f"Created: {dataset.created_at}",
            f"Updated: {dataset.updated_at}",
            f"Source scope: {dataset.source_scope}",
            f"Labels: {self._dataset_formatter.format_dataset_labels(dataset)}",
            f"Splits: {self._dataset_formatter.format_dataset_splits(dataset)}",
        ]
        if dataset.description:
            lines.append(f"Description: {dataset.description}")
        if dataset.tags:
            lines.append(f"Tags: {', '.join(dataset.tags)}")
        if dataset.selection_filters:
            lines.append(f"Filters: {self._describe_dataset_filters(dataset.selection_filters)}")
        if dataset.source_policy_ids:
            lines.append(f"Source policies: {', '.join(dataset.source_policy_ids)}")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/dataset")

    def _build_dataset_records_reply(self, *, dataset_id: str) -> _TelegramResponsePlan:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Dataset records", f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")),
                command_label="/datasetrecords",
            )
        rows = self.dataset_records_with_membership(dataset.dataset_id)
        if not rows:
            return _TelegramResponsePlan(
                reply=chr(10).join((f"Dataset records {dataset.dataset_id}", "No records are currently in this dataset.")),
                command_label="/datasetrecords",
            )
        lines = [f"Dataset records {dataset.dataset_id}"]
        for membership, record, curation in rows[:15]:
            lines.append(
                self._dataset_formatter.format_dataset_record_line(
                    record=record,
                    membership=membership,
                    curation=curation,
                )
            )
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasetrecords")

    def _build_dataset_summary_reply(self, *, dataset_id: str) -> _TelegramResponsePlan:
        dataset = self.get_dataset(dataset_id)
        if dataset is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Dataset summary", f"No dataset matched {dataset_id.strip().upper() or '(empty)'}.")),
                command_label="/datasetsummary",
            )
        composition = self.summarize_dataset_composition(dataset.dataset_id)
        lines = [
            f"Dataset summary {dataset.dataset_id}",
            f"Title: {dataset.title}",
            f"Records: {dataset.record_count}",
            f"Labels: {self._dataset_formatter.format_dataset_labels(dataset)}",
            f"Splits: {self._dataset_formatter.format_dataset_splits(dataset)}",
            f"Types: {', '.join(f'{key}={value}' for key, value in sorted(composition['types'].items())) or 'none'}",
            f"Sources: {', '.join(f'{key}={value}' for key, value in sorted(composition['sources'].items())) or 'none'}",
        ]
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/datasetsummary")

    def _build_model_experiments_reply(self) -> _TelegramResponsePlan:
        experiments = self.list_model_experiments()
        if not experiments:
            return _TelegramResponsePlan(
                reply="Model experiments\nNo model experiments exist yet.",
                command_label="/modelexperiments",
            )
        lines = ["Model experiments"]
        for experiment in experiments[:12]:
            lines.append(self._model_experiment_formatter.format_experiment_summary_line(experiment))
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/modelexperiments")

    def _build_model_experiment_reply(self, *, experiment_id: str) -> _TelegramResponsePlan:
        experiment = self.get_model_experiment(experiment_id)
        if experiment is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Model experiment", f"No experiment matched {experiment_id.strip().upper() or '(empty)'}.")),
                command_label="/modelexperiment",
            )
        lines = [
            f"Model experiment {experiment.experiment_id}",
            f"Title: {experiment.title}",
            f"Task: {experiment.task_type}",
            f"Dataset: {experiment.dataset_id}",
            f"Status: {experiment.status}",
            f"Integration: {experiment.integration_status}",
            f"Baseline: {experiment.baseline}",
            f"Base model: {experiment.base_model}",
            f"Method: {experiment.adaptation_method}",
            f"Mode: {experiment.mode}",
            f"Train split: {experiment.train_split}",
            f"Eval split: {experiment.eval_split}",
            f"Split policy: {experiment.split_policy}",
            f"Created: {experiment.created_at}",
            f"Updated: {experiment.updated_at}",
            f"Dataset rows: {experiment.dataset_record_count}",
            f"Training examples: {experiment.training_example_count}",
            f"Evaluation examples: {experiment.evaluation_example_count}",
        ]
        if experiment.label_filters:
            lines.append(f"Dataset filters: {self._describe_dataset_filters(experiment.label_filters)}")
        if experiment.source_policy_ids:
            lines.append(f"Source policies: {', '.join(experiment.source_policy_ids)}")
        if experiment.dataset_export_path:
            lines.append(f"Dataset export: {experiment.dataset_export_path}")
        if experiment.notes:
            lines.append(f"Notes: {experiment.notes}")
        if experiment.last_error:
            lines.append(f"Last error: {experiment.last_error}")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/modelexperiment")

    def _build_model_experiment_results_reply(self, *, experiment_id: str) -> _TelegramResponsePlan:
        experiment = self.get_model_experiment(experiment_id)
        if experiment is None:
            return _TelegramResponsePlan(
                reply=chr(10).join(("Model experiment results", f"No experiment matched {experiment_id.strip().upper() or '(empty)'}.")),
                command_label="/modelexperimentresults",
            )
        lines = [
            "[MODEL EXPERIMENT]",
            f"Experiment: {experiment.title}",
            f"Experiment ID: {experiment.experiment_id}",
            f"Task: {experiment.task_type}",
            f"Dataset: {experiment.dataset_id}",
            f"Status: {experiment.status}",
            f"Integration: {experiment.integration_status}",
        ]
        lines.extend(self._model_experiment_formatter.format_metrics(experiment))
        lines.extend(self._model_experiment_formatter.format_artifacts(experiment))
        if experiment.last_error:
            lines.append(f"Last error: {experiment.last_error}")
        return _TelegramResponsePlan(reply=chr(10).join(lines), command_label="/modelexperimentresults")

    @staticmethod
    def _json_compact(payload: dict[str, object]) -> str:
        return json.dumps(payload, ensure_ascii=True, sort_keys=True)

    def _format_data_record_summary(self, record: DataRecord) -> str:
        detail = record.command_label or record.capability_id or record.title
        return self._summarize_text(
            f"- {self._short_time(record.captured_at)} {record.record_id} | {record.record_type} | {record.label} | {record.outcome} | {detail}",
            limit=140,
        )

    def _format_capability_summary_line(self, evaluation: CapabilityEvaluation) -> str:
        state_label = self._capability_state_label(evaluation.current_availability_state)
        parts = [
            state_label,
            self._access_kind_label(evaluation.access_kind),
            self._locality_label(evaluation.locality),
            self._offline_safety_label(evaluation.offline_safety),
        ]
        if evaluation.current_availability_state == "confirmation_required":
            parts.append("confirmation-gated")
        detail = evaluation.blocking_reason or evaluation.message
        line = f"- {evaluation.capability_id}: {' | '.join(parts)}"
        if evaluation.current_availability_state != "allowed":
            line = f"{line} ({self._summarize_text(detail, limit=60)})"
        return line

    def _blocked_ask_reply_from_capability(
        self,
        *,
        command_label: str,
        capability: CapabilityEvaluation,
    ) -> _TelegramResponsePlan:
        reason = capability.blocking_reason or capability.message
        next_step_map = {
            "runtime_not_active": "Use /startruntime, then try again.",
            "runtime_not_running": "Start the runtime in the operator console and try again.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before asking again.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console.",
            "policy_always_offline": "Switch to Offline Mode or activate Online Mode explicitly in the operator console.",
            "online_confirmation_required": "Approve the pending remote request with /confirm <id> after /ask returns a confirmation prompt.",
        }
        next_step = next_step_map.get(capability.reason_code, "Check the operator console configuration and try again.")
        activity_state = "provider_failed" if capability.current_availability_state in {"unavailable", "degraded"} else "processing_command"
        return self._blocked_ask_reply(
            command_label=command_label,
            reason=reason,
            next_step=next_step,
            activity_state=activity_state,
        )

    def _build_confirmation_required_reply(
        self,
        *,
        command_label: str,
        capability: CapabilityEvaluation,
        context: CapabilityContext,
        snapshot: ControllerSnapshot,
        prompt: str,
        response_style: str,
        chat_id: str,
        requester_label: str,
    ) -> _TelegramResponsePlan:
        confirmation = self._confirmation_store.create(
            capability_id=capability.capability_id,
            original_command=command_label,
            argument_summary=f"{command_label} [prompt hidden]",
            prompt_text=prompt,
            response_style=response_style,
            chat_id=chat_id,
            requester_label=requester_label,
            evaluation_context=self._confirmation_context_snapshot(snapshot, context),
        )
        expires_in = self._confirmation_seconds_remaining(confirmation)
        awaiting_message = f"{command_label} awaiting confirmation {confirmation.confirmation_id}."
        self._last_confirmation_requested = f"{confirmation.confirmation_id} pending for {capability.capability_id} ({command_label})."
        self._last_confirmation_result = f"{confirmation.confirmation_id} pending approval."
        self._last_message = f"Confirmation {confirmation.confirmation_id} created for {capability.capability_id}."
        self._update_telegram_loop_status(
            state="running",
            activity_state="processing_command",
            message=self._last_message,
            activity=True,
            last_command=command_label,
            last_ask_status=awaiting_message,
        )
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    "Action requires confirmation.",
                    f"Action: {command_label} (prompt hidden)",
                    f"Capability: {capability.capability_id}",
                    f"Reason: {self._confirmation_reason_message(capability.reason_code)}",
                    f"ID: {confirmation.confirmation_id} (expires in about {expires_in}s)",
                    f"Reply with: /confirm {confirmation.confirmation_id} or /deny {confirmation.confirmation_id}",
                )
            ),
            command_label=command_label,
            ask_status=awaiting_message,
            hide_content_in_summary=True,
            response_style=response_style,
        )

    def _build_confirm_reply(
        self,
        argument: str,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        confirmation_id = self._normalize_confirmation_id(argument)
        if not confirmation_id:
            return self._confirmation_usage_reply(command_label="/confirm")
        outcome, confirmation = self._confirmation_store.approve(confirmation_id, chat_id=chat_id)
        if outcome == "approved" and confirmation is not None:
            return self._execute_confirmed_capability(confirmation, snapshot, chat_id=chat_id)
        return self._confirmation_state_reply(
            command_label="/confirm",
            confirmation_id=confirmation_id,
            outcome=outcome,
            confirmation=confirmation,
        )

    def _build_deny_reply(self, argument: str, *, chat_id: str) -> _TelegramResponsePlan:
        confirmation_id = self._normalize_confirmation_id(argument)
        if not confirmation_id:
            return self._confirmation_usage_reply(command_label="/deny")
        outcome, confirmation = self._confirmation_store.reject(confirmation_id, chat_id=chat_id)
        return self._confirmation_state_reply(
            command_label="/deny",
            confirmation_id=confirmation_id,
            outcome=outcome,
            confirmation=confirmation,
        )

    def _execute_confirmed_capability(
        self,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        if confirmation.capability_id != "ask.provider_query":
            message = f"Confirmation {confirmation.confirmation_id} cannot run because the capability is no longer supported."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        f"Confirmation {confirmation.confirmation_id} could not run.",
                        "Reason: The capability is no longer supported for confirmation execution.",
                        "Next: Send the original command again after checking the operator console.",
                    )
                ),
                command_label="/confirm",
            )
        return self._execute_confirmed_provider_query(confirmation, snapshot, chat_id=chat_id)

    def _execute_confirmed_provider_query(
        self,
        confirmation: PendingConfirmation,
        snapshot: ControllerSnapshot,
        *,
        chat_id: str,
    ) -> _TelegramResponsePlan:
        if self._is_provider_chat_busy(chat_id):
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Another provider-backed ask is still running for this chat.",
                next_step="Wait for the current reply before confirming another action.",
                command_label="/confirm",
            )

        if confirmation.evaluation_context.selected_mode == "online" and snapshot.selected_mode != "online":
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Selected mode changed after this confirmation was created.",
                next_step="Re-select Online Mode, resend the original command, and confirm the new request.",
                command_label="/confirm",
            )

        capability, context = self._evaluate_capability_id(
            confirmation.capability_id,
            snapshot,
            remember=True,
            confirmation_granted=True,
        )
        if capability.current_availability_state != "allowed":
            return self._blocked_confirmation_reply_from_capability(
                confirmation_id=confirmation.confirmation_id,
                capability=capability,
            )

        use_online_provider = confirmation.evaluation_context.selected_mode == "online" or snapshot.mode == "online"
        provider_name = "OpenAI" if use_online_provider else "Ollama"
        provider_key = "openai" if use_online_provider else "ollama"
        provider_status = context.online_provider_status if use_online_provider else context.offline_provider_status
        mode_label = "Online" if use_online_provider else "Offline"

        self._update_telegram_loop_status(
            state="running",
            activity_state="waiting_on_provider",
            message=f"Waiting on confirmation {confirmation.confirmation_id} via {provider_name}.",
            activity=True,
            last_command="/confirm",
            last_ask_status=f"Confirmation {confirmation.confirmation_id} in progress.",
        )
        self._mark_provider_ask_started(chat_id)

        if use_online_provider:
            result = self._run_provider_request(
                provider=provider_key,
                chat_id=chat_id,
                func=lambda: self._provider_adapters["openai"].ask(  # type: ignore[call-arg]
                    secret_store=self._secret_store,
                    secret_id=self._config.openai_secret_id,
                    transient_secret="",
                    prompt=confirmation.prompt_text,
                    response_style=confirmation.response_style,
                ),
            )
        else:
            result = self._run_provider_request(
                provider=provider_key,
                chat_id=chat_id,
                func=lambda: self._provider_adapters["ollama"].ask(  # type: ignore[call-arg]
                    runtime_status=self._runtime_manager.get_status(),
                    base_url=self._config.ollama_base_url,
                    preferred_model=self._config.preferred_ollama_model,
                    prompt=confirmation.prompt_text,
                    response_style=confirmation.response_style,
                    timeout_seconds=self._provider_timeout_seconds("ollama"),
                ),
            )

        if result.state == "timeout":
            reason = f"{provider_name} did not finish before the timeout."
            self._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} timed out via {provider_name}."
            self._last_message = self._last_confirmation_result
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        f"Confirmation {confirmation.confirmation_id} timed out.",
                        f"Reason: {reason}",
                        "Next: Send the original command again if you still want to run it.",
                    )
                ),
                command_label="/confirm",
                ask_status=self._last_confirmation_result,
                hide_content_in_summary=True,
                response_style=confirmation.response_style,
            )
        if result.state != "ok" or not isinstance(result.reply, ProviderReply):
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason="Provider request failed before a reply was returned.",
                next_step="Check the provider configuration and try the original command again.",
                command_label="/confirm",
            )

        reply = result.reply
        if not reply.ok:
            next_step = "Check the online provider configuration and try the original command again."
            if not use_online_provider:
                next_step = "Check Ollama and try the original command again."
            return self._confirmation_result_reply(
                confirmation_id=confirmation.confirmation_id,
                state_label="could not run",
                reason=reply.message,
                next_step=next_step,
                command_label="/confirm",
            )

        model = reply.model or provider_status.model or provider_name
        self._last_confirmation_result = f"Confirmation {confirmation.confirmation_id} approved and completed via {provider_name}."
        self._last_message = self._last_confirmation_result
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    f"Confirmation {confirmation.confirmation_id} approved.",
                    self._format_ask_success(
                        reply.text,
                        provider_label=self._provider_label(provider_key, model),  # type: ignore[arg-type]
                        mode_label=mode_label,
                        response_style=confirmation.response_style,
                    ),
                )
            ),
            command_label="/confirm",
            ask_status=f"Confirmation {confirmation.confirmation_id} completed via {provider_name} / {model}.",
            hide_content_in_summary=True,
            response_style=confirmation.response_style,
        )

    def _blocked_confirmation_reply_from_capability(
        self,
        *,
        confirmation_id: str,
        capability: CapabilityEvaluation,
    ) -> _TelegramResponsePlan:
        next_step_map = {
            "runtime_not_active": "Use /startruntime, then resend the original command.",
            "runtime_not_running": "Start the runtime in the operator console and resend the original command.",
            "readiness_not_ready": "Resolve the blocking health or security issue in the operator console, then resend the original command.",
            "offline_provider_unavailable": "Validate Ollama in the operator console before retrying the original command.",
            "online_provider_unavailable": "Save or validate the OpenAI configuration in the operator console before retrying the original command.",
            "policy_always_offline": "Switch to Offline Mode or resend the original command after changing policy in the operator console.",
            "online_confirmation_required": "Resend the original command to request a fresh confirmation.",
        }
        return self._confirmation_result_reply(
            confirmation_id=confirmation_id,
            state_label="could not run",
            reason=capability.blocking_reason or capability.message,
            next_step=next_step_map.get(capability.reason_code, "Check the operator console configuration and resend the original command."),
            command_label="/confirm",
        )

    def _confirmation_usage_reply(self, *, command_label: str) -> _TelegramResponsePlan:
        usage = "/confirm <id>" if command_label == "/confirm" else "/deny <id>"
        action = "approve" if command_label == "/confirm" else "reject"
        return _TelegramResponsePlan(
            reply=f"Use {usage} to {action} a pending action.",
            command_label=command_label,
        )

    def _confirmation_state_reply(
        self,
        *,
        command_label: str,
        confirmation_id: str,
        outcome: str,
        confirmation: PendingConfirmation | None,
    ) -> _TelegramResponsePlan:
        if outcome in {"not_found", "wrong_chat"}:
            message = f"No pending confirmation matches {confirmation_id} for this chat."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=chr(10).join(
                    (
                        message,
                        "Next: Send the original command again if you still want to run it.",
                    )
                ),
                command_label=command_label,
            )
        if outcome == "expired" or (confirmation is not None and confirmation.current_state == "expired"):
            return self._confirmation_result_reply(
                confirmation_id=confirmation_id,
                state_label="expired",
                reason="This confirmation is no longer valid.",
                next_step="Send the original command again to request a new confirmation.",
                command_label=command_label,
            )
        if outcome == "rejected":
            message = f"Confirmation {confirmation_id} denied. Request not executed."
            self._last_confirmation_result = message
            self._last_message = message
            return _TelegramResponsePlan(
                reply=message,
                command_label=command_label,
            )
        if outcome == "already_used" and confirmation is not None:
            if confirmation.current_state == "approved":
                return self._confirmation_result_reply(
                    confirmation_id=confirmation_id,
                    state_label="was already used",
                    reason="This confirmation has already been consumed.",
                    next_step="Send the original command again if you need a new request.",
                    command_label=command_label,
                )
            if confirmation.current_state == "rejected":
                return self._confirmation_result_reply(
                    confirmation_id=confirmation_id,
                    state_label="was already denied",
                    reason="This confirmation has already been rejected.",
                    next_step="Send the original command again if you want a fresh confirmation prompt.",
                    command_label=command_label,
                )
        return self._confirmation_result_reply(
            confirmation_id=confirmation_id,
            state_label="could not be processed",
            reason="The confirmation state is no longer valid.",
            next_step="Send the original command again if you still want to run it.",
            command_label=command_label,
        )

    def _confirmation_result_reply(
        self,
        *,
        confirmation_id: str,
        state_label: str,
        reason: str,
        next_step: str,
        command_label: str,
    ) -> _TelegramResponsePlan:
        summary = f"Confirmation {confirmation_id} {state_label}."
        self._last_confirmation_result = summary
        self._last_message = summary
        return _TelegramResponsePlan(
            reply=chr(10).join(
                (
                    summary,
                    f"Reason: {reason}",
                    f"Next: {next_step}",
                )
            ),
            command_label=command_label,
        )

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
    def _normalize_confirmation_id(argument: str) -> str:
        token = argument.strip().split()[0] if argument.strip() else ""
        return token.upper()

    @staticmethod
    def _confirmation_reason_message(reason_code: str) -> str:
        return {
            "online_confirmation_required": "Online access requires one-shot approval under Ask Before Online.",
            "operator_confirmation_required": "This action requires explicit one-shot operator approval.",
        }.get(reason_code, "Explicit operator confirmation is required before this action can run.")

    @staticmethod
    def _confirmation_seconds_remaining(confirmation: PendingConfirmation) -> int:
        try:
            expires_at = datetime.fromisoformat(confirmation.expires_at)
        except ValueError:
            return 0
        remaining = int((expires_at - datetime.now().astimezone()).total_seconds())
        return max(0, remaining)

    def _cleanup_expired_confirmations(self) -> None:
        expired = self._confirmation_store.cleanup_expired()
        if expired <= 0:
            return
        noun = "confirmation has" if expired == 1 else "confirmations have"
        message = f"{expired} pending {noun} expired."
        self._last_confirmation_result = message
        self._last_message = message


    @staticmethod
    def _normalize_telegram_reply(text: str, *, response_style: str) -> str:
        lines = [" ".join(raw_line.split()) for raw_line in text.splitlines()]
        cleaned = [line for line in lines if line]
        if not cleaned:
            normalized_fallback = " ".join(text.split())
            return normalized_fallback or "No answer text was returned."
        if response_style == "detailed":
            normalized = chr(10).join(cleaned[:8])
            return ControllerService._trim_telegram_text(normalized, limit=_ASK_DETAILED_LIMIT)
        normalized = " ".join(cleaned)
        return ControllerService._trim_telegram_text(normalized, limit=_ASK_CONCISE_LIMIT)

    @staticmethod
    def _trim_telegram_text(text: str, *, limit: int) -> str:
        if len(text) <= limit:
            return text
        truncated = text[: limit - 3].rstrip()
        if " " in truncated:
            truncated = truncated.rsplit(" ", 1)[0]
        return f"{truncated}..."

    @staticmethod
    def _now_iso() -> str:
        return datetime.now().astimezone().isoformat(timespec="seconds")

    def _telegram_recent_success(self, *, window_seconds: float = 300.0) -> bool:
        last_success_at = self._telegram_loop_status.last_success_at.strip()
        if not last_success_at:
            return False
        try:
            last_success = datetime.fromisoformat(last_success_at)
        except ValueError:
            return False
        return (datetime.now().astimezone() - last_success).total_seconds() <= window_seconds

    @staticmethod
    def _health_label(status: str) -> str:
        return {"ok": "Healthy", "degraded": "Degraded", "blocked": "Blocked", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _safety_label(status: str) -> str:
        return {"ok": "Safe", "degraded": "Warning", "blocked": "Unsafe", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _readiness_label(state: str) -> str:
        return {"ready": "Ready", "degraded": "Degraded", "not_ready": "Not Ready"}.get(state, state)

    @staticmethod
    def _provider_label(provider: ProviderType, model: str) -> str:
        base = "Ollama" if provider == "ollama" else "OpenAI"
        if model:
            return f"{base} / {model}"
        return base

    @staticmethod
    def _policy_label(policy: str) -> str:
        return {
            "always_offline": "Always Offline",
            "ask_before_online": "Ask Before Online",
            "always_online": "Always Online",
        }.get(policy, policy)

    @staticmethod
    def _online_use_label(state: str) -> str:
        return {
            "blocked": "Blocked",
            "confirmation-gated": "Confirmation-gated",
            "allowed": "Allowed",
        }.get(state, state)

    def _online_use_state(self) -> tuple[str, str]:
        if self._config.policy == "always_offline":
            return "blocked", "Always Offline policy is active."

        online_status = self._validate_provider(
            provider="openai",
            preferred_ollama_model="",
            transient_openai_key="",
        )
        self._provider_status_cache["openai"] = online_status
        self._persist_provider_status("openai", online_status)

        if self._config.current_mode != "online":
            if self._config.selected_mode == "online" and self._config.policy == "ask_before_online":
                return "confirmation-gated", "Online Mode is selected, but each remote ask still needs one-shot approval with /confirm <id>."
            return "blocked", "Offline Mode is active."

        if not online_status.ready:
            return "blocked", online_status.message

        return "allowed", f"Online Mode is active and {self._provider_label('openai', '')} is ready."

    @staticmethod
    def _telegram_loop_label(state: str) -> str:
        return {"running": "Running", "starting": "Starting", "stopped": "Stopped", "error": "Error"}.get(state, state)

    @staticmethod
    def _telegram_loop_activity_label(state: str) -> str:
        return {
            "idle": "Idle",
            "polling": "Polling",
            "processing_command": "Processing Command",
            "waiting_on_provider": "Waiting On Provider",
            "timed_out": "Timed Out",
            "provider_failed": "Provider Failed",
            "sent_reply": "Sent Reply",
        }.get(state, state)

    @staticmethod
    def _capability_state_label(state: str) -> str:
        return {
            "allowed": "Allowed",
            "blocked": "Blocked",
            "degraded": "Degraded",
            "confirmation_required": "Confirmation Required",
            "unavailable": "Unavailable",
            "unknown": "Unknown",
        }.get(state, state)

    @staticmethod
    def _access_kind_label(access_kind: str) -> str:
        return {
            "read_only": "read-only",
            "mutating": "mutating",
            "external_side_effect": "external-side-effect",
        }.get(access_kind, access_kind)

    @staticmethod
    def _locality_label(locality: str) -> str:
        return {
            "local_only": "local",
            "networked": "networked",
            "hybrid": "hybrid",
        }.get(locality, locality)

    @staticmethod
    def _offline_safety_label(offline_safety: str) -> str:
        return {
            "safe_offline": "offline-safe",
            "requires_online": "online-required",
            "optional_online": "online-sensitive",
        }.get(offline_safety, offline_safety)

    def _capability_manifest(self, capability_id: str) -> CapabilityManifest:
        return get_capability_manifest(capability_id)

    def _format_manifest_trust_summary(self, manifest: CapabilityManifest) -> str:
        parts = [
            self._access_kind_label(manifest.access_kind),
            self._locality_label(manifest.locality),
            self._offline_safety_label(manifest.offline_safety),
        ]
        if manifest.confirmation_sensitivity == "always":
            parts.append("always-confirm")
        elif manifest.confirmation_sensitivity == "policy_based":
            parts.append("policy-confirm")
        if manifest.telegram_exposure != "allowed":
            parts.append(f"telegram-{manifest.telegram_exposure}")
        return " | ".join(parts)

    def _format_evaluation_trust_summary(self, evaluation: CapabilityEvaluation) -> str:
        return self._summarize_text(
            self._format_manifest_trust_summary(self._capability_manifest(evaluation.capability_id)),
            limit=120,
        )

    def _build_execution_scope(
        self,
        capability_id: str,
        *,
        snapshot: ControllerSnapshot,
    ) -> ExecutionScope:
        manifest = self._capability_manifest(capability_id)
        if manifest.scope_type == "network" and capability_id == "ask.provider_query":
            if snapshot.selected_mode == "online" and snapshot.mode != "online":
                target_domain = "api.openai.com"
            elif snapshot.mode == "online":
                target_domain = "api.openai.com"
            else:
                target_domain = self._host_from_url(self._config.ollama_base_url) or "127.0.0.1"
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                target_domain=target_domain,
                domain_allowlist=(target_domain,),
            )
        if manifest.scope_type == "repository":
            repo_root = self._config.repo_root.strip() if manifest.scope_uses_configured_root else manifest.scope_repo_root
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                repo_root=repo_root,
                target_path=repo_root,
            )
        if manifest.scope_type == "filesystem":
            allowed_paths = self._config.file_allowed_roots if manifest.scope_uses_configured_paths else manifest.scope_allowed_paths
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                allowed_paths=tuple(allowed_paths),
            )
        if manifest.scope_type == "network" and manifest.scope_uses_configured_domains:
            return ExecutionScope(
                scope_type=manifest.scope_type,
                access_mode=manifest.access_mode,
                domain_allowlist=tuple(self._config.web_allowed_domains),
            )
        return ExecutionScope(
            scope_type=manifest.scope_type,
            access_mode=manifest.access_mode,
            repo_root=manifest.scope_repo_root,
            allowed_paths=manifest.scope_allowed_paths,
            domain_allowlist=manifest.scope_domain_allowlist,
        )

    def validate_request_scope(self, request) -> ScopeValidationResult:
        manifest = self._capability_manifest(request.capability_id)
        return self._scope_validator.validate(request, manifest)

    def _format_scope_summary(self, scope: ExecutionScope) -> str:
        parts = [f"{scope.scope_type}/{scope.access_mode}"]
        if scope.scope_type == "network" and scope.target_domain:
            parts.append(f"target={scope.target_domain}")
        elif scope.scope_type == "repository":
            parts.append(f"repo={self._repo_display_name(scope.repo_root)}")
        elif scope.scope_type == "filesystem" and scope.target_path:
            parts.append("target=path")
        return " ".join(parts)

    def _build_audit_record(self, result: CapabilityExecutionResult) -> AuditRecord:
        if result.capability_id == "repo.status.read":
            action_summary = str(result.telemetry.get("repo_summary") or f"repo status for {self._repo_display_name()}")
        elif result.capability_id == "file.read":
            action_summary = str(result.telemetry.get("file_summary") or "file preview")
        elif result.capability_id in {"file.create.write", "file.patch.write", "file.write.replace"}:
            action_summary = str(result.telemetry.get("file_summary") or result.request.metadata.get("argument_summary") or "file mutation")
        elif result.capability_id in {"shell.command.run", "test.command.run"}:
            action_summary = str(result.telemetry.get("execution_summary") or result.request.metadata.get("argument_summary") or "bounded execution")
            target_node_id = str(result.telemetry.get("target_node_id") or "").strip()
            if target_node_id:
                action_summary = f"{action_summary} | node {target_node_id}"
        elif result.capability_id in {"node.dispatch.query", "node.dispatch.status.read"}:
            action_summary = str(result.telemetry.get("execution_summary") or result.request.metadata.get("argument_summary") or "node dispatch")
            dispatch_job_id = str(result.telemetry.get("dispatch_job_id") or "").strip()
            target_node_id = str(result.telemetry.get("target_node_id") or "").strip()
            if dispatch_job_id:
                action_summary = f"{action_summary} | job {dispatch_job_id}"
            if target_node_id:
                action_summary = f"{action_summary} | node {target_node_id}"
        elif result.capability_id.startswith("build.bootstrap"):
            action_summary = str(result.telemetry.get("bootstrap_summary") or result.request.metadata.get("argument_summary") or "project bootstrap")
        elif result.capability_id == "web.fetch.read":
            action_summary = str(result.telemetry.get("web_summary") or "web fetch preview")
        elif result.capability_id == "context.read":
            action_summary = str(result.telemetry.get("context_summary") or "context listing")
        elif result.capability_id == "context.clear":
            action_summary = str(result.telemetry.get("context_clear_summary") or "context buffer cleared")
        elif result.capability_id in {"telegram.plain_text", "chat.orchestrate.read"}:
            action_summary = str(result.telemetry.get("natural_chat_summary") or result.request.metadata.get("argument_summary") or result.command_label)
        else:
            action_summary = str(result.request.metadata.get("argument_summary") or result.command_label)
        created_context_id = str(result.telemetry.get("context_created_id") or "").strip()
        used_context_id = str(result.telemetry.get("context_used_id") or "").strip()
        used_context_ids = str(result.telemetry.get("context_used_ids") or "").strip()
        workflow_id = str(result.telemetry.get("workflow_id") or "").strip().upper()
        workflow_state = str(result.telemetry.get("workflow_state") or "").strip()
        if created_context_id and result.capability_id in {"repo.status.read", "file.read", "web.fetch.read", "shell.command.run"}:
            action_summary = f"{action_summary} | created {created_context_id}"
        elif used_context_id and result.capability_id == "ask.provider_query":
            action_summary = f"{action_summary} | used {used_context_id}"
        elif used_context_ids and result.capability_id == "ask.provider_query":
            action_summary = f"{action_summary} | used {used_context_ids}"
        if workflow_id:
            workflow_suffix = f"workflow {workflow_id}"
            if workflow_state:
                workflow_suffix = f"{workflow_suffix} {workflow_state}"
            action_summary = f"{action_summary} | {workflow_suffix}"
        return AuditRecord(
            audit_id=self._generate_audit_id(),
            request_id=result.request_id,
            capability_id=result.capability_id,
            timestamp_start=result.started_at,
            timestamp_end=result.finished_at,
            outcome=result.outcome,
            outcome_reason=result.outcome_reason_code,
            user_id=result.request.user_id,
            chat_id=result.request.chat_id,
            confirmation_used=result.confirmation_used,
            scope_summary=result.scope_summary,
            provider_used=result.provider_used,
            duration_ms=result.duration_ms,
            action_summary=self._summarize_text(action_summary, limit=80),
            exit_code=result.telemetry.get("execution_exit_code") if isinstance(result.telemetry.get("execution_exit_code"), int) else None,
            output_summary=self._summarize_text(str(result.telemetry.get("execution_output_summary") or ""), limit=120),
        )

    def _current_or_latest_workflow(self) -> WorkflowRecord | None:
        self._cleanup_expired_workflows()
        return self._workflow_store.current_any() or self._workflow_store.latest_any()

    @staticmethod
    def _workflow_state_label(record: WorkflowRecord) -> str:
        label = record.current_state.replace("_", " ")
        pending_confirmation_id = record.metadata.get("pending_confirmation_id", "").strip().upper()
        if pending_confirmation_id and record.current_state == "paused":
            return f"{label} ({pending_confirmation_id})"
        return label

    @staticmethod
    def _workflow_step_label(record: WorkflowRecord) -> str:
        if record.current_step_index <= 0 or record.current_step_index > len(record.steps):
            return "No step started yet."
        step = record.steps[record.current_step_index - 1]
        return f"{step.step_id} {step.capability_id} {step.outcome} ({record.current_step_index}/{record.total_steps})".strip()

    @staticmethod
    def _workflow_summary_label(record: WorkflowRecord) -> str:
        return record.final_user_facing_summary or record.audit_summary or "No workflow executed yet."

    def _attach_workflow_metadata_to_confirmation(
        self,
        *,
        confirmation_id: str,
        workflow_id: str,
        workflow_type: str,
        workflow_step_id: str,
        workflow_step_index: int,
    ) -> None:
        self._confirmation_store.update_metadata(
            confirmation_id,
            metadata={
                "workflow_id": workflow_id,
                "workflow_type": workflow_type,
                "workflow_step_id": workflow_step_id,
                "workflow_step_index": str(workflow_step_index),
                "pending_confirmation_id": confirmation_id,
            },
        )

    def _format_audit_record_summary(self, record: AuditRecord | None) -> str:
        if record is None:
            return "No audit record yet."
        detail = record.output_summary or record.action_summary
        if record.action_summary:
            node_fragment = ""
            for part in [segment.strip() for segment in record.action_summary.split("|")]:
                if part.lower().startswith("node ") or part.lower().startswith("job "):
                    node_fragment = part
                    break
            if node_fragment and node_fragment not in detail:
                detail = f"{detail} | {node_fragment}" if detail else node_fragment
        if record.exit_code is not None:
            detail = f"exit {record.exit_code} | {detail}" if detail else f"exit {record.exit_code}"
        return self._summarize_text(
            f"- {self._short_time(record.timestamp_end)} {record.capability_id} | {record.outcome} | {record.outcome_reason}"
            + (f" | {detail}" if detail else ""),
            limit=120,
        )

    def _log_command_processing(self, *, parsed: _ParsedTelegramCommand, result: CapabilityExecutionResult) -> None:
        diagnostics = self.build_startup_diagnostics_snapshot()
        evaluation = self._last_capability_evaluation
        capability_state = self._capability_state_from_result(result)
        blocker = ""
        if evaluation is not None and evaluation.capability_id == result.capability_id:
            capability_state = evaluation.current_availability_state
            if capability_state != "allowed":
                blocker = evaluation.blocking_reason or evaluation.message
        if not blocker and result.outcome in {"blocked", "degraded", "unavailable", "out_of_scope"}:
            blocker = diagnostics.blockers[0] if diagnostics.blockers else ""
        lines = [
            f"[COMMAND] {self._command_log_label(parsed)}",
            f"[READINESS] {self._startup_diagnostics_formatter._readiness_label(diagnostics.readiness_status)}",
            f"[CAPABILITY] {result.capability_id} -> {capability_state}",
        ]
        if blocker:
            lines.append(f"[BLOCKER] {self._summarize_text(blocker, limit=140)}")
        lines.append(f"[RESULT] {result.internal_summary}")
        self._emit_terminal_lines(lines)

    def _emit_terminal_lines(self, lines: list[str] | tuple[str, ...]) -> None:
        for line in lines:
            self._terminal_logger(sanitize_log_text(line))

    @staticmethod
    def _capability_state_from_result(result: CapabilityExecutionResult) -> str:
        if result.outcome == "success":
            return "allowed"
        if result.outcome == "confirmation_required":
            return "confirmation_required"
        if result.outcome == "degraded":
            return "degraded"
        if result.outcome == "unavailable":
            return "unavailable"
        return "blocked"

    def _command_log_label(self, parsed: _ParsedTelegramCommand) -> str:
        if parsed.command_label in _PROVIDER_ASK_COMMANDS:
            return f"{parsed.command_label} [prompt hidden]"
        if parsed.command_label in {"/file", "/createfile", "/patchlast", "/patchfile", "/writefile"}:
            return f"{parsed.command_label} [path hidden]"
        if parsed.command_label in {"/web", "/summarizeweb"}:
            return f"{parsed.command_label} [url hidden]"
        return parsed.normalized_text or parsed.command_label

    @staticmethod
    def _generate_audit_id() -> str:
        return f"AUD-{secrets.token_hex(4).upper()}"

    @staticmethod
    def _host_from_url(value: str) -> str:
        if not value.strip():
            return ""
        parsed = urlparse(value)
        return (parsed.hostname or "").lower()

    @staticmethod
    def _sanitize_url_for_display(value: str) -> str:
        parsed = urlparse(value)
        return parsed._replace(query="", fragment="", params="").geturl()

    @staticmethod
    def _short_time(value: str) -> str:
        if not value or value == "-":
            return "--:--:--"
        try:
            return datetime.fromisoformat(value).astimezone().strftime("%H:%M:%S")
        except ValueError:
            return value

    def _compute_readiness(

        self,
        *,
        runtime_active: bool,
        telegram_status: TelegramChannelStatus,
    ) -> tuple[str, str]:
        return self._compute_readiness_from_reports(
            runtime_active=runtime_active,
            telegram_status=telegram_status,
            health_report=self._latest_health_report,
            security_report=self._latest_security_report,
        )

    def _compute_readiness_from_reports(
        self,
        *,
        runtime_active: bool,
        telegram_status: TelegramChannelStatus,
        health_report: DiagnosticReport | None,
        security_report: DiagnosticReport | None,
    ) -> tuple[str, str]:
        blocking: list[str] = []
        warnings: list[str] = []

        if not runtime_active:
            blocking.append("Runtime is not active. Use /startruntime to enable execution.")

        if self._config.current_mode != self._config.selected_mode:
            warnings.append("Current mode does not match the saved selection.")

        self._extend_readiness_from_report(
            report=health_report,
            warnings=warnings,
            blocking=blocking,
            missing_message="Health check has not been run yet.",
            ignored_codes=_LOCAL_READINESS_HEALTH_IGNORED_CODES,
        )
        self._extend_readiness_from_report(
            report=security_report,
            warnings=warnings,
            blocking=blocking,
            missing_message="Security check has not been run yet.",
            ignored_codes=_LOCAL_READINESS_SECURITY_IGNORED_CODES,
        )

        if not telegram_status.token_present:
            warnings.append("Telegram bot token is not stored.")
        elif telegram_status.validation_state != "valid":
            warnings.append(telegram_status.message)
        elif telegram_status.last_test_result != "passed":
            warnings.append("Telegram connection test has not passed yet.")

        if blocking:
            return "not_ready", " ".join(blocking[:2])
        if warnings:
            return "degraded", " ".join(warnings[:2])
        return "ready", "Local execution is enabled and diagnostics are ready."

    def _compute_network_readiness(
        self,
        *,
        runtime_active: bool,
        selected_provider_status: ProviderStatus,
        telegram_status: TelegramChannelStatus,
    ) -> tuple[str, str]:
        return self._compute_network_readiness_from_reports(
            runtime_active=runtime_active,
            selected_provider_status=selected_provider_status,
            telegram_status=telegram_status,
            health_report=self._latest_health_report,
            security_report=self._latest_security_report,
        )

    def _compute_network_readiness_from_reports(
        self,
        *,
        runtime_active: bool,
        selected_provider_status: ProviderStatus,
        telegram_status: TelegramChannelStatus,
        health_report: DiagnosticReport | None,
        security_report: DiagnosticReport | None,
    ) -> tuple[str, str]:
        blocking: list[str] = []
        warnings: list[str] = []

        if not runtime_active:
            blocking.append("Runtime is not active. Use /startruntime to enable execution.")

        compatibility_message = self._validate_mode_provider_pair(
            self._config.selected_mode,
            self._config.selected_provider,
            self._config.policy,
        )
        if compatibility_message:
            blocking.append(compatibility_message)

        if not selected_provider_status.ready:
            blocking.append(selected_provider_status.message)

        if self._config.current_mode != self._config.selected_mode:
            warnings.append("Current mode does not match the saved selection.")

        if health_report is None:
            warnings.append("Health check has not been run yet.")
        elif health_report.overall_status == "blocked":
            blocking.append("Health check reported blocking issues.")
        elif health_report.overall_status == "degraded":
            warnings.append("Health check reported warnings.")

        if security_report is None:
            warnings.append("Security check has not been run yet.")
        elif security_report.overall_status == "blocked":
            blocking.append("Security check reported blocking issues.")
        elif security_report.overall_status == "degraded":
            warnings.append("Security check reported warnings.")

        if not telegram_status.token_present:
            warnings.append("Telegram bot token is not stored.")
        elif telegram_status.validation_state != "valid":
            warnings.append(telegram_status.message)
        elif telegram_status.last_test_result != "passed":
            warnings.append("Telegram connection test has not passed yet.")

        if blocking:
            return "not_ready", " ".join(blocking[:2])
        if warnings:
            return "degraded", " ".join(warnings[:2])
        return "ready", "Execution, provider access, diagnostics, and Telegram are ready."

    def _startup_blockers(
        self,
        *,
        health_report: DiagnosticReport,
        security_report: DiagnosticReport,
        readiness_state: str,
        readiness_message: str,
    ) -> tuple[str, ...]:
        blockers: list[str] = []
        for report in (health_report, security_report):
            for item in report.items:
                if item.severity != "error":
                    continue
                if item.message not in blockers:
                    blockers.append(item.message)
        if readiness_state == "not_ready" and readiness_message and readiness_message not in blockers:
            blockers.append(readiness_message)
        return tuple(blockers)

    @staticmethod
    def _first_report_message(report: DiagnosticReport, *, severity: str, ignored_codes: frozenset[str]) -> str:
        for item in report.items:
            if item.code in ignored_codes:
                continue
            if item.severity == severity:
                return item.message
        return ""

    def _extend_readiness_from_report(
        self,
        *,
        report: DiagnosticReport | None,
        warnings: list[str],
        blocking: list[str],
        missing_message: str,
        ignored_codes: frozenset[str],
    ) -> None:
        if report is None:
            warnings.append(missing_message)
            return
        error_message = self._first_report_message(report, severity="error", ignored_codes=ignored_codes)
        if error_message:
            blocking.append(error_message)
            return
        if report.overall_status == "blocked" and not report.items:
            fallback = report.summary.strip() or f"{report.check_type.title()} check reported blocking issues."
            blocking.append(fallback)
            return
        warning_message = self._first_report_message(report, severity="warning", ignored_codes=ignored_codes)
        if warning_message:
            warnings.append(warning_message)
            return
        if report.overall_status == "degraded" and not report.items:
            fallback = report.summary.strip() or f"{report.check_type.title()} check reported warnings."
            warnings.append(fallback)








