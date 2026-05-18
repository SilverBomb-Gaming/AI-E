"""Minimal PySide6 window for OpenClaw runtime control."""
from __future__ import annotations

import sys
import threading
import traceback
from typing import Callable

from PySide6 import QtCore, QtGui, QtWidgets

from .app_service import ControllerService
from .models import ControllerSnapshot, Mode, Policy, ProviderType


APP_TITLE = "AI-E Operator Console"
APP_SUBTITLE = (
    "A governed conversational AI environment for bounded developer assistance. "
    "Runtime plugins stay optional; AI-E keeps approvals, scope, and operational truth visible."
)
DEFAULT_TRUTH_LINE = "Workflow Not Started | Mutation Not Applied | Validation Not Run | Playtest Not Confirmed | Deploy Not Deployed"
STARTUP_CONVERSATION_GREETING = (
    "AI-E: Ready. Tell me what you want to inspect, fix, or prepare. "
    "I will scope the request first and ask for approval before any bounded action."
)
INFRASTRUCTURE_SECTION_TITLE = "Infrastructure"
INFRASTRUCTURE_DEFAULT_EXPANDED = False
INFRASTRUCTURE_COMPRESSED_PANELS = (
    "Mode + Provider Settings",
    "Telegram Channel",
    "Diagnostics",
    "Runtime Actions",
    "Status Panel",
    "Runtime Logs",
)


class _Bridge(QtCore.QObject):
    snapshot_ready = QtCore.Signal(object)
    conversation_ready = QtCore.Signal(object)
    failure = QtCore.Signal(str)


class FoundationWindow(QtWidgets.QMainWindow):
    """Windows-first foundation shell for runtime lifecycle control."""

    def __init__(self, service: ControllerService | None = None) -> None:
        super().__init__()
        self._service = service or ControllerService()
        self._bridge = _Bridge()
        self._bridge.snapshot_ready.connect(self._apply_snapshot)
        self._bridge.conversation_ready.connect(self._apply_conversation_reply)
        self._bridge.failure.connect(self._handle_background_failure)
        self._refresh_form_on_next_snapshot = True
        self._clear_openai_key_on_next_snapshot = False
        self._clear_telegram_token_on_next_snapshot = False
        self._build_ui()
        self._poll_timer = QtCore.QTimer(self)
        self._poll_timer.setInterval(1500)
        self._poll_timer.timeout.connect(self._poll_status)
        self._poll_timer.start()
        self._apply_snapshot(self._service.snapshot())

    def _build_ui(self) -> None:
        self.setWindowTitle(APP_TITLE)
        self.resize(1080, 820)
        self.setMinimumSize(920, 700)

        scroll_area = QtWidgets.QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QtWidgets.QFrame.Shape.NoFrame)

        root = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(root)
        layout.setContentsMargins(16, 16, 16, 16)
        layout.setSpacing(16)

        title = QtWidgets.QLabel(APP_TITLE)
        title.setStyleSheet("font-size: 24px; font-weight: 700;")
        layout.addWidget(title)

        subtitle = QtWidgets.QLabel(APP_SUBTITLE)
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color: #555;")
        layout.addWidget(subtitle)

        self.runtime_readiness_strip = QtWidgets.QLabel("Runtime readiness: Detecting plugins...")
        self.runtime_readiness_strip.setObjectName("runtimeReadinessStrip")
        self.runtime_readiness_strip.setWordWrap(True)
        self.runtime_readiness_strip.setStyleSheet(
            "padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; "
            "background: #f8fafc; color: #0f172a; font-weight: 600;"
        )
        layout.addWidget(self.runtime_readiness_strip)

        layout.addWidget(self._build_conversation_panel(), stretch=1)
        layout.addWidget(self._build_infrastructure_section())
        layout.addStretch(1)

        scroll_area.setWidget(root)
        self.setCentralWidget(scroll_area)
        self.statusBar().showMessage("Controller ready.")

    def _build_conversation_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Conversation")
        layout = QtWidgets.QVBoxLayout(group)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(10)

        self.conversation_view = QtWidgets.QPlainTextEdit()
        self.conversation_view.setReadOnly(True)
        self.conversation_view.setMinimumHeight(360)
        self.conversation_view.setPlaceholderText("Conversation history will appear here.")
        self.conversation_view.setPlainText(f"{STARTUP_CONVERSATION_GREETING}\n\nTruth: {DEFAULT_TRUTH_LINE}")
        layout.addWidget(self.conversation_view)

        input_row = QtWidgets.QHBoxLayout()
        input_row.setContentsMargins(0, 0, 0, 0)
        input_row.setSpacing(10)

        self.conversation_input = QtWidgets.QLineEdit()
        self.conversation_input.setPlaceholderText("Ask AI-E to inspect a game-dev issue, prepare a safe plan, or explain current runtime readiness...")
        self.conversation_input.returnPressed.connect(self._handle_conversation_submit)
        self._configure_input_widget(self.conversation_input)

        self.conversation_send_button = QtWidgets.QPushButton("Send")
        self.conversation_send_button.clicked.connect(self._handle_conversation_submit)
        self._configure_button(self.conversation_send_button)

        input_row.addWidget(self.conversation_input, stretch=1)
        input_row.addWidget(self.conversation_send_button)
        layout.addLayout(input_row)

        self.conversation_processing_label = self._create_value_label("Idle - conversation is primary; infrastructure stays below.")
        self.conversation_processing_label.setStyleSheet("color: #475569;")
        layout.addWidget(self.conversation_processing_label)
        return group

    def _build_infrastructure_section(self) -> QtWidgets.QWidget:
        section = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(section)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(10)

        self.infrastructure_toggle = QtWidgets.QToolButton()
        self.infrastructure_toggle.setToolButtonStyle(QtCore.Qt.ToolButtonStyle.ToolButtonTextBesideIcon)
        self.infrastructure_toggle.setCheckable(True)
        self.infrastructure_toggle.setChecked(INFRASTRUCTURE_DEFAULT_EXPANDED)
        self.infrastructure_toggle.toggled.connect(self._set_infrastructure_expanded)
        self.infrastructure_toggle.setStyleSheet(
            "padding: 8px 10px; border: 1px solid #cbd5e1; border-radius: 6px; "
            "background: #ffffff; color: #334155; font-weight: 600;"
        )
        layout.addWidget(self.infrastructure_toggle)

        self.infrastructure_content = QtWidgets.QWidget()
        content_layout = QtWidgets.QVBoxLayout(self.infrastructure_content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(12)
        content_layout.addWidget(self._build_settings_panel())
        content_layout.addWidget(self._build_telegram_panel())
        content_layout.addWidget(self._build_diagnostics_panel())
        content_layout.addWidget(self._build_actions_panel())
        content_layout.addWidget(self._build_status_panel())
        content_layout.addWidget(self._build_logs_panel())
        layout.addWidget(self.infrastructure_content)

        self._set_infrastructure_expanded(INFRASTRUCTURE_DEFAULT_EXPANDED)
        return section

    def _set_infrastructure_expanded(self, expanded: bool) -> None:
        self.infrastructure_content.setVisible(expanded)
        self.infrastructure_toggle.setArrowType(
            QtCore.Qt.ArrowType.DownArrow if expanded else QtCore.Qt.ArrowType.RightArrow
        )
        self.infrastructure_toggle.setText(
            f"Hide {INFRASTRUCTURE_SECTION_TITLE}" if expanded else f"Show {INFRASTRUCTURE_SECTION_TITLE}"
        )

    def _build_settings_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Mode + Provider Settings")
        layout = self._create_form_layout(group)

        self.mode_selector = QtWidgets.QComboBox()
        self.mode_selector.addItem("Offline", "offline")
        self.mode_selector.addItem("Online", "online")
        self._configure_input_widget(self.mode_selector)

        self.provider_selector = QtWidgets.QComboBox()
        self.provider_selector.addItem("Ollama", "ollama")
        self.provider_selector.addItem("OpenAI", "openai")
        self._configure_input_widget(self.provider_selector)

        self.policy_selector = QtWidgets.QComboBox()
        self.policy_selector.addItem("Always Offline", "always_offline")
        self.policy_selector.addItem("Ask Before Online", "ask_before_online")
        self.policy_selector.addItem("Always Online", "always_online")
        self._configure_input_widget(self.policy_selector)

        self.ollama_model_input = QtWidgets.QComboBox()
        self.ollama_model_input.setEditable(True)
        self._configure_input_widget(self.ollama_model_input)

        self.openai_key_input = QtWidgets.QLineEdit()
        self.openai_key_input.setEchoMode(QtWidgets.QLineEdit.EchoMode.Password)
        self.openai_key_input.setPlaceholderText("sk-...")
        self._configure_input_widget(self.openai_key_input)

        self.openai_key_status_value = self._create_value_label("No key saved.")

        self.validate_provider_button = QtWidgets.QPushButton("Validate Provider")
        self.validate_provider_button.clicked.connect(self._handle_validate_provider)
        self.save_settings_button = QtWidgets.QPushButton("Save Settings")
        self.save_settings_button.clicked.connect(self._handle_save_settings)
        self._configure_button(self.validate_provider_button)
        self._configure_button(self.save_settings_button)

        actions_widget = QtWidgets.QWidget()
        actions_layout = QtWidgets.QHBoxLayout(actions_widget)
        actions_layout.setContentsMargins(0, 0, 0, 0)
        actions_layout.setSpacing(10)
        actions_layout.addWidget(self.validate_provider_button)
        actions_layout.addWidget(self.save_settings_button)
        actions_layout.addStretch(1)

        layout.addRow("Selected Mode", self.mode_selector)
        layout.addRow("Selected Provider", self.provider_selector)
        layout.addRow("Policy", self.policy_selector)
        layout.addRow("Preferred Ollama Model", self.ollama_model_input)
        layout.addRow("OpenAI API Key", self.openai_key_input)
        layout.addRow("Stored OpenAI Key", self.openai_key_status_value)
        layout.addRow("Actions", actions_widget)
        return group

    def _build_telegram_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Telegram Channel")
        layout = self._create_form_layout(group)

        self.telegram_status_value = self._create_value_label("Unknown")
        self.telegram_token_input = QtWidgets.QLineEdit()
        self.telegram_token_input.setEchoMode(QtWidgets.QLineEdit.EchoMode.Password)
        self.telegram_token_input.setPlaceholderText("123456789:AA...")
        self._configure_input_widget(self.telegram_token_input)
        self.telegram_token_masked_value = self._create_value_label("No token saved.")
        self.telegram_bot_identity_value = self._create_value_label("-")
        self.telegram_last_test_result_value = self._create_value_label("Not Run")
        self.telegram_last_test_at_value = self._create_value_label("-")
        self.telegram_loop_status_value = self._create_value_label("Stopped")
        self.telegram_loop_activity_value = self._create_value_label("Idle")
        self.telegram_loop_message_value = self._create_value_label("Telegram loop is stopped.")
        self.telegram_last_activity_value = self._create_value_label("-")
        self.telegram_last_command_value = self._create_value_label("No Telegram command handled yet.")
        self.telegram_last_ask_status_value = self._create_value_label("No provider-backed ask has run yet.")
        self.telegram_last_inbound_value = self._create_value_label("No inbound Telegram activity yet.")
        self.telegram_last_outbound_value = self._create_value_label("No outbound Telegram activity yet.")

        self.save_telegram_button = QtWidgets.QPushButton("Save Telegram Settings")
        self.validate_telegram_button = QtWidgets.QPushButton("Validate Telegram")
        self.test_telegram_button = QtWidgets.QPushButton("Test Telegram Connection")
        self.start_telegram_loop_button = QtWidgets.QPushButton("Start Telegram Loop")
        self.stop_telegram_loop_button = QtWidgets.QPushButton("Stop Telegram Loop")
        self.save_telegram_button.clicked.connect(self._handle_save_telegram_settings)
        self.validate_telegram_button.clicked.connect(self._handle_validate_telegram)
        self.test_telegram_button.clicked.connect(self._handle_test_telegram)
        self.start_telegram_loop_button.clicked.connect(lambda: self._run_background(self._service.start_telegram_loop))
        self.stop_telegram_loop_button.clicked.connect(lambda: self._run_background(self._service.stop_telegram_loop))
        self._configure_button(self.save_telegram_button)
        self._configure_button(self.validate_telegram_button)
        self._configure_button(self.test_telegram_button)
        self._configure_button(self.start_telegram_loop_button)
        self._configure_button(self.stop_telegram_loop_button)

        actions_widget = QtWidgets.QWidget()
        actions_layout = QtWidgets.QVBoxLayout(actions_widget)
        actions_layout.setContentsMargins(0, 0, 0, 0)
        actions_layout.setSpacing(8)
        top_row = QtWidgets.QHBoxLayout()
        top_row.setContentsMargins(0, 0, 0, 0)
        top_row.setSpacing(10)
        top_row.addWidget(self.save_telegram_button)
        top_row.addWidget(self.validate_telegram_button)
        top_row.addStretch(1)
        actions_layout.addLayout(top_row)
        middle_row = QtWidgets.QHBoxLayout()
        middle_row.setContentsMargins(0, 0, 0, 0)
        middle_row.setSpacing(10)
        middle_row.addWidget(self.start_telegram_loop_button)
        middle_row.addWidget(self.stop_telegram_loop_button)
        middle_row.addStretch(1)
        actions_layout.addLayout(middle_row)
        actions_layout.addWidget(self.test_telegram_button)

        layout.addRow("Telegram Status", self.telegram_status_value)
        layout.addRow("Bot Token", self.telegram_token_input)
        layout.addRow("Stored Token", self.telegram_token_masked_value)
        layout.addRow("Bot Identity", self.telegram_bot_identity_value)
        layout.addRow("Last Test Result", self.telegram_last_test_result_value)
        layout.addRow("Last Test At", self.telegram_last_test_at_value)
        layout.addRow("Loop Status", self.telegram_loop_status_value)
        layout.addRow("Loop Activity", self.telegram_loop_activity_value)
        layout.addRow("Loop Message", self.telegram_loop_message_value)
        layout.addRow("Last Activity", self.telegram_last_activity_value)
        layout.addRow("Last Command", self.telegram_last_command_value)
        layout.addRow("Last /ask Status", self.telegram_last_ask_status_value)
        layout.addRow("Last Inbound", self.telegram_last_inbound_value)
        layout.addRow("Last Outbound", self.telegram_last_outbound_value)
        layout.addRow("Actions", actions_widget)
        return group

    def _build_diagnostics_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Diagnostics")
        layout = self._create_form_layout(group)

        self.health_status_value = self._create_value_label("Unknown")
        self.safety_status_value = self._create_value_label("Unknown")
        self.last_health_check_value = self._create_value_label("-")
        self.last_security_check_value = self._create_value_label("-")
        self.health_summary_value = self._create_value_label("Health check has not been run yet.")
        self.safety_summary_value = self._create_value_label("Security check has not been run yet.")

        self.diagnostic_summary_view = QtWidgets.QPlainTextEdit()
        self.diagnostic_summary_view.setReadOnly(True)
        self.diagnostic_summary_view.setPlaceholderText("Diagnostic summary will appear here.")
        self.diagnostic_summary_view.setMinimumHeight(180)
        self.diagnostic_summary_view.setSizePolicy(
            QtWidgets.QSizePolicy.Policy.Expanding,
            QtWidgets.QSizePolicy.Policy.MinimumExpanding,
        )

        layout.addRow("Health Status", self.health_status_value)
        layout.addRow("Safety Status", self.safety_status_value)
        layout.addRow("Last Health Check", self.last_health_check_value)
        layout.addRow("Last Security Check", self.last_security_check_value)
        layout.addRow("Health Summary", self.health_summary_value)
        layout.addRow("Safety Summary", self.safety_summary_value)
        layout.addRow("Summary Panel", self.diagnostic_summary_view)
        return group

    def _build_actions_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Runtime Actions")
        layout = QtWidgets.QGridLayout(group)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setHorizontalSpacing(10)
        layout.setVerticalSpacing(10)

        self.start_button = QtWidgets.QPushButton("Start Runtime")
        self.stop_button = QtWidgets.QPushButton("Stop Runtime")
        self.restart_button = QtWidgets.QPushButton("Restart Runtime")
        self.status_button = QtWidgets.QPushButton("Check Status")
        self.health_check_button = QtWidgets.QPushButton("Run Health Check")
        self.security_check_button = QtWidgets.QPushButton("Run Security Check")
        self.clear_logs_button = QtWidgets.QPushButton("Clear Logs")
        self.copy_diagnostics_button = QtWidgets.QPushButton("Copy Diagnostic Summary")

        self.start_button.clicked.connect(lambda: self._run_background(self._service.start_runtime))
        self.stop_button.clicked.connect(lambda: self._run_background(self._service.stop_runtime))
        self.restart_button.clicked.connect(lambda: self._run_background(self._service.restart_runtime))
        self.status_button.clicked.connect(lambda: self._run_background(self._service.check_status))
        self.health_check_button.clicked.connect(lambda: self._run_background(self._service.run_health_check))
        self.security_check_button.clicked.connect(lambda: self._run_background(self._service.run_security_check))
        self.clear_logs_button.clicked.connect(lambda: self._run_background(self._service.clear_logs))
        self.copy_diagnostics_button.clicked.connect(self._copy_diagnostic_summary)

        for button in (
            self.start_button,
            self.stop_button,
            self.restart_button,
            self.status_button,
            self.health_check_button,
            self.security_check_button,
            self.clear_logs_button,
            self.copy_diagnostics_button,
        ):
            self._configure_button(button)

        layout.addWidget(self.start_button, 0, 0)
        layout.addWidget(self.stop_button, 0, 1)
        layout.addWidget(self.restart_button, 0, 2)
        layout.addWidget(self.status_button, 0, 3)
        layout.addWidget(self.health_check_button, 1, 0)
        layout.addWidget(self.security_check_button, 1, 1)
        layout.addWidget(self.clear_logs_button, 1, 2)
        layout.addWidget(self.copy_diagnostics_button, 1, 3)
        return group

    def _build_status_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Status Panel")
        layout = self._create_form_layout(group)

        self.runtime_state_value = self._create_value_label("stopped")
        self.status_message_value = self._create_value_label("Runtime stopped.")
        self.readiness_state_value = self._create_value_label("Not Ready")
        self.readiness_message_value = self._create_value_label("Run health and security checks after validation.")
        self.current_mode_value = self._create_value_label("offline")
        self.current_provider_value = self._create_value_label("ollama")
        self.current_policy_value = self._create_value_label("ask_before_online")
        self.provider_status_value = self._create_value_label("unknown")
        self.provider_status_message_value = self._create_value_label("Provider has not been validated yet.")
        self.telegram_status_summary_value = self._create_value_label("unknown")
        self.telegram_loop_activity_summary_value = self._create_value_label("Idle")
        self.configured_repo_root_value = self._create_value_label("-")
        self.configured_file_roots_value = self._create_value_label("-")
        self.configured_web_domains_value = self._create_value_label("-")
        self.buffered_context_count_value = self._create_value_label("0")
        self.last_context_source_value = self._create_value_label("No buffered context yet.")
        self.last_context_action_value = self._create_value_label("No context action yet.")
        self.last_repo_branch_value = self._create_value_label("-")
        self.last_repo_status_value = self._create_value_label("No repository insight result yet.")
        self.last_repo_checked_value = self._create_value_label("-")
        self.last_file_read_value = self._create_value_label("No file preview result yet.")
        self.last_file_status_value = self._create_value_label("No file preview result yet.")
        self.last_file_read_at_value = self._create_value_label("-")
        self.last_web_fetch_value = self._create_value_label("No web fetch result yet.")
        self.last_web_status_value = self._create_value_label("No web fetch result yet.")
        self.last_web_content_type_value = self._create_value_label("-")
        self.last_web_fetched_at_value = self._create_value_label("-")
        self.last_capability_id_value = self._create_value_label("-")
        self.last_capability_state_value = self._create_value_label("Unknown")
        self.last_capability_message_value = self._create_value_label("No capability evaluated yet.")
        self.last_capability_trust_value = self._create_value_label("No capability trust summary yet.")
        self.last_execution_outcome_value = self._create_value_label("Unknown")
        self.last_execution_reason_value = self._create_value_label("No execution result yet.")
        self.last_execution_summary_value = self._create_value_label("No execution result yet.")
        self.last_execution_trust_value = self._create_value_label("No execution trust summary yet.")
        self.last_execution_scope_value = self._create_value_label("No execution scope summary yet.")
        self.last_execution_duration_value = self._create_value_label("-")
        self.last_execution_finished_value = self._create_value_label("-")
        self.last_audit_summary_value = self._create_value_label("No audit record yet.")
        self.last_workflow_type_value = self._create_value_label("-")
        self.last_workflow_state_value = self._create_value_label("No workflow yet.")
        self.last_workflow_step_value = self._create_value_label("No workflow step yet.")
        self.last_workflow_summary_value = self._create_value_label("No workflow executed yet.")
        self.pending_confirmations_value = self._create_value_label("0")
        self.last_confirmation_requested_value = self._create_value_label("No pending confirmation requested yet.")
        self.last_confirmation_result_value = self._create_value_label("No confirmation handled yet.")
        self.telegram_status_message_value = self._create_value_label("Telegram has not been configured yet.")
        self.telegram_bot_value = self._create_value_label("-")
        self.telegram_test_value = self._create_value_label("Not Run")
        self.openclaw_value = self._create_value_label("Detecting...")
        self.ollama_value = self._create_value_label("Detecting...")
        self.runtime_pid_value = self._create_value_label("-")

        layout.addRow("Runtime State", self.runtime_state_value)
        layout.addRow("Status", self.status_message_value)
        layout.addRow("Readiness", self.readiness_state_value)
        layout.addRow("Readiness Note", self.readiness_message_value)
        layout.addRow("Current Mode", self.current_mode_value)
        layout.addRow("Current Provider", self.current_provider_value)
        layout.addRow("Policy", self.current_policy_value)
        layout.addRow("Provider Status", self.provider_status_value)
        layout.addRow("Provider Message", self.provider_status_message_value)
        layout.addRow("Telegram Status", self.telegram_status_summary_value)
        layout.addRow("Loop Activity", self.telegram_loop_activity_summary_value)
        layout.addRow("Configured Repo", self.configured_repo_root_value)
        layout.addRow("Allowed File Roots", self.configured_file_roots_value)
        layout.addRow("Allowed Web Domains", self.configured_web_domains_value)
        layout.addRow("Buffered Contexts", self.buffered_context_count_value)
        layout.addRow("Last Context Source", self.last_context_source_value)
        layout.addRow("Last Context Action", self.last_context_action_value)
        layout.addRow("Last Repo Branch", self.last_repo_branch_value)
        layout.addRow("Last Repo Status", self.last_repo_status_value)
        layout.addRow("Last Repo Checked", self.last_repo_checked_value)
        layout.addRow("Last File Read", self.last_file_read_value)
        layout.addRow("File Read Status", self.last_file_status_value)
        layout.addRow("Last File Read At", self.last_file_read_at_value)
        layout.addRow("Last Web Fetch", self.last_web_fetch_value)
        layout.addRow("Web Fetch Status", self.last_web_status_value)
        layout.addRow("Web Content Type", self.last_web_content_type_value)
        layout.addRow("Last Web Fetch At", self.last_web_fetched_at_value)
        layout.addRow("Last Capability", self.last_capability_id_value)
        layout.addRow("Capability State", self.last_capability_state_value)
        layout.addRow("Capability Note", self.last_capability_message_value)
        layout.addRow("Capability Trust", self.last_capability_trust_value)
        layout.addRow("Last Outcome", self.last_execution_outcome_value)
        layout.addRow("Outcome Reason", self.last_execution_reason_value)
        layout.addRow("Result Summary", self.last_execution_summary_value)
        layout.addRow("Execution Trust", self.last_execution_trust_value)
        layout.addRow("Execution Scope", self.last_execution_scope_value)
        layout.addRow("Result Duration", self.last_execution_duration_value)
        layout.addRow("Result Finished", self.last_execution_finished_value)
        layout.addRow("Recent Audit", self.last_audit_summary_value)
        layout.addRow("Last Workflow Type", self.last_workflow_type_value)
        layout.addRow("Last Workflow State", self.last_workflow_state_value)
        layout.addRow("Last Workflow Step", self.last_workflow_step_value)
        layout.addRow("Last Workflow Summary", self.last_workflow_summary_value)
        layout.addRow("Pending Confirmations", self.pending_confirmations_value)
        layout.addRow("Last Confirmation Request", self.last_confirmation_requested_value)
        layout.addRow("Last Confirmation Result", self.last_confirmation_result_value)
        layout.addRow("Telegram Message", self.telegram_status_message_value)
        layout.addRow("Telegram Bot", self.telegram_bot_value)
        layout.addRow("Telegram Test", self.telegram_test_value)
        layout.addRow("OpenClaw", self.openclaw_value)
        layout.addRow("Ollama", self.ollama_value)
        layout.addRow("PID", self.runtime_pid_value)
        return group

    def _build_logs_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Runtime Logs")
        group.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Expanding)
        layout = QtWidgets.QVBoxLayout(group)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self.logs_view = QtWidgets.QPlainTextEdit()
        self.logs_view.setReadOnly(True)
        self.logs_view.setPlaceholderText("No runtime logs yet.")
        self.logs_view.setMinimumHeight(220)
        self.logs_view.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Expanding)
        layout.addWidget(self.logs_view)
        return group

    def _create_form_layout(self, parent: QtWidgets.QWidget) -> QtWidgets.QFormLayout:
        layout = QtWidgets.QFormLayout(parent)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setHorizontalSpacing(14)
        layout.setVerticalSpacing(8)
        layout.setLabelAlignment(QtCore.Qt.AlignmentFlag.AlignLeft | QtCore.Qt.AlignmentFlag.AlignTop)
        layout.setFormAlignment(QtCore.Qt.AlignmentFlag.AlignTop)
        layout.setFieldGrowthPolicy(QtWidgets.QFormLayout.FieldGrowthPolicy.ExpandingFieldsGrow)
        layout.setRowWrapPolicy(QtWidgets.QFormLayout.RowWrapPolicy.WrapLongRows)
        return layout

    def _configure_input_widget(self, widget: QtWidgets.QWidget) -> None:
        widget.setMinimumHeight(34)
        widget.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Fixed)

    def _configure_button(self, button: QtWidgets.QPushButton) -> None:
        button.setMinimumHeight(36)
        button.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Fixed)

    def _create_value_label(self, text: str) -> QtWidgets.QLabel:
        label = QtWidgets.QLabel(text)
        label.setWordWrap(True)
        label.setTextInteractionFlags(QtCore.Qt.TextInteractionFlag.TextSelectableByMouse)
        label.setSizePolicy(QtWidgets.QSizePolicy.Policy.Expanding, QtWidgets.QSizePolicy.Policy.Minimum)
        return label

    def _run_background(self, action: Callable[[], ControllerSnapshot]) -> None:
        self._set_controls_enabled(False)
        thread = threading.Thread(target=self._invoke_action, args=(action,), daemon=True)
        thread.start()

    def _invoke_action(self, action: Callable[[], ControllerSnapshot]) -> None:
        try:
            snapshot = action()
        except Exception:  # noqa: BLE001
            self._bridge.failure.emit(traceback.format_exc())
            return
        self._bridge.snapshot_ready.emit(snapshot)

    def _poll_status(self) -> None:
        self._apply_snapshot(self._service.snapshot())

    def _apply_snapshot(self, snapshot: ControllerSnapshot) -> None:
        self.runtime_state_value.setText(snapshot.runtime_state)
        self.status_message_value.setText(snapshot.status_message)
        self.runtime_readiness_strip.setText(self._runtime_plugin_readiness_label(snapshot))
        self.readiness_state_value.setText(self._readiness_label(snapshot.readiness_state))
        self.readiness_message_value.setText(snapshot.readiness_message)
        self.current_mode_value.setText(snapshot.mode)
        self.current_provider_value.setText(self._provider_label(snapshot.active_provider, snapshot.provider_model))
        self.current_policy_value.setText(snapshot.policy)
        self.provider_status_value.setText(snapshot.provider_status)
        self.provider_status_message_value.setText(snapshot.provider_message)
        self.telegram_status_summary_value.setText(self._telegram_status_label(snapshot.telegram_status))
        self.configured_repo_root_value.setText(snapshot.configured_repo_root)
        self.configured_file_roots_value.setText(snapshot.configured_file_roots)
        self.configured_web_domains_value.setText(snapshot.configured_web_domains)
        self.buffered_context_count_value.setText(str(snapshot.buffered_context_count))
        self.last_context_source_value.setText(snapshot.last_context_source)
        self.last_context_action_value.setText(snapshot.last_context_action)
        self.last_repo_branch_value.setText(snapshot.last_repo_branch)
        self.last_repo_status_value.setText(snapshot.last_repo_status)
        self.last_repo_checked_value.setText(snapshot.last_repo_checked_at)
        self.last_file_read_value.setText(snapshot.last_file_read)
        self.last_file_status_value.setText(snapshot.last_file_read_status)
        self.last_file_read_at_value.setText(snapshot.last_file_read_at)
        self.last_web_fetch_value.setText(snapshot.last_web_fetch)
        self.last_web_status_value.setText(snapshot.last_web_status)
        self.last_web_content_type_value.setText(snapshot.last_web_content_type)
        self.last_web_fetched_at_value.setText(snapshot.last_web_fetched_at)
        self.telegram_status_message_value.setText(snapshot.telegram_message)
        self.telegram_bot_value.setText(snapshot.telegram_bot_identity)
        self.telegram_test_value.setText(self._telegram_test_label(snapshot.telegram_last_test_result, snapshot.telegram_last_test_at))
        self.openclaw_value.setText(self._format_installation(snapshot.openclaw_installed, snapshot.openclaw_path))
        self.ollama_value.setText(self._format_installation(snapshot.ollama_installed, snapshot.ollama_path))
        self.runtime_pid_value.setText(str(snapshot.runtime_pid) if snapshot.runtime_pid else "-")
        self.logs_view.setPlainText("\n".join(snapshot.recent_logs))
        self.openai_key_status_value.setText(snapshot.openai_key_masked or "No key saved.")
        self.telegram_status_value.setText(self._telegram_status_label(snapshot.telegram_status))
        self.telegram_token_masked_value.setText(snapshot.telegram_token_masked or "No token saved.")
        self.telegram_bot_identity_value.setText(snapshot.telegram_bot_identity)
        self.telegram_last_test_result_value.setText(self._telegram_test_result_label(snapshot.telegram_last_test_result))
        self.telegram_last_test_at_value.setText(snapshot.telegram_last_test_at)
        self.telegram_loop_status_value.setText(self._telegram_loop_label(snapshot.telegram_loop_state))
        self.telegram_loop_activity_value.setText(self._telegram_loop_activity_label(snapshot.telegram_loop_activity))
        self.telegram_loop_activity_summary_value.setText(self._telegram_loop_activity_label(snapshot.telegram_loop_activity))
        self.last_capability_id_value.setText(snapshot.last_capability_id)
        self.last_capability_state_value.setText(self._capability_state_label(snapshot.last_capability_state))
        self.last_capability_message_value.setText(snapshot.last_capability_message)
        self.last_execution_outcome_value.setText(snapshot.last_execution_outcome)
        self.last_execution_reason_value.setText(snapshot.last_execution_reason_code)
        self.last_execution_summary_value.setText(snapshot.last_execution_summary)
        self.last_execution_trust_value.setText(snapshot.last_execution_trust_summary)
        self.last_execution_scope_value.setText(snapshot.last_execution_scope_summary)
        self.last_execution_duration_value.setText(f"{snapshot.last_execution_duration_ms} ms" if snapshot.last_execution_duration_ms > 0 else "-")
        self.last_execution_finished_value.setText(snapshot.last_execution_finished_at)
        self.last_audit_summary_value.setText(snapshot.last_audit_summary)
        self.last_workflow_type_value.setText(snapshot.last_workflow_type)
        self.last_workflow_state_value.setText(snapshot.last_workflow_state)
        self.last_workflow_step_value.setText(snapshot.last_workflow_step)
        self.last_workflow_summary_value.setText(snapshot.last_workflow_summary)
        self.telegram_loop_message_value.setText(snapshot.telegram_loop_message)
        self.telegram_last_activity_value.setText(snapshot.telegram_last_activity_at)
        self.telegram_last_command_value.setText(snapshot.telegram_last_command)
        self.telegram_last_ask_status_value.setText(snapshot.telegram_last_ask_status)
        self.telegram_last_inbound_value.setText(snapshot.telegram_last_inbound_summary)
        self.telegram_last_outbound_value.setText(snapshot.telegram_last_outbound_summary)
        self.health_status_value.setText(self._health_label(snapshot.health_status))
        self.safety_status_value.setText(self._safety_label(snapshot.safety_status))
        self.last_health_check_value.setText(snapshot.last_health_check_at)
        self.last_security_check_value.setText(snapshot.last_security_check_at)
        self.health_summary_value.setText(snapshot.health_summary)
        self.safety_summary_value.setText(snapshot.safety_summary)
        self.diagnostic_summary_view.setPlainText("\n".join(snapshot.diagnostic_summary_lines))
        self.last_capability_trust_value.setText(snapshot.last_capability_trust_summary)
        if self._refresh_form_on_next_snapshot:
            self._sync_form_with_snapshot(snapshot)
        if self._clear_openai_key_on_next_snapshot:
            self.openai_key_input.clear()
            self._clear_openai_key_on_next_snapshot = False
        if self._clear_telegram_token_on_next_snapshot:
            self.telegram_token_input.clear()
            self._clear_telegram_token_on_next_snapshot = False
        self._set_controls_enabled(True)
        self._refresh_buttons(snapshot)

    def _handle_background_failure(self, details: str) -> None:
        self._set_controls_enabled(True)
        if hasattr(self, "conversation_input"):
            self.conversation_input.setEnabled(True)
        if hasattr(self, "conversation_send_button"):
            self.conversation_send_button.setEnabled(True)
        self.status_message_value.setText("Background action failed. See runtime logs.")
        self.statusBar().showMessage("Background action failed.", 4000)
        current_text = self.logs_view.toPlainText().strip()
        prefix = f"{current_text}\n\n" if current_text else ""
        self.logs_view.setPlainText(f"{prefix}{details}")

    def _refresh_buttons(self, snapshot: ControllerSnapshot) -> None:
        start_enabled = snapshot.runtime_state in {"stopped", "error"}
        stop_enabled = snapshot.runtime_state in {"starting", "running"}
        self.start_button.setEnabled(start_enabled)
        self.stop_button.setEnabled(stop_enabled)
        self.restart_button.setEnabled(snapshot.runtime_state in {"running", "error"})
        self.status_button.setEnabled(True)
        self.validate_provider_button.setEnabled(True)
        self.save_settings_button.setEnabled(True)
        self.save_telegram_button.setEnabled(True)
        self.validate_telegram_button.setEnabled(True)
        self.test_telegram_button.setEnabled(snapshot.telegram_token_present)
        self.start_telegram_loop_button.setEnabled(snapshot.telegram_token_present and snapshot.telegram_loop_state == "stopped")
        self.stop_telegram_loop_button.setEnabled(snapshot.telegram_loop_state in {"starting", "running", "error"})
        self.health_check_button.setEnabled(True)
        self.security_check_button.setEnabled(True)
        self.clear_logs_button.setEnabled(True)
        self.copy_diagnostics_button.setEnabled(True)

    def _set_controls_enabled(self, enabled: bool) -> None:
        if not enabled:
            self.start_button.setEnabled(False)
            self.stop_button.setEnabled(False)
            self.restart_button.setEnabled(False)
            self.status_button.setEnabled(False)
            self.validate_provider_button.setEnabled(False)
            self.save_settings_button.setEnabled(False)
            self.save_telegram_button.setEnabled(False)
            self.validate_telegram_button.setEnabled(False)
            self.test_telegram_button.setEnabled(False)
            self.start_telegram_loop_button.setEnabled(False)
            self.stop_telegram_loop_button.setEnabled(False)
            self.health_check_button.setEnabled(False)
            self.security_check_button.setEnabled(False)
            self.clear_logs_button.setEnabled(False)
            self.copy_diagnostics_button.setEnabled(False)

    def _sync_form_with_snapshot(self, snapshot: ControllerSnapshot) -> None:
        self._set_combo_value(self.mode_selector, snapshot.selected_mode)
        self._set_combo_value(self.provider_selector, snapshot.selected_provider)
        self._set_combo_value(self.policy_selector, snapshot.policy)
        self._replace_model_items(snapshot.available_provider_models, snapshot.provider_model)
        self._refresh_form_on_next_snapshot = False

    def _replace_model_items(self, models: tuple[str, ...], selected: str) -> None:
        current_text = selected or self.ollama_model_input.currentText()
        self.ollama_model_input.blockSignals(True)
        self.ollama_model_input.clear()
        for model in models:
            self.ollama_model_input.addItem(model)
        if current_text:
            index = self.ollama_model_input.findText(current_text)
            if index >= 0:
                self.ollama_model_input.setCurrentIndex(index)
            else:
                self.ollama_model_input.setEditText(current_text)
        self.ollama_model_input.blockSignals(False)

    def _handle_validate_provider(self) -> None:
        provider = self._selected_provider()
        preferred_model = self.ollama_model_input.currentText().strip()
        transient_key = self.openai_key_input.text().strip() if provider == "openai" else ""
        self._refresh_form_on_next_snapshot = True
        self._run_background(
            lambda: self._service.validate_provider(
                provider=provider,
                preferred_ollama_model=preferred_model,
                transient_openai_key=transient_key,
            )
        )

    def _handle_save_settings(self) -> None:
        selected_mode = self._selected_mode()
        selected_provider = self._selected_provider()
        policy = self._selected_policy()
        confirm_online = False
        if (
            selected_mode == "online"
            and policy == "ask_before_online"
            and self.current_mode_value.text().strip().lower() != "online"
        ):
            answer = QtWidgets.QMessageBox.question(
                self,
                "Confirm Online Mode",
                "Online Mode uses a remote provider and may send requests off the machine. Activate Online Mode now?",
                QtWidgets.QMessageBox.StandardButton.Yes | QtWidgets.QMessageBox.StandardButton.No,
                QtWidgets.QMessageBox.StandardButton.No,
            )
            confirm_online = answer == QtWidgets.QMessageBox.StandardButton.Yes

        self._refresh_form_on_next_snapshot = True
        self._clear_openai_key_on_next_snapshot = bool(self.openai_key_input.text().strip())
        self._run_background(
            lambda: self._service.save_settings(
                selected_mode=selected_mode,
                selected_provider=selected_provider,
                policy=policy,
                preferred_ollama_model=self.ollama_model_input.currentText().strip(),
                openai_api_key=self.openai_key_input.text(),
                confirm_online=confirm_online,
            )
        )

    def _handle_save_telegram_settings(self) -> None:
        self._refresh_form_on_next_snapshot = True
        self._clear_telegram_token_on_next_snapshot = bool(self.telegram_token_input.text().strip())
        self._run_background(
            lambda: self._service.save_telegram_settings(
                telegram_token=self.telegram_token_input.text(),
            )
        )

    def _handle_validate_telegram(self) -> None:
        self._refresh_form_on_next_snapshot = True
        self._run_background(
            lambda: self._service.validate_telegram(
                transient_token=self.telegram_token_input.text(),
            )
        )

    def _handle_test_telegram(self) -> None:
        self._refresh_form_on_next_snapshot = True
        self._run_background(self._service.test_telegram_connection)

    def _copy_diagnostic_summary(self) -> None:
        clipboard = QtWidgets.QApplication.clipboard()
        clipboard.setText(self.diagnostic_summary_view.toPlainText())
        self.statusBar().showMessage("Diagnostic summary copied to clipboard.", 3000)

    def _handle_conversation_submit(self) -> None:
        prompt = self.conversation_input.text().strip()
        if not prompt:
            self.conversation_processing_label.setText("Idle - enter a request to begin scoped operational assistance.")
            return

        self.conversation_input.clear()
        self._append_conversation_message("User", prompt)
        self.conversation_processing_label.setText("Routing - AI-E is preparing a governance envelope for the selected runtime agent.")
        self.conversation_input.setEnabled(False)
        self.conversation_send_button.setEnabled(False)
        thread = threading.Thread(target=self._invoke_conversation_route, args=(prompt,), daemon=True)
        thread.start()

    def _invoke_conversation_route(self, prompt: str) -> None:
        try:
            reply = self._service.route_conversation_prompt(prompt)
        except Exception:  # noqa: BLE001
            self._bridge.failure.emit(traceback.format_exc())
            return
        self._bridge.conversation_ready.emit(reply)

    def _apply_conversation_reply(self, reply: object) -> None:
        agent_label = str(getattr(reply, "agent_label", "Runtime Agent"))
        response_text = str(getattr(reply, "response_text", "Runtime agent did not return a response."))
        truth_line = str(getattr(reply, "truth_line", DEFAULT_TRUTH_LINE))
        route_state = str(getattr(reply, "route_state", "runtime_agent_unknown"))
        routed = bool(getattr(reply, "routed", False))

        self._append_conversation_message(agent_label, response_text)
        self._append_conversation_message("Truth", truth_line)
        self.conversation_input.setEnabled(True)
        self.conversation_send_button.setEnabled(True)
        if routed:
            self.conversation_processing_label.setText("Ready - runtime agent response shown inside AI-E truth boundaries.")
            self.statusBar().showMessage(f"Conversation routed: {route_state}.", 3000)
        else:
            self.conversation_processing_label.setText("Ready - no runtime agent was available; no action executed.")
            self.statusBar().showMessage("Conversation was not routed to a runtime agent.", 3000)

    def _append_conversation_message(self, speaker: str, message: str) -> None:
        current_text = self.conversation_view.toPlainText().strip()
        prefix = f"{current_text}\n\n" if current_text else ""
        self.conversation_view.setPlainText(f"{prefix}{speaker}: {message}")
        cursor = self.conversation_view.textCursor()
        cursor.movePosition(QtGui.QTextCursor.MoveOperation.End)
        self.conversation_view.setTextCursor(cursor)

    def _selected_mode(self) -> Mode:
        return self.mode_selector.currentData()  # type: ignore[return-value]

    def _selected_provider(self) -> ProviderType:
        return self.provider_selector.currentData()  # type: ignore[return-value]

    def _selected_policy(self) -> Policy:
        return self.policy_selector.currentData()  # type: ignore[return-value]

    @staticmethod
    def _set_combo_value(combo: QtWidgets.QComboBox, value: str) -> None:
        index = combo.findData(value)
        if index >= 0:
            combo.setCurrentIndex(index)

    @staticmethod
    def _provider_label(provider: ProviderType, model: str) -> str:
        if provider == "ollama" and model:
            return f"Ollama / {model}"
        if provider == "ollama":
            return "Ollama"
        return "OpenAI"

    @staticmethod
    def _health_label(status: str) -> str:
        return {"ok": "Healthy", "degraded": "Degraded", "blocked": "Blocked", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _safety_label(status: str) -> str:
        return {"ok": "Safe", "degraded": "Warning", "blocked": "Unsafe", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _telegram_status_label(status: str) -> str:
        return {"valid": "Validated", "invalid": "Invalid", "partial": "Partial", "unknown": "Unknown"}.get(status, status)

    @staticmethod
    def _telegram_test_result_label(result: str) -> str:
        return {"passed": "Passed", "failed": "Failed", "not_run": "Not Run"}.get(result, result)

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

    @classmethod
    def _telegram_test_label(cls, result: str, timestamp: str) -> str:
        label = cls._telegram_test_result_label(result)
        if timestamp and timestamp != "-":
            return f"{label} ({timestamp})"
        return label

    @staticmethod
    def _readiness_label(state: str) -> str:
        return {"ready": "Ready", "degraded": "Degraded", "not_ready": "Not Ready"}.get(state, state)

    @staticmethod
    def _runtime_plugin_readiness_label(snapshot: ControllerSnapshot) -> str:
        if snapshot.runtime_state == "error":
            state = "Plugin Requires Setup"
        elif snapshot.runtime_state in {"running", "starting"} and snapshot.openclaw_installed:
            state = "OpenClaw Connected" if snapshot.runtime_state == "running" else "OpenClaw Starting"
        elif snapshot.runtime_state == "running":
            state = "Runtime Available"
        elif snapshot.openclaw_installed:
            state = "OpenClaw Available"
        else:
            state = "No Runtime Loaded"

        detail = snapshot.status_message.strip() or "AI-E is ready to inspect available runtime plugins."
        return f"Runtime readiness: {state} - {detail}"

    @staticmethod
    def _format_installation(installed: bool, path: str) -> str:
        if installed and path:
            return path
        if installed:
            return "Detected"
        return "Not detected"

    def closeEvent(self, event: QtGui.QCloseEvent | None) -> None:
        self._poll_timer.stop()
        self._service.shutdown()
        if event is not None:
            event.accept()


def launch_controller_app() -> None:
    app = QtWidgets.QApplication.instance() or QtWidgets.QApplication(sys.argv)
    window = FoundationWindow()
    window.show()
    app.exec()

