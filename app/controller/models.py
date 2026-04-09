"""Shared controller-side state models."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple


RuntimeState = Literal["stopped", "starting", "running", "error"]
Mode = Literal["offline", "online"]
Policy = Literal["always_offline", "ask_before_online", "always_online"]
ProviderType = Literal["ollama", "openai"]
ValidationState = Literal["unknown", "valid", "invalid", "partial"]
OverallStatus = Literal["unknown", "ok", "degraded", "blocked"]
ReadinessState = Literal["not_ready", "degraded", "ready"]
TelegramTestResult = Literal["not_run", "passed", "failed"]
TelegramLoopState = Literal["stopped", "starting", "running", "error"]
TelegramLoopActivityState = Literal[
    "idle",
    "polling",
    "processing_command",
    "waiting_on_provider",
    "timed_out",
    "provider_failed",
    "sent_reply",
]
CapabilityAvailabilityState = Literal[
    "unknown",
    "allowed",
    "blocked",
    "degraded",
    "confirmation_required",
    "unavailable",
]
ConfirmationState = Literal["none", "pending", "approved", "rejected", "expired"]


@dataclass(frozen=True)
class ControllerSnapshot:
    runtime_state: RuntimeState
    status_message: str
    mode: Mode
    selected_mode: Mode
    policy: Policy
    active_provider: ProviderType
    selected_provider: ProviderType
    provider_status: ValidationState
    provider_message: str
    provider_ready: bool
    provider_model: str
    available_provider_models: Tuple[str, ...]
    openai_key_masked: str
    telegram_configured: bool
    telegram_token_present: bool
    telegram_status: ValidationState
    telegram_message: str
    telegram_token_masked: str
    telegram_bot_identity: str
    telegram_last_test_result: TelegramTestResult
    telegram_last_test_at: str
    telegram_loop_state: TelegramLoopState
    telegram_loop_activity: TelegramLoopActivityState
    telegram_loop_message: str
    telegram_last_activity_at: str
    telegram_last_command: str
    telegram_last_ask_status: str
    telegram_last_inbound_summary: str
    telegram_last_outbound_summary: str
    configured_repo_root: str
    configured_file_roots: str
    configured_web_domains: str
    registered_node_count: int
    selected_node_id: str
    selected_node_summary: str
    buffered_context_count: int
    last_context_source: str
    current_context_freshness: str
    last_context_action: str
    last_repo_branch: str
    last_repo_status: str
    last_repo_checked_at: str
    last_file_read: str
    last_file_read_status: str
    last_file_read_at: str
    last_web_fetch: str
    last_web_status: str
    last_web_content_type: str
    last_web_fetched_at: str
    last_capability_id: str
    last_capability_state: CapabilityAvailabilityState
    last_capability_message: str
    last_capability_trust_summary: str
    last_execution_outcome: str
    last_execution_reason_code: str
    last_execution_summary: str
    last_execution_trust_summary: str
    last_execution_scope_summary: str
    last_execution_duration_ms: int
    last_execution_finished_at: str
    last_audit_summary: str
    last_workflow_type: str
    last_workflow_state: str
    last_workflow_step: str
    last_workflow_summary: str
    pending_confirmation_count: int
    last_confirmation_requested: str
    last_confirmation_result: str
    readiness_state: ReadinessState
    readiness_message: str
    health_status: OverallStatus
    safety_status: OverallStatus
    last_health_check_at: str
    last_security_check_at: str
    health_summary: str
    safety_summary: str
    diagnostic_summary_lines: Tuple[str, ...]
    openclaw_installed: bool
    openclaw_path: str
    ollama_installed: bool
    ollama_path: str
    runtime_pid: int | None
    recent_logs: Tuple[str, ...]
