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
