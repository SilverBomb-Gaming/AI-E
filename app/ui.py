"""PySide6 UI layer for the AI-E Control Panel."""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List

from PySide6 import QtCore, QtGui, QtWidgets

from . import config, dependencies, home_surface
from .runner import RunSession, update_saved_state


class ControlPanel(QtWidgets.QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("AI-E v1")
        self._configure_window_metrics()
        self.profile_name = config.get_active_profile_name()
        self.state = config.load_state(self.profile_name)
        self.session = RunSession()
        self.intake_preview_bridge = home_surface.IntakePreviewBridge()
        self.supported_projects: List[home_surface.SupportedProject] = []
        self.current_prepared_prompt: home_surface.PreparedPromptPreview | None = None
        self.current_review_surface: home_surface.ReviewSurface | None = None
        self.current_live_status: home_surface.LiveStatusSurface | None = None
        self.current_proof_surface: home_surface.ProofResultSurface | None = None
        self.history_entries: List[home_surface.HistoryEntry] = []
        self._tracked_status_request_id = ""
        self._tracked_status_task_id = ""
        self._tracked_status_session_id = ""
        self._submitted_prompt_key: tuple[str, str] | None = None
        self._profile_selection_busy = False
        self._onboarding_force_visible = False
        self._onboarding_example_prompts = [
            "move zombie forward",
            "add enemy",
            "improve movement",
        ]
        self._build_ui()
        self._build_menu_bar()
        self._duration_timer = QtCore.QTimer(self)
        self._duration_timer.setInterval(1000)
        self._duration_timer.timeout.connect(self._update_duration_label)
        self._duration_timer.start()
        self._live_status_timer = QtCore.QTimer(self)
        self._live_status_timer.setInterval(3000)
        self._live_status_timer.timeout.connect(self._poll_live_status)
        self._live_status_timer.start()
        self._reload_profiles()
        self._reload_supported_projects()
        self._apply_state()
        self._update_session_review_panel()
        self._refresh_recent_runs()
        if self.state.staged_prompt.strip():
            self._render_prepared_prompt(
                self.intake_preview_bridge.prepare_prompt(self.state.staged_prompt, self._selected_project())
            )
        else:
            self._reset_intake_decision()
        self._reset_live_status()
        self._reset_proof_result()
        self._refresh_dependency_label()
        self._update_duration_label()
        self._refresh_buttons()
        self._update_status_panel(self._startup_status_message())

    # -----------------
    # UI construction
    # -----------------
    def _configure_window_metrics(self) -> None:
        self.setMinimumSize(840, 640)
        self.resize(1040, 780)

    def _build_ui(self) -> None:
        scroll_area = QtWidgets.QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setFrameShape(QtWidgets.QFrame.Shape.NoFrame)
        scroll_area.setVerticalScrollBarPolicy(QtCore.Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll_area.setHorizontalScrollBarPolicy(QtCore.Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        self.setCentralWidget(scroll_area)

        content = QtWidgets.QWidget()
        content_layout = QtWidgets.QVBoxLayout(content)
        content_layout.setSpacing(12)
        content_layout.setContentsMargins(12, 12, 12, 12)
        content_layout.addWidget(self._build_home_panel())
        content_layout.addWidget(self._build_header_widget())
        content_layout.addWidget(self._build_profile_panel())
        content_layout.addWidget(self._build_target_panel())
        content_layout.addWidget(self._build_agent_panel())
        content_layout.addWidget(self._build_review_panel())
        content_layout.addStretch(1)

        scroll_area.setWidget(content)

    def _build_header_widget(self) -> QtWidgets.QWidget:
        container = QtWidgets.QWidget()
        layout = QtWidgets.QVBoxLayout(container)
        layout.setSpacing(12)

        header = QtWidgets.QLabel("AI-E Workspace")
        header.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        header.setStyleSheet("font-size: 20px; font-weight: 600;")
        layout.addWidget(header)
        layout.addWidget(self._build_run_panel())
        layout.addWidget(self._build_status_panel())
        return container

    def _build_home_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("AI-E Home")
        layout = QtWidgets.QVBoxLayout(group)
        layout.setSpacing(10)

        title = QtWidgets.QLabel("Turn intent into verifiable results.")
        title.setStyleSheet("font-size: 22px; font-weight: 600;")
        layout.addWidget(title)

        subtitle = QtWidgets.QLabel(
            "Select a supported project, prepare a request, follow AI-E's decision, and open the result."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color: #555;")
        layout.addWidget(subtitle)

        layout.addWidget(self._build_onboarding_panel())

        badge_row = QtWidgets.QHBoxLayout()
        badge_row.setSpacing(8)
        badge_row.addWidget(self._build_guardrail_badge("Supported scope only", "#eff6ff", "#1d4ed8"))
        badge_row.addWidget(self._build_guardrail_badge("External access off", "#f3f4f6", "#374151"))
        badge_row.addWidget(self._build_guardrail_badge("Mutations reviewed", "#fef3c7", "#92400e"))
        badge_row.addStretch(1)
        layout.addLayout(badge_row)

        project_layout = QtWidgets.QGridLayout()
        self.project_combo = QtWidgets.QComboBox()
        self.project_combo.currentTextChanged.connect(self._handle_project_changed)
        self.workspace_value_label = QtWidgets.QLabel("No supported workspace selected.")
        self.workspace_value_label.setWordWrap(True)
        self.workspace_value_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        project_layout.addWidget(QtWidgets.QLabel("Project"), 0, 0)
        project_layout.addWidget(self.project_combo, 0, 1)
        project_layout.addWidget(QtWidgets.QLabel("Active Workspace"), 1, 0)
        project_layout.addWidget(self.workspace_value_label, 1, 1)
        layout.addLayout(project_layout)

        prompt_group = QtWidgets.QGroupBox("Prompt Intake")
        prompt_layout = QtWidgets.QVBoxLayout(prompt_group)
        prompt_hint = QtWidgets.QLabel(
            "Start here after choosing a prompt. Click Prepare Request and AI-E will show whether it is ready, needs approval, should run in sandbox first, or is blocked before anything runs."
        )
        prompt_hint.setWordWrap(True)
        prompt_hint.setStyleSheet("color: #555;")
        prompt_layout.addWidget(prompt_hint)

        self.prompt_input = QtWidgets.QTextEdit()
        self.prompt_input.setPlaceholderText("Describe the bounded result you want AI-E to prepare.")
        self.prompt_input.setFixedHeight(88)
        self.prompt_input.textChanged.connect(self._handle_prompt_changed)
        prompt_layout.addWidget(self.prompt_input)

        self.prepare_prompt_button = QtWidgets.QPushButton("Prepare Request")
        self.prepare_prompt_button.setStyleSheet(
            "background: #1d4ed8; color: white; border: 1px solid #1e40af; "
            "border-radius: 6px; padding: 6px 14px; font-weight: 600;"
        )
        self.prepare_prompt_button.clicked.connect(self._handle_prepare_prompt)
        prompt_layout.addWidget(self.prepare_prompt_button, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        decision_group = QtWidgets.QGroupBox("Intake Decision")
        decision_layout = QtWidgets.QVBoxLayout(decision_group)
        decision_layout.setSpacing(8)

        self.intake_state_badge = QtWidgets.QLabel("Awaiting prompt")
        self.intake_state_badge.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        decision_layout.addWidget(self.intake_state_badge, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        detail_layout = QtWidgets.QFormLayout()
        self.intake_normalized_value = QtWidgets.QLabel("-")
        self.intake_normalized_value.setWordWrap(True)
        self.intake_target_value = QtWidgets.QLabel("-")
        self.intake_target_value.setWordWrap(True)
        self.intake_action_value = QtWidgets.QLabel("-")
        self.intake_action_value.setWordWrap(True)
        self.intake_decision_value = QtWidgets.QLabel("-")
        self.intake_reason_value = QtWidgets.QLabel("Prepare a prompt to see the intake decision.")
        self.intake_reason_value.setWordWrap(True)
        detail_layout.addRow("Normalized Prompt:", self.intake_normalized_value)
        detail_layout.addRow("Target Workspace:", self.intake_target_value)
        detail_layout.addRow("Detected Action:", self.intake_action_value)
        detail_layout.addRow("Decision State:", self.intake_decision_value)
        detail_layout.addRow("Reason:", self.intake_reason_value)
        decision_layout.addLayout(detail_layout)

        self.intake_action_button = QtWidgets.QPushButton("Prepare a prompt")
        self.intake_action_button.clicked.connect(self._handle_intake_next_action)
        self.intake_action_button.setEnabled(False)
        decision_layout.addWidget(self.intake_action_button, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        self.intake_feedback_label = QtWidgets.QLabel("Requests remain staged until you choose a next action.")
        self.intake_feedback_label.setWordWrap(True)
        self.intake_feedback_label.setStyleSheet("color: #555;")
        decision_layout.addWidget(self.intake_feedback_label)
        prompt_layout.addWidget(decision_group)

        review_group = QtWidgets.QGroupBox("Approval Review (when needed)")
        review_layout = QtWidgets.QVBoxLayout(review_group)
        review_layout.setSpacing(8)

        review_hint = QtWidgets.QLabel(
            "Review explains requests that need approval in clear, user-facing terms."
        )
        review_hint.setWordWrap(True)
        review_hint.setStyleSheet("color: #555;")
        review_layout.addWidget(review_hint)

        self.approval_review_status_badge = QtWidgets.QLabel("Review not available")
        self.approval_review_status_badge.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        review_layout.addWidget(self.approval_review_status_badge, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        review_detail_layout = QtWidgets.QFormLayout()
        self.approval_review_summary_value = QtWidgets.QLabel("-")
        self.approval_review_summary_value.setWordWrap(True)
        self.approval_review_prompt_value = QtWidgets.QLabel("-")
        self.approval_review_prompt_value.setWordWrap(True)
        self.approval_review_target_value = QtWidgets.QLabel("-")
        self.approval_review_target_value.setWordWrap(True)
        self.approval_review_action_value = QtWidgets.QLabel("-")
        self.approval_review_action_value.setWordWrap(True)
        self.approval_review_reason_value = QtWidgets.QLabel("Open review for a request that needs approval.")
        self.approval_review_reason_value.setWordWrap(True)
        self.approval_review_scope_value = QtWidgets.QLabel("-")
        self.approval_review_scope_value.setWordWrap(True)
        self.approval_review_validation_value = QtWidgets.QLabel("-")
        self.approval_review_validation_value.setWordWrap(True)
        self.approval_review_risk_value = QtWidgets.QLabel("-")
        self.approval_review_risk_value.setWordWrap(True)
        review_detail_layout.addRow("Request Summary:", self.approval_review_summary_value)
        review_detail_layout.addRow("Normalized Prompt:", self.approval_review_prompt_value)
        review_detail_layout.addRow("Target Workspace:", self.approval_review_target_value)
        review_detail_layout.addRow("Detected Action:", self.approval_review_action_value)
        review_detail_layout.addRow("Why Approval Is Required:", self.approval_review_reason_value)
        review_detail_layout.addRow("Expected Change Scope:", self.approval_review_scope_value)
        review_detail_layout.addRow("Validation Intent:", self.approval_review_validation_value)
        review_detail_layout.addRow("Risk / Guardrails:", self.approval_review_risk_value)
        review_layout.addLayout(review_detail_layout)

        review_action_row = QtWidgets.QHBoxLayout()
        review_action_row.setSpacing(8)
        self.approval_review_approve_button = QtWidgets.QPushButton("Approve once")
        self.approval_review_approve_button.clicked.connect(lambda: self._handle_request_review_action("approve_once"))
        self.approval_review_reject_button = QtWidgets.QPushButton("Reject")
        self.approval_review_reject_button.clicked.connect(lambda: self._handle_request_review_action("reject"))
        self.approval_review_sandbox_button = QtWidgets.QPushButton("Run in sandbox first")
        self.approval_review_sandbox_button.clicked.connect(lambda: self._handle_request_review_action("sandbox_first"))
        review_action_row.addWidget(self.approval_review_approve_button)
        review_action_row.addWidget(self.approval_review_reject_button)
        review_action_row.addWidget(self.approval_review_sandbox_button)
        review_action_row.addStretch(1)
        review_layout.addLayout(review_action_row)

        self.approval_review_feedback_label = QtWidgets.QLabel(
            "Approval actions stay inactive until you open a request that needs approval."
        )
        self.approval_review_feedback_label.setWordWrap(True)
        self.approval_review_feedback_label.setStyleSheet("color: #555;")
        review_layout.addWidget(self.approval_review_feedback_label)
        prompt_layout.addWidget(review_group)

        live_status_group = QtWidgets.QGroupBox("Live Run Status (after submit)")
        live_status_layout = QtWidgets.QVBoxLayout(live_status_group)
        live_status_layout.setSpacing(8)

        live_status_hint = QtWidgets.QLabel(
            "After you submit or approve a request, track its progress here and open the result when it finishes."
        )
        live_status_hint.setWordWrap(True)
        live_status_hint.setStyleSheet("color: #555;")
        live_status_layout.addWidget(live_status_hint)

        self.live_status_badge = QtWidgets.QLabel("Status not available")
        self.live_status_badge.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        live_status_layout.addWidget(self.live_status_badge, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        live_status_detail_layout = QtWidgets.QFormLayout()
        self.live_status_session_value = QtWidgets.QLabel("-")
        self.live_status_phase_value = QtWidgets.QLabel("-")
        self.live_status_current_task_value = QtWidgets.QLabel("-")
        self.live_status_current_task_value.setWordWrap(True)
        self.live_status_queue_value = QtWidgets.QLabel("-")
        self.live_status_heartbeat_value = QtWidgets.QLabel("-")
        self.live_status_heartbeat_value.setWordWrap(True)
        self.live_status_waiting_value = QtWidgets.QLabel("Submit or approve a request to start tracking live status.")
        self.live_status_waiting_value.setWordWrap(True)
        self.live_status_approval_value = QtWidgets.QLabel("-")
        self.live_status_approval_value.setWordWrap(True)
        self.live_status_final_value = QtWidgets.QLabel("-")
        self.live_status_final_value.setWordWrap(True)
        live_status_detail_layout.addRow("Run / Session ID:", self.live_status_session_value)
        live_status_detail_layout.addRow("Current Phase:", self.live_status_phase_value)
        live_status_detail_layout.addRow("Current Task:", self.live_status_current_task_value)
        live_status_detail_layout.addRow("Work Remaining:", self.live_status_queue_value)
        live_status_detail_layout.addRow("Heartbeat / Active:", self.live_status_heartbeat_value)
        live_status_detail_layout.addRow("Waiting / Pause Reason:", self.live_status_waiting_value)
        live_status_detail_layout.addRow("Approval State:", self.live_status_approval_value)
        live_status_detail_layout.addRow("Final State:", self.live_status_final_value)
        live_status_layout.addLayout(live_status_detail_layout)

        live_status_action_row = QtWidgets.QHBoxLayout()
        live_status_action_row.setSpacing(8)
        self.live_status_refresh_button = QtWidgets.QPushButton("Refresh status")
        self.live_status_refresh_button.clicked.connect(self._handle_refresh_live_status)
        self.live_status_open_result_button = QtWidgets.QPushButton("Open result")
        self.live_status_open_result_button.clicked.connect(self._handle_open_live_result)
        live_status_action_row.addWidget(self.live_status_refresh_button)
        live_status_action_row.addWidget(self.live_status_open_result_button)
        live_status_action_row.addStretch(1)
        live_status_layout.addLayout(live_status_action_row)

        self.live_status_feedback_label = QtWidgets.QLabel("No request is being followed yet.")
        self.live_status_feedback_label.setWordWrap(True)
        self.live_status_feedback_label.setStyleSheet("color: #555;")
        live_status_layout.addWidget(self.live_status_feedback_label)
        prompt_layout.addWidget(live_status_group)

        proof_group = QtWidgets.QGroupBox("Result Summary (after completion)")
        proof_layout = QtWidgets.QVBoxLayout(proof_group)
        proof_layout.setSpacing(8)

        proof_hint = QtWidgets.QLabel(
            "Open a finished run to see what AI-E did, what changed, and whether checks passed. Supporting files stay secondary."
        )
        proof_hint.setWordWrap(True)
        proof_hint.setStyleSheet("color: #555;")
        proof_layout.addWidget(proof_hint)

        self.proof_result_badge = QtWidgets.QLabel("Result not available")
        self.proof_result_badge.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        proof_layout.addWidget(self.proof_result_badge, alignment=QtCore.Qt.AlignmentFlag.AlignLeft)

        proof_detail_layout = QtWidgets.QFormLayout()
        self.proof_result_title_value = QtWidgets.QLabel("-")
        self.proof_result_title_value.setWordWrap(True)
        self.proof_result_original_value = QtWidgets.QLabel("-")
        self.proof_result_original_value.setWordWrap(True)
        self.proof_result_normalized_value = QtWidgets.QLabel("-")
        self.proof_result_normalized_value.setWordWrap(True)
        self.proof_result_target_value = QtWidgets.QLabel("-")
        self.proof_result_target_value.setWordWrap(True)
        self.proof_result_action_value = QtWidgets.QLabel("-")
        self.proof_result_action_value.setWordWrap(True)
        self.proof_result_verdict_value = QtWidgets.QLabel("Open a finished run from Live Run Status or History.")
        self.proof_result_verdict_value.setWordWrap(True)
        self.proof_result_change_value = QtWidgets.QLabel("-")
        self.proof_result_change_value.setWordWrap(True)
        self.proof_result_before_after_value = QtWidgets.QLabel("-")
        self.proof_result_before_after_value.setWordWrap(True)
        self.proof_result_validation_value = QtWidgets.QLabel("-")
        self.proof_result_validation_value.setWordWrap(True)
        self.proof_result_status_value = QtWidgets.QLabel("-")
        self.proof_result_status_value.setWordWrap(True)
        self.proof_result_timestamp_value = QtWidgets.QLabel("-")
        self.proof_result_timestamp_value.setWordWrap(True)
        proof_detail_layout.addRow("Run Title:", self.proof_result_title_value)
        proof_detail_layout.addRow("Original Request:", self.proof_result_original_value)
        proof_detail_layout.addRow("Normalized Request:", self.proof_result_normalized_value)
        proof_detail_layout.addRow("Target Workspace:", self.proof_result_target_value)
        proof_detail_layout.addRow("Detected Action:", self.proof_result_action_value)
        proof_detail_layout.addRow("Final Verdict:", self.proof_result_verdict_value)
        proof_detail_layout.addRow("What Changed:", self.proof_result_change_value)
        proof_detail_layout.addRow("Before / After:", self.proof_result_before_after_value)
        proof_detail_layout.addRow("Validation Outcome:", self.proof_result_validation_value)
        proof_detail_layout.addRow("Result Status:", self.proof_result_status_value)
        proof_detail_layout.addRow("Timestamp:", self.proof_result_timestamp_value)
        proof_layout.addLayout(proof_detail_layout)

        proof_steps_label = QtWidgets.QLabel("Key Execution Steps")
        proof_steps_label.setStyleSheet("font-weight: 600;")
        proof_layout.addWidget(proof_steps_label)
        self.proof_result_steps_list = QtWidgets.QListWidget()
        self.proof_result_steps_list.setAlternatingRowColors(True)
        self.proof_result_steps_list.setSelectionMode(QtWidgets.QAbstractItemView.SelectionMode.NoSelection)
        self.proof_result_steps_list.setMaximumHeight(120)
        proof_layout.addWidget(self.proof_result_steps_list)

        proof_validations_label = QtWidgets.QLabel("Validation Checks")
        proof_validations_label.setStyleSheet("font-weight: 600;")
        proof_layout.addWidget(proof_validations_label)
        self.proof_result_validations_list = QtWidgets.QListWidget()
        self.proof_result_validations_list.setAlternatingRowColors(True)
        self.proof_result_validations_list.setSelectionMode(QtWidgets.QAbstractItemView.SelectionMode.NoSelection)
        self.proof_result_validations_list.setMaximumHeight(120)
        proof_layout.addWidget(self.proof_result_validations_list)

        proof_artifacts_label = QtWidgets.QLabel("Supporting Files")
        proof_artifacts_label.setStyleSheet("font-weight: 600;")
        proof_layout.addWidget(proof_artifacts_label)
        self.proof_result_artifacts_tree = QtWidgets.QTreeWidget()
        self.proof_result_artifacts_tree.setColumnCount(2)
        self.proof_result_artifacts_tree.setHeaderLabels(["Artifact", "Type"])
        self.proof_result_artifacts_tree.setRootIsDecorated(False)
        self.proof_result_artifacts_tree.setAlternatingRowColors(True)
        self.proof_result_artifacts_tree.setUniformRowHeights(True)
        self.proof_result_artifacts_tree.header().setStretchLastSection(False)
        self.proof_result_artifacts_tree.header().setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeMode.Stretch)
        self.proof_result_artifacts_tree.header().setSectionResizeMode(1, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        proof_layout.addWidget(self.proof_result_artifacts_tree)

        proof_action_row = QtWidgets.QHBoxLayout()
        proof_action_row.setSpacing(8)
        self.proof_result_back_button = QtWidgets.QPushButton("Back to home")
        self.proof_result_back_button.clicked.connect(self._handle_back_to_home_from_proof)
        self.proof_result_open_artifacts_button = QtWidgets.QPushButton("Open supporting files")
        self.proof_result_open_artifacts_button.clicked.connect(self._handle_open_proof_artifact)
        self.proof_result_rerun_button = QtWidgets.QPushButton("Prepare same request")
        self.proof_result_rerun_button.clicked.connect(self._handle_rerun_same_request)
        proof_action_row.addWidget(self.proof_result_back_button)
        proof_action_row.addWidget(self.proof_result_open_artifacts_button)
        proof_action_row.addWidget(self.proof_result_rerun_button)
        proof_action_row.addStretch(1)
        proof_layout.addLayout(proof_action_row)

        self.proof_result_feedback_label = QtWidgets.QLabel("Open a finished run from Live Run Status or History.")
        self.proof_result_feedback_label.setWordWrap(True)
        self.proof_result_feedback_label.setStyleSheet("color: #555;")
        proof_layout.addWidget(self.proof_result_feedback_label)
        prompt_layout.addWidget(proof_group)
        layout.addWidget(prompt_group)

        history_group = QtWidgets.QGroupBox("Project / Session History")
        history_layout = QtWidgets.QVBoxLayout(history_group)
        history_hint = QtWidgets.QLabel(
            "Browse saved results and sessions. Open a result, review a saved session, or prepare the same request again when it is available."
        )
        history_hint.setWordWrap(True)
        history_hint.setStyleSheet("color: #555;")
        history_layout.addWidget(history_hint)

        history_filter_row = QtWidgets.QHBoxLayout()
        history_filter_row.setSpacing(8)
        self.history_project_filter = QtWidgets.QComboBox()
        self.history_project_filter.currentTextChanged.connect(self._apply_history_filters)
        self.history_status_filter = QtWidgets.QComboBox()
        self.history_status_filter.addItems(["All statuses", "Passed", "Blocked", "Failed", "Saved"])
        self.history_status_filter.currentTextChanged.connect(self._apply_history_filters)
        self.history_search_input = QtWidgets.QLineEdit()
        self.history_search_input.setPlaceholderText("Filter by request, action, or summary")
        self.history_search_input.textChanged.connect(self._apply_history_filters)
        history_filter_row.addWidget(QtWidgets.QLabel("Project"))
        history_filter_row.addWidget(self.history_project_filter)
        history_filter_row.addWidget(QtWidgets.QLabel("Status"))
        history_filter_row.addWidget(self.history_status_filter)
        history_filter_row.addWidget(self.history_search_input, stretch=1)
        history_layout.addLayout(history_filter_row)

        self.recent_runs_tree = QtWidgets.QTreeWidget()
        self.recent_runs_tree.itemDoubleClicked.connect(self._handle_recent_run_open)
        self.recent_runs_tree.itemSelectionChanged.connect(self._handle_history_selection_changed)
        self.recent_runs_tree.setColumnCount(6)
        self.recent_runs_tree.setHeaderLabels(["Name", "Project", "Source", "Status", "Updated", "Summary"])
        self.recent_runs_tree.setRootIsDecorated(False)
        self.recent_runs_tree.setAlternatingRowColors(True)
        self.recent_runs_tree.setUniformRowHeights(True)
        self.recent_runs_tree.header().setStretchLastSection(False)
        self.recent_runs_tree.header().setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(1, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(2, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(3, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(4, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(5, QtWidgets.QHeaderView.ResizeMode.Stretch)
        history_layout.addWidget(self.recent_runs_tree)

        history_action_row = QtWidgets.QHBoxLayout()
        history_action_row.setSpacing(8)
        self.history_open_result_button = QtWidgets.QPushButton("Open result")
        self.history_open_result_button.clicked.connect(self._handle_open_history_result)
        self.history_open_session_button = QtWidgets.QPushButton("Reopen session summary")
        self.history_open_session_button.clicked.connect(self._handle_open_history_session_summary)
        self.history_restage_button = QtWidgets.QPushButton("Prepare same request")
        self.history_restage_button.clicked.connect(self._handle_restage_history_request)
        history_action_row.addWidget(self.history_open_result_button)
        history_action_row.addWidget(self.history_open_session_button)
        history_action_row.addWidget(self.history_restage_button)
        history_action_row.addStretch(1)
        history_layout.addLayout(history_action_row)

        self.history_feedback_label = QtWidgets.QLabel("Select a saved result or session to open it here.")
        self.history_feedback_label.setWordWrap(True)
        self.history_feedback_label.setStyleSheet("color: #555;")
        history_layout.addWidget(self.history_feedback_label)
        layout.addWidget(history_group)

        return group

    def _build_onboarding_panel(self) -> QtWidgets.QFrame:
        group = QtWidgets.QFrame()
        group.setObjectName("onboardingPanel")
        group.setFrameShape(QtWidgets.QFrame.Shape.StyledPanel)
        group.setSizePolicy(
            QtWidgets.QSizePolicy.Policy.Expanding,
            QtWidgets.QSizePolicy.Policy.Maximum,
        )
        group.setStyleSheet(
            "QFrame#onboardingPanel { background: #eff6ff; border: 1px solid #93c5fd; border-radius: 8px; }"
        )
        layout = QtWidgets.QVBoxLayout(group)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        heading = QtWidgets.QLabel("Getting Started: Start Here")
        heading.setStyleSheet("font-size: 16px; font-weight: 600; color: #1e3a8a;")
        layout.addWidget(heading)

        self.onboarding_intro_label = QtWidgets.QLabel(
            "AI-E turns a supported request into a real result you can review."
        )
        self.onboarding_intro_label.setWordWrap(True)
        layout.addWidget(self.onboarding_intro_label)

        self.onboarding_start_label = QtWidgets.QLabel("")
        self.onboarding_start_label.setWordWrap(True)
        self.onboarding_start_label.setStyleSheet("font-weight: 600; color: #1e3a8a;")
        layout.addWidget(self.onboarding_start_label)

        self.onboarding_support_label = QtWidgets.QLabel("Start with a supported project like BABYLON VER 2.")
        self.onboarding_support_label.setWordWrap(True)
        layout.addWidget(self.onboarding_support_label)

        self.onboarding_guardrail_label = QtWidgets.QLabel(
            "Guardrails keep work within supported scope, keep external access off, and require review when needed."
        )
        self.onboarding_guardrail_label.setWordWrap(True)
        layout.addWidget(self.onboarding_guardrail_label)

        prompt_label = QtWidgets.QLabel("Try one of these prompts:")
        prompt_label.setStyleSheet("font-weight: 600;")
        layout.addWidget(prompt_label)

        prompt_row = QtWidgets.QHBoxLayout()
        prompt_row.setSpacing(8)
        self.onboarding_prompt_buttons: List[QtWidgets.QPushButton] = []
        for prompt_text in self._onboarding_example_prompts:
            button = QtWidgets.QPushButton(prompt_text)
            button.clicked.connect(lambda _checked=False, text=prompt_text: self._handle_use_onboarding_example(text))
            self.onboarding_prompt_buttons.append(button)
            prompt_row.addWidget(button)
        prompt_row.addStretch(1)
        layout.addLayout(prompt_row)

        self.onboarding_path_label = QtWidgets.QLabel("")
        self.onboarding_path_label.setWordWrap(True)
        layout.addWidget(self.onboarding_path_label)

        self.onboarding_reopen_hint_label = QtWidgets.QLabel("You can reopen these tips from Help > Getting Started.")
        self.onboarding_reopen_hint_label.setWordWrap(True)
        self.onboarding_reopen_hint_label.setStyleSheet("color: #555;")
        layout.addWidget(self.onboarding_reopen_hint_label)

        action_row = QtWidgets.QHBoxLayout()
        action_row.setSpacing(8)
        self.onboarding_use_first_prompt_button = QtWidgets.QPushButton("Use recommended first request")
        self.onboarding_use_first_prompt_button.setStyleSheet(
            "background: #dbeafe; color: #1d4ed8; border: 1px solid #60a5fa; "
            "border-radius: 6px; padding: 6px 12px; font-weight: 600;"
        )
        self.onboarding_use_first_prompt_button.clicked.connect(
            lambda: self._handle_use_onboarding_example(self._onboarding_example_prompts[0])
        )
        self.onboarding_dismiss_button = QtWidgets.QPushButton("Hide tips")
        self.onboarding_dismiss_button.clicked.connect(self._handle_dismiss_onboarding)
        action_row.addWidget(self.onboarding_use_first_prompt_button)
        action_row.addWidget(self.onboarding_dismiss_button)
        action_row.addStretch(1)
        layout.addLayout(action_row)

        group.setVisible(False)
        self.onboarding_group = group
        return group

    @staticmethod
    def _build_guardrail_badge(text: str, background: str, foreground: str) -> QtWidgets.QLabel:
        badge = QtWidgets.QLabel(text)
        badge.setStyleSheet(
            f"background: {background}; color: {foreground}; border: 1px solid {foreground}; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )
        return badge

    def _build_menu_bar(self) -> None:
        menu_bar = self.menuBar()
        help_menu = menu_bar.addMenu("&Help")
        getting_started_action = QtGui.QAction("Getting Started", self)
        getting_started_action.triggered.connect(self._handle_reopen_onboarding)
        help_menu.addAction(getting_started_action)
        tests_action = QtGui.QAction("Demo Checklist...", self)
        tests_action.triggered.connect(self._show_acceptance_tests)
        help_menu.addAction(tests_action)

    def _build_profile_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Operator Profile")
        layout = QtWidgets.QGridLayout(group)

        self.profile_combo = QtWidgets.QComboBox()
        self.profile_combo.currentTextChanged.connect(self._handle_profile_changed)
        self.profile_status_label = QtWidgets.QLabel("Active profile: loading…")
        self.profile_status_label.setWordWrap(True)

        self.profile_save_button = QtWidgets.QPushButton("Save Profile")
        self.profile_save_button.clicked.connect(self._handle_profile_save)
        self.profile_new_button = QtWidgets.QPushButton("New Profile…")
        self.profile_new_button.clicked.connect(self._handle_profile_create)

        self.profile_hint_label = QtWidgets.QLabel(f"Stored at {config.profile_storage_hint()}")
        self.profile_hint_label.setWordWrap(True)
        self.profile_hint_label.setStyleSheet("color: #666;")

        layout.addWidget(QtWidgets.QLabel("Active"), 0, 0)
        layout.addWidget(self.profile_combo, 0, 1)
        layout.addWidget(self.profile_save_button, 0, 2)
        layout.addWidget(self.profile_new_button, 1, 2)
        layout.addWidget(self.profile_status_label, 1, 0, 1, 2)
        layout.addWidget(self.profile_hint_label, 2, 0, 1, 3)
        return group

    def _build_target_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Target")
        form = QtWidgets.QGridLayout(group)

        self.exe_path_edit = QtWidgets.QLineEdit()
        browse_button = QtWidgets.QPushButton("Browse…")
        browse_button.clicked.connect(self._handle_browse)

        launch_button = QtWidgets.QPushButton("Launch BABYLON")
        launch_button.clicked.connect(self._handle_launch)

        attach_button = QtWidgets.QPushButton("Attach")
        attach_button.clicked.connect(self._handle_attach)

        form.addWidget(QtWidgets.QLabel("BABYLON_EXE_PATH"), 0, 0)
        form.addWidget(self.exe_path_edit, 0, 1)
        form.addWidget(browse_button, 0, 2)
        form.addWidget(launch_button, 1, 1)
        form.addWidget(attach_button, 1, 2)
        return group

    def _build_run_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Run Controls")
        layout = QtWidgets.QGridLayout(group)

        self.map_dropdown = QtWidgets.QComboBox()
        self.map_dropdown.addItems(["001", "002", "003", "004"])

        self.record_input_checkbox = QtWidgets.QCheckBox("Record Input (BABYLON focus only)")
        self.record_input_checkbox.setToolTip("Captures keyboard/mouse events while the BABYLON window is foreground.")
        self.record_mic_checkbox = QtWidgets.QCheckBox("Record Mic")
        self.record_mic_checkbox.toggled.connect(self._handle_mic_toggle)
        self.push_to_talk_checkbox = QtWidgets.QCheckBox("Enable Push-to-Talk (Space)")
        self.push_to_talk_checkbox.setEnabled(False)

        self.start_button = QtWidgets.QPushButton("Start Run")
        self.start_button.clicked.connect(self._handle_start_run)
        self.stop_button = QtWidgets.QPushButton("Stop Run")
        self.stop_button.clicked.connect(self._handle_stop_run)
        self.open_run_button = QtWidgets.QPushButton("Open Run Folder")
        self.open_run_button.clicked.connect(self._handle_open_run_folder)
        self.open_logs_button = QtWidgets.QPushButton("Open Logs Folder")
        self.open_logs_button.clicked.connect(self._handle_open_logs)

        layout.addWidget(QtWidgets.QLabel("Map"), 0, 0)
        layout.addWidget(self.map_dropdown, 0, 1)
        layout.addWidget(self.record_input_checkbox, 1, 0, 1, 2)
        layout.addWidget(self.record_mic_checkbox, 2, 0, 1, 2)
        layout.addWidget(self.push_to_talk_checkbox, 3, 0, 1, 2)
        layout.addWidget(self.start_button, 4, 0)
        layout.addWidget(self.stop_button, 4, 1)
        layout.addWidget(self.open_run_button, 5, 0)
        layout.addWidget(self.open_logs_button, 5, 1)
        return group

    def _build_agent_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Action Layer")
        layout = QtWidgets.QVBoxLayout(group)
        layout.setSpacing(8)

        self.action_status_label = QtWidgets.QLabel("Action layer: loading…")
        self.action_status_label.setWordWrap(True)
        layout.addWidget(self.action_status_label)

        self.action_details_label = QtWidgets.QLabel("AI-E never automates without explicit operator approval.")
        self.action_details_label.setWordWrap(True)
        self.action_details_label.setStyleSheet("color: #666;")
        layout.addWidget(self.action_details_label)

        self.action_request_button = QtWidgets.QPushButton("Request Unlock…")
        self.action_request_button.clicked.connect(self._handle_action_request)
        layout.addWidget(self.action_request_button)
        return group

    def _build_status_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Status")
        layout = QtWidgets.QFormLayout(group)

        self.connection_label = QtWidgets.QLabel("Not connected")
        self.pid_label = QtWidgets.QLabel("—")
        self.last_action_label = QtWidgets.QLabel("Idle")
        self.run_folder_label = QtWidgets.QLabel("None")
        self.run_folder_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        self.duration_label = QtWidgets.QLabel("00:00")
        self.artifacts_label = QtWidgets.QLabel(str(self.session.artifacts_root))
        self.artifacts_label.setTextInteractionFlags(QtCore.Qt.TextSelectableByMouse)
        self.dependency_label = QtWidgets.QLabel("Checking optional setup...")
        self.dependency_label.setWordWrap(True)

        layout.addRow("Connection:", self.connection_label)
        layout.addRow("PID:", self.pid_label)
        layout.addRow("Run Duration:", self.duration_label)
        layout.addRow("Last Action:", self.last_action_label)
        layout.addRow("Run Folder:", self.run_folder_label)
        layout.addRow("Artifacts:", self.artifacts_label)
        layout.addRow("Optional Setup:", self.dependency_label)
        return group

    def _build_review_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Session Review")
        layout = QtWidgets.QFormLayout(group)

        self.review_status_label = QtWidgets.QLabel("No completed runs yet.")
        self.review_status_label.setWordWrap(True)
        self.review_duration_value = QtWidgets.QLabel("—")
        self.review_map_value = QtWidgets.QLabel("—")
        self.review_input_value = QtWidgets.QLabel("—")
        self.review_screenshot_value = QtWidgets.QLabel("—")
        self.review_screenshot_value.setWordWrap(True)
        self.review_warnings_label = QtWidgets.QLabel("Warnings will appear here after runs finish.")
        self.review_warnings_label.setWordWrap(True)

        self.review_clear_button = QtWidgets.QPushButton("Clear Review")
        self.review_clear_button.clicked.connect(self._handle_clear_review)
        self.review_clear_button.setEnabled(False)

        layout.addRow("Status:", self.review_status_label)
        layout.addRow("Duration:", self.review_duration_value)
        layout.addRow("Map:", self.review_map_value)
        layout.addRow("Input Detected:", self.review_input_value)
        layout.addRow("Screenshots:", self.review_screenshot_value)
        layout.addRow("Warnings:", self.review_warnings_label)
        layout.addRow("", self.review_clear_button)
        return group

    # -----------------
    # State helpers
    # -----------------
    def _apply_state(self) -> None:
        self.exe_path_edit.setText(self.state.babylon_exe_path)
        index = self.map_dropdown.findText(self.state.last_selected_map)
        if index >= 0:
            self.map_dropdown.setCurrentIndex(index)
        self.record_input_checkbox.setChecked(self.state.record_input)
        self.record_mic_checkbox.setChecked(self.state.record_mic)
        self.push_to_talk_checkbox.setChecked(self.state.push_to_talk)
        self.push_to_talk_checkbox.setEnabled(self.state.record_mic)
        self.prompt_input.blockSignals(True)
        self.prompt_input.setPlainText(self.state.staged_prompt)
        self.prompt_input.blockSignals(False)
        self._select_active_project()
        self._update_active_workspace_label()
        self._refresh_onboarding_panel()

    def _persist_state(self) -> None:
        self.state.babylon_exe_path = self.exe_path_edit.text().strip()
        self.state.last_selected_map = self.map_dropdown.currentText()
        self.state.record_input = self.record_input_checkbox.isChecked()
        self.state.record_mic = self.record_mic_checkbox.isChecked()
        self.state.push_to_talk = self.push_to_talk_checkbox.isChecked()
        project = self._selected_project()
        self.state.active_project_name = project.name if project else ""
        self.state.active_project_path = str(project.path) if project else ""
        self.state.staged_prompt = self.prompt_input.toPlainText().strip()
        update_saved_state(self.state, profile_name=self.profile_name)

    def _reload_profiles(self) -> None:
        names = config.list_profiles()
        if self.profile_name and self.profile_name not in names:
            names.append(self.profile_name)
        names = sorted(set(names))
        self.profile_combo.blockSignals(True)
        self.profile_combo.clear()
        for name in names:
            self.profile_combo.addItem(name)
        index = self.profile_combo.findText(self.profile_name)
        if index >= 0:
            self.profile_combo.setCurrentIndex(index)
        self.profile_combo.blockSignals(False)
        self._update_profile_status_label()

    def _update_profile_status_label(self) -> None:
        self.profile_status_label.setText(f"Active profile: {self.profile_name}")

    def _reload_supported_projects(self) -> None:
        self.supported_projects = home_surface.load_supported_projects()
        self.project_combo.blockSignals(True)
        self.project_combo.clear()
        for project in self.supported_projects:
            self.project_combo.addItem(project.name)
        self.project_combo.blockSignals(False)
        self._select_active_project()
        self._update_active_workspace_label()
        self._refresh_onboarding_panel()

    def _select_active_project(self) -> None:
        if not self.supported_projects:
            return
        desired_path = self.state.active_project_path.strip().lower()
        desired_name = self.state.active_project_name.strip().lower()
        selected_index = self._recommended_project_index()
        for index, project in enumerate(self.supported_projects):
            project_path = str(project.path).lower()
            if desired_path and project_path == desired_path:
                selected_index = index
                break
            if desired_name and project.name.lower() == desired_name:
                selected_index = index
        self.project_combo.blockSignals(True)
        self.project_combo.setCurrentIndex(selected_index)
        self.project_combo.blockSignals(False)

    def _selected_project(self) -> home_surface.SupportedProject | None:
        index = self.project_combo.currentIndex()
        if index < 0 or index >= len(self.supported_projects):
            return None
        return self.supported_projects[index]

    def _recommended_supported_project_name(self) -> str:
        for project in self.supported_projects:
            if project.name.strip().lower() == "babylon ver 2":
                return project.name
        if self.supported_projects:
            return self.supported_projects[0].name
        return "BABYLON VER 2"

    def _recommended_project_index(self) -> int:
        desired_name = self._recommended_supported_project_name().strip().lower()
        for index, project in enumerate(self.supported_projects):
            if project.name.strip().lower() == desired_name:
                return index
        return 0

    def _supported_project_guidance(self) -> str:
        if self.supported_projects:
            return f"Select a supported project like {self._recommended_supported_project_name()} to start your first result."
        return "No supported projects are available yet. Add one, then return here to continue."

    def _recommended_first_prompt(self) -> str:
        return self._onboarding_example_prompts[0]

    def _is_clean_profile_launch(self) -> bool:
        return (
            not self.state.onboarding_dismissed
            and not self.state.babylon_exe_path.strip()
            and not self.state.active_project_name.strip()
            and not self.state.active_project_path.strip()
            and not self.state.staged_prompt.strip()
        )

    def _should_show_onboarding(self) -> bool:
        if self._onboarding_force_visible:
            return True
        if self.state.onboarding_dismissed:
            return False
        return self._is_clean_profile_launch() or not self.history_entries

    def _refresh_onboarding_panel(self) -> None:
        if not hasattr(self, "onboarding_group"):
            return
        project_name = self._recommended_supported_project_name()
        self.onboarding_start_label.setText(
            f"Start here: choose \"{self._recommended_first_prompt()}\", then click Prepare Request."
        )
        self.onboarding_support_label.setText(f"Start with a supported project like {project_name}.")
        self.onboarding_path_label.setText(
            "\n".join(
                [
                    f"Recommended first result: choose {project_name}, then use \"{self._recommended_first_prompt()}\".",
                    "1. Select a supported project.",
                    "2. Prepare the request.",
                    "3. Submit it when Ready, or open review if approval is needed.",
                    "4. Open the result summary to confirm what changed.",
                ]
            )
        )
        visible = self._should_show_onboarding()
        self.onboarding_group.setVisible(visible)
        if visible and not self.prompt_input.toPlainText().strip():
            QtCore.QTimer.singleShot(0, self.onboarding_use_first_prompt_button.setFocus)

    def _startup_status_message(self) -> str:
        if not self.supported_projects:
            return "No supported projects are available yet. Add a supported project, then relaunch AI-E."
        project_name = self._selected_project().name if self._selected_project() else self._recommended_supported_project_name()
        preview = self.current_prepared_prompt
        if preview and preview.normalized_prompt:
            if preview.decision_state == "Ready":
                return f"Prepared request is ready in {project_name}. Submit it to continue."
            if preview.decision_state == "Needs approval":
                return f"Prepared request needs review in {project_name}. Open review to continue safely."
            if preview.decision_state == "Sandbox first":
                return "Prepared request should run in sandbox first. Keep it staged or revise it to stay within supported scope."
            if preview.decision_state == "Blocked":
                return "Prepared request is blocked. Revise it to stay within supported scope, then prepare it again."
        if not self.history_entries:
            return f"Start with {project_name} and try \"{self._recommended_first_prompt()}\"."
        return f"Ready in {project_name}. Prepare a request or reopen a saved result."

    def _select_recommended_project(self) -> None:
        if not self.supported_projects:
            return
        desired_name = self._recommended_supported_project_name()
        index = self.project_combo.findText(desired_name)
        if index < 0:
            index = 0
        if self.project_combo.currentIndex() != index:
            self.project_combo.setCurrentIndex(index)

    def _handle_use_onboarding_example(self, prompt_text: str) -> None:
        if self.supported_projects and self._selected_project() is None:
            self._select_recommended_project()
        self.prompt_input.setPlainText(prompt_text)
        self.prompt_input.setFocus()
        cursor = self.prompt_input.textCursor()
        cursor.movePosition(QtGui.QTextCursor.MoveOperation.End)
        self.prompt_input.setTextCursor(cursor)
        message = "Example request added. Choose Prepare Request, then follow the decision AI-E shows."
        self.intake_feedback_label.setText(message)
        self._update_status_panel(message)

    def _handle_dismiss_onboarding(self) -> None:
        self.state.onboarding_dismissed = True
        self._onboarding_force_visible = False
        self._persist_state()
        self._refresh_onboarding_panel()
        self._update_status_panel("Getting Started hidden. Reopen it from Help when you need it.")

    def _handle_reopen_onboarding(self) -> None:
        self._onboarding_force_visible = True
        self._refresh_onboarding_panel()
        self._update_status_panel("Getting Started opened")

    def _update_active_workspace_label(self) -> None:
        project = self._selected_project()
        if project is None:
            self.workspace_value_label.setText(self._supported_project_guidance())
            return
        self.workspace_value_label.setText(f"{project.name} ({project.project_type})")

    def _refresh_recent_runs(self) -> None:
        self.history_entries = home_surface.load_history_entries(supported_projects=self.supported_projects)
        self._refresh_history_filter_options()
        self._apply_history_filters()
        self._refresh_onboarding_panel()

    def _refresh_history_filter_options(self) -> None:
        current_project = self.history_project_filter.currentText() if hasattr(self, "history_project_filter") else ""
        projects = ["All projects"]
        projects.extend(
            sorted(
                {
                    entry.project_display
                    for entry in self.history_entries
                    if str(entry.project_display or "").strip()
                }
            )
        )
        self.history_project_filter.blockSignals(True)
        self.history_project_filter.clear()
        self.history_project_filter.addItems(projects)
        if current_project and current_project in projects:
            self.history_project_filter.setCurrentText(current_project)
        self.history_project_filter.blockSignals(False)

    def _apply_history_filters(self) -> None:
        self.recent_runs_tree.clear()
        project_filter = self.history_project_filter.currentText().strip() if hasattr(self, "history_project_filter") else ""
        status_filter = self.history_status_filter.currentText().strip() if hasattr(self, "history_status_filter") else ""
        search_text = self.history_search_input.text().strip().lower() if hasattr(self, "history_search_input") else ""

        filtered = []
        for entry in self.history_entries:
            if project_filter and project_filter != "All projects" and entry.project_display != project_filter:
                continue
            if status_filter and status_filter != "All statuses" and entry.final_status != status_filter:
                continue
            if search_text:
                haystack = " ".join(
                    [
                        entry.title,
                        entry.summary,
                        entry.source,
                        entry.project_display,
                    ]
                ).lower()
                if search_text not in haystack:
                    continue
            filtered.append(entry)

        if not filtered:
            empty_title = "No saved history yet" if not self.history_entries else "No matching history entries"
            item = QtWidgets.QTreeWidgetItem([empty_title, "-", "-", "-", "-", "-"])
            self.recent_runs_tree.addTopLevelItem(item)
            if not self.history_entries:
                project = self._selected_project()
                if project is not None:
                    self.history_feedback_label.setText(
                        f"No saved runs or sessions yet. Prepare a request in {project.name} to create your first result."
                    )
                else:
                    self.history_feedback_label.setText(self._supported_project_guidance())
            else:
                self.history_feedback_label.setText(
                    "No saved runs or sessions match these filters. Clear the filters or choose another project."
                )
            self._handle_history_selection_changed()
            return

        for entry in filtered:
            item = QtWidgets.QTreeWidgetItem(
                [
                    entry.title,
                    entry.project_display,
                    entry.source,
                    entry.final_status,
                    entry.updated_label,
                    entry.summary,
                ]
            )
            payload = {
                "path": str(entry.path),
                "session_summary_path": str(entry.session_summary_path) if entry.session_summary_path else "",
                "rerun_prompt": entry.rerun_prompt,
                "rerun_project_path": entry.rerun_project_path,
                "summary": entry.summary,
            }
            for column in range(6):
                item.setToolTip(column, entry.summary or entry.title)
            item.setData(0, QtCore.Qt.ItemDataRole.UserRole, payload)
            self.recent_runs_tree.addTopLevelItem(item)

        if self.recent_runs_tree.topLevelItemCount() > 0:
            self.recent_runs_tree.setCurrentItem(self.recent_runs_tree.topLevelItem(0))
        self.history_feedback_label.setText(
            f"Showing {len(filtered)} saved entr{'y' if len(filtered) == 1 else 'ies'}."
        )
        self._handle_history_selection_changed()

    def _selected_history_payload(self) -> Dict[str, str]:
        item = self.recent_runs_tree.currentItem()
        if item is None:
            return {}
        payload = item.data(0, QtCore.Qt.ItemDataRole.UserRole)
        return dict(payload) if isinstance(payload, dict) else {}

    def _handle_history_selection_changed(self) -> None:
        payload = self._selected_history_payload()
        has_path = bool(str(payload.get("path") or "").strip())
        has_session_summary = bool(str(payload.get("session_summary_path") or "").strip())
        has_rerun = bool(str(payload.get("rerun_prompt") or "").strip())
        self.history_open_result_button.setEnabled(has_path)
        self.history_open_session_button.setEnabled(has_session_summary)
        self.history_restage_button.setEnabled(has_rerun)
        if not payload:
            if self.recent_runs_tree.topLevelItemCount():
                if self.history_entries:
                    self.history_feedback_label.setText(
                        "Select a saved result to open it, or prepare the same request again when it is available."
                    )
            return
        summary = str(payload.get("summary") or "").strip()
        if summary:
            self.history_feedback_label.setText(summary)

    def _render_prepared_prompt(self, preview: home_surface.PreparedPromptPreview) -> None:
        self.current_prepared_prompt = preview
        self.intake_normalized_value.setText(preview.normalized_prompt or "-")
        self.intake_target_value.setText(preview.target_display or "-")
        self.intake_action_value.setText(preview.detected_action or "-")
        self.intake_decision_value.setText(preview.decision_state or "-")
        self.intake_reason_value.setText(preview.decision_reason or preview.status_message)
        self.intake_action_button.setText(preview.next_action_label)
        self.intake_action_button.setEnabled(bool(preview.normalized_prompt))
        self.intake_feedback_label.setText(preview.status_message)
        self._apply_decision_state_style(preview.decision_state)

        submitted_key = (preview.normalized_prompt, preview.target_repo)
        if self._submitted_prompt_key == submitted_key and preview.decision_state == "Ready":
            self.intake_action_button.setEnabled(False)

        if preview.decision_state == "Needs approval":
            review = self.intake_preview_bridge.build_review_surface(preview, self._selected_project())
            self._render_request_review(review)
        else:
            self._reset_request_review()

    def _reset_intake_decision(self, message: str = "Type a request, then choose Prepare Request to see whether AI-E is ready, needs approval, or is blocked.") -> None:
        self.current_prepared_prompt = None
        self.intake_state_badge.setText("Awaiting prompt")
        self.intake_state_badge.setStyleSheet(
            "background: #f3f4f6; color: #374151; border: 1px solid #9ca3af; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )
        self.intake_normalized_value.setText("-")
        self.intake_target_value.setText(self._selected_project().name if self._selected_project() else "-")
        self.intake_action_value.setText("-")
        self.intake_decision_value.setText("-")
        self.intake_reason_value.setText(message)
        self.intake_action_button.setText("Prepare a prompt")
        self.intake_action_button.setEnabled(False)
        if self._selected_project() is None:
            self.intake_feedback_label.setText(self._supported_project_guidance())
        else:
            self.intake_feedback_label.setText("Requests stay prepared until you choose the next step.")
        self._reset_request_review()

    def _apply_decision_state_style(self, decision_state: str) -> None:
        styles = {
            "Ready": ("#dcfce7", "#166534"),
            "Needs approval": ("#fef3c7", "#92400e"),
            "Sandbox first": ("#dbeafe", "#1d4ed8"),
            "Blocked": ("#fee2e2", "#b91c1c"),
        }
        background, foreground = styles.get(decision_state, ("#f3f4f6", "#374151"))
        self.intake_state_badge.setText(decision_state or "Awaiting prompt")
        self.intake_state_badge.setStyleSheet(
            f"background: {background}; color: {foreground}; border: 1px solid {foreground}; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )

    def _render_request_review(self, review: home_surface.ReviewSurface) -> None:
        self.current_review_surface = review
        self.approval_review_summary_value.setText(review.request_summary or "-")
        self.approval_review_prompt_value.setText(review.normalized_prompt or "-")
        self.approval_review_target_value.setText(review.target_display or "-")
        self.approval_review_action_value.setText(review.detected_action or "-")
        self.approval_review_reason_value.setText(review.approval_reason or "-")
        self.approval_review_scope_value.setText(review.expected_change_scope or "-")
        self.approval_review_validation_value.setText(review.validation_intent or "-")
        self.approval_review_risk_value.setText(review.risk_guardrail_status or "-")
        self.approval_review_feedback_label.setText(review.status_message)
        self._apply_request_review_style(review)
        self.approval_review_approve_button.setEnabled(review.approve_enabled and not self.session.is_running)
        self.approval_review_reject_button.setEnabled(review.reject_enabled and not self.session.is_running)
        self.approval_review_sandbox_button.setEnabled(review.sandbox_enabled and not self.session.is_running)

    def _reset_request_review(self, message: str = "Prepare a request that needs approval to open review.") -> None:
        self.current_review_surface = None
        self.approval_review_summary_value.setText("-")
        self.approval_review_prompt_value.setText("-")
        self.approval_review_target_value.setText(self._selected_project().name if self._selected_project() else "-")
        self.approval_review_action_value.setText("-")
        self.approval_review_reason_value.setText(message)
        self.approval_review_scope_value.setText("-")
        self.approval_review_validation_value.setText("-")
        self.approval_review_risk_value.setText("Review opens only for requests that need approval.")
        if self._selected_project() is None:
            self.approval_review_feedback_label.setText(self._supported_project_guidance())
        else:
            self.approval_review_feedback_label.setText(
                "Approval actions stay inactive until you open a request that needs approval."
            )
        self._set_request_review_badge("Review not available", "#f3f4f6", "#374151")
        self.approval_review_approve_button.setEnabled(False)
        self.approval_review_reject_button.setEnabled(False)
        self.approval_review_sandbox_button.setEnabled(False)

    def _apply_request_review_style(self, review: home_surface.ReviewSurface) -> None:
        if not review.available:
            self._set_request_review_badge("Review not available", "#f3f4f6", "#374151")
            return
        if review.queue_status == "pending" and not review.action_required:
            self._set_request_review_badge("Approved once", "#dcfce7", "#166534")
            return
        if review.queue_status == "blocked":
            self._set_request_review_badge("Blocked", "#fee2e2", "#b91c1c")
            return
        if review.queue_status == "needs_approval":
            self._set_request_review_badge("Awaiting approval", "#fef3c7", "#92400e")
            return
        self._set_request_review_badge("Ready for review", "#fef3c7", "#92400e")

    def _set_request_review_badge(self, text: str, background: str, foreground: str) -> None:
        self.approval_review_status_badge.setText(text)
        self.approval_review_status_badge.setStyleSheet(
            f"background: {background}; color: {foreground}; border: 1px solid {foreground}; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )

    def _set_live_status_target(
        self,
        *,
        request_id: str = "",
        task_id: str = "",
        session_id: str = "",
    ) -> None:
        if request_id:
            self._tracked_status_request_id = request_id
        if task_id:
            self._tracked_status_task_id = task_id
        if session_id:
            self._tracked_status_session_id = session_id

    def _refresh_live_status(self) -> None:
        status = self.intake_preview_bridge.load_live_status(
            request_id=self._tracked_status_request_id,
            task_id=self._tracked_status_task_id,
            session_id=self._tracked_status_session_id,
        )
        self._render_live_status(status)

    def _poll_live_status(self) -> None:
        if not any([self._tracked_status_request_id, self._tracked_status_task_id, self._tracked_status_session_id]):
            return
        self._refresh_live_status()

    def _render_live_status(self, status: home_surface.LiveStatusSurface) -> None:
        self.current_live_status = status
        self.live_status_session_value.setText(status.session_id or "-")
        self.live_status_phase_value.setText(status.current_phase or "-")
        self.live_status_current_task_value.setText(status.current_task or "-")
        self.live_status_queue_value.setText(status.queue_remaining or "-")
        self.live_status_heartbeat_value.setText(status.heartbeat_status or "-")
        self.live_status_waiting_value.setText(status.waiting_reason or "-")
        self.live_status_approval_value.setText(status.approval_status or "-")
        self.live_status_final_value.setText(status.final_state or "-")
        self.live_status_feedback_label.setText(f"{status.status_message} {status.poll_mode}".strip())
        self._apply_live_status_style(status)
        self.live_status_open_result_button.setEnabled(bool(status.result_ready and status.result_path))
        if status.request_id:
            self._tracked_status_request_id = status.request_id
        if status.task_id:
            self._tracked_status_task_id = status.task_id
        if status.available and status.session_id not in {"", "-", "Not started yet"}:
            self._tracked_status_session_id = status.session_id

    def _reset_live_status(self, message: str = "Submit or approve a request to track it here. You can also open History to review earlier results.") -> None:
        self.current_live_status = None
        self.live_status_session_value.setText("-")
        self.live_status_phase_value.setText("-")
        self.live_status_current_task_value.setText("-")
        self.live_status_queue_value.setText("-")
        self.live_status_heartbeat_value.setText("-")
        self.live_status_waiting_value.setText(message)
        self.live_status_approval_value.setText("-")
        self.live_status_final_value.setText("-")
        self.live_status_feedback_label.setText(
            "No request is being followed yet. Submit or approve a request, or open History to review earlier results."
        )
        self.live_status_open_result_button.setEnabled(False)
        self._set_live_status_badge("Status not available", "#f3f4f6", "#374151")

    def _apply_live_status_style(self, status: home_surface.LiveStatusSurface) -> None:
        if not status.available:
            self._set_live_status_badge("Status not available", "#f3f4f6", "#374151")
            return
        badge_map = {
            "Running": ("#dcfce7", "#166534"),
            "Waiting": ("#dbeafe", "#1d4ed8"),
            "Waiting to run": ("#e0f2fe", "#0369a1"),
            "Awaiting approval": ("#fef3c7", "#92400e"),
            "Completed": ("#dcfce7", "#166534"),
            "Blocked": ("#fee2e2", "#b91c1c"),
            "Failed": ("#fee2e2", "#b91c1c"),
            "Status available": ("#f3f4f6", "#374151"),
        }
        background, foreground = badge_map.get(status.status_badge, ("#f3f4f6", "#374151"))
        self._set_live_status_badge(status.status_badge, background, foreground)

    def _set_live_status_badge(self, text: str, background: str, foreground: str) -> None:
        self.live_status_badge.setText(text)
        self.live_status_badge.setStyleSheet(
            f"background: {background}; color: {foreground}; border: 1px solid {foreground}; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )

    def _open_proof_result_from_path(self, path: Path | str) -> None:
        proof = home_surface.load_proof_result_surface(path, supported_projects=self.supported_projects)
        self._render_proof_result(proof)

    def _render_proof_result(self, proof: home_surface.ProofResultSurface) -> None:
        self.current_proof_surface = proof
        self.proof_result_title_value.setText(proof.title or "-")
        self.proof_result_original_value.setText(proof.original_request or "-")
        self.proof_result_normalized_value.setText(proof.normalized_request or "-")
        self.proof_result_target_value.setText(proof.target_display or "-")
        self.proof_result_action_value.setText(proof.detected_action or "-")
        self.proof_result_verdict_value.setText(proof.final_verdict or "-")
        self.proof_result_change_value.setText(proof.change_summary or "-")
        self.proof_result_before_after_value.setText(proof.before_after_summary or "-")
        self.proof_result_validation_value.setText(proof.validation_outcome or "-")
        self.proof_result_status_value.setText(proof.proof_status or "-")
        self.proof_result_timestamp_value.setText(proof.timestamp_label or "-")
        self.proof_result_steps_list.clear()
        for step in proof.key_steps or ["No step summary is shown for this result."]:
            self.proof_result_steps_list.addItem(step)
        self.proof_result_validations_list.clear()
        for item in proof.validation_checks or ["No validation details are shown for this result."]:
            self.proof_result_validations_list.addItem(item)
        self.proof_result_artifacts_tree.clear()
        for artifact in proof.raw_artifacts:
            item = QtWidgets.QTreeWidgetItem([artifact.label, artifact.kind])
            item.setData(0, QtCore.Qt.ItemDataRole.UserRole, str(artifact.path))
            self.proof_result_artifacts_tree.addTopLevelItem(item)
        self.proof_result_feedback_label.setText(proof.status_message)
        self._apply_proof_result_style(proof)
        self.proof_result_open_artifacts_button.setEnabled(bool(proof.raw_artifacts or proof.primary_artifact_path))
        self.proof_result_rerun_button.setEnabled(bool(proof.rerun_prompt.strip()))
        self.proof_result_back_button.setEnabled(True)

    def _reset_proof_result(self, message: str = "No result is open yet. Open a finished run from Live Run Status or History, or prepare a new request.") -> None:
        self.current_proof_surface = None
        self.proof_result_title_value.setText("-")
        self.proof_result_original_value.setText("-")
        self.proof_result_normalized_value.setText("-")
        self.proof_result_target_value.setText("-")
        self.proof_result_action_value.setText("-")
        self.proof_result_verdict_value.setText(message)
        self.proof_result_change_value.setText("-")
        self.proof_result_before_after_value.setText("-")
        self.proof_result_validation_value.setText("-")
        self.proof_result_status_value.setText("-")
        self.proof_result_timestamp_value.setText("-")
        self.proof_result_steps_list.clear()
        self.proof_result_steps_list.addItem("Open a finished run to see its result summary, or prepare a new request.")
        self.proof_result_validations_list.clear()
        self.proof_result_validations_list.addItem("Validation details appear here after you open a finished run.")
        self.proof_result_artifacts_tree.clear()
        self.proof_result_feedback_label.setText(message)
        self._set_proof_result_badge("Result not available", "#f3f4f6", "#374151")
        self.proof_result_open_artifacts_button.setEnabled(False)
        self.proof_result_rerun_button.setEnabled(False)
        self.proof_result_back_button.setEnabled(False)

    def _apply_proof_result_style(self, proof: home_surface.ProofResultSurface) -> None:
        if not proof.available:
            self._set_proof_result_badge("Result not available", "#f3f4f6", "#374151")
            return
        badge_map = {
            "Passed": ("#dcfce7", "#166534"),
            "Completed": ("#dcfce7", "#166534"),
            "Blocked": ("#fee2e2", "#b91c1c"),
            "Failed": ("#fee2e2", "#b91c1c"),
            "Saved": ("#dbeafe", "#1d4ed8"),
        }
        background, foreground = badge_map.get(proof.proof_status, ("#dbeafe", "#1d4ed8"))
        self._set_proof_result_badge(proof.proof_status or "Saved", background, foreground)

    def _set_proof_result_badge(self, text: str, background: str, foreground: str) -> None:
        self.proof_result_badge.setText(text)
        self.proof_result_badge.setStyleSheet(
            f"background: {background}; color: {foreground}; border: 1px solid {foreground}; "
            "border-radius: 12px; padding: 4px 10px; font-weight: 600;"
        )

    def _refresh_dependency_label(self) -> None:
        summary = dependencies.dependency_summary_text()
        warnings = dependencies.dependency_warnings()
        if warnings:
            self.dependency_label.setStyleSheet("color: #92400e;")
            self.dependency_label.setText(f"Optional setup for capture features:\n{summary}")
        else:
            self.dependency_label.setStyleSheet("color: #2f8f2f;")
            self.dependency_label.setText("Optional capture setup is complete.")

    def _update_session_review_panel(self) -> None:
        if self.session.is_running:
            self.review_status_label.setText("Run in progress…")
            self.review_duration_value.setText(self._format_duration(self.session.current_duration_seconds))
            self.review_map_value.setText(self.map_dropdown.currentText())
            input_status = "Recording" if self.record_input_checkbox.isChecked() else "Disabled"
            self.review_input_value.setText(f"{input_status} (pending)")
            self.review_screenshot_value.setText("Capturing…")
            self.review_warnings_label.setStyleSheet("color: #666;")
            self.review_warnings_label.setText("Session review will finalize when the run stops.")
            self.review_clear_button.setEnabled(False)
            return

        review = self.session.last_review
        if not review:
            self.review_status_label.setText("No completed runs yet.")
            self.review_duration_value.setText("—")
            self.review_map_value.setText("—")
            self.review_input_value.setText("—")
            self.review_screenshot_value.setText("—")
            self.review_warnings_label.setStyleSheet("color: #666;")
            self.review_warnings_label.setText("Warnings will appear here after runs finish.")
            self.review_clear_button.setEnabled(False)
            return

        self.review_status_label.setText(f"Completed at {review.get('timestamp', '—')} (Run: {review.get('run_dir', '—')})")
        self.review_duration_value.setText(self._format_duration(review.get("duration_seconds", 0)))
        self.review_map_value.setText(review.get("map_id", "—"))
        input_events = review.get("input_events", 0)
        input_detected = review.get("input_detected", False)
        input_text = "Yes" if input_detected else "No"
        self.review_input_value.setText(f"{input_text} ({input_events} events)")
        self.review_screenshot_value.setText(self._format_screenshot_summary(review.get("screenshots", [])))
        warnings = review.get("warnings") or []
        if warnings:
            self.review_warnings_label.setStyleSheet("color: #a94442;")
            self.review_warnings_label.setText("\n".join(warnings))
        else:
            self.review_warnings_label.setStyleSheet("color: #2f8f2f;")
            self.review_warnings_label.setText("No warnings reported.")
        self.review_clear_button.setEnabled(True)

    @staticmethod
    def _format_screenshot_summary(descriptors: List[Dict[str, Any]]) -> str:
        if not descriptors:
            return "No screenshots captured."
        captured = sum(1 for item in descriptors if item.get("status") == "captured")
        total = len(descriptors)
        if captured:
            return f"{captured}/{total} captured"
        reasons = sorted({str(item.get("reason", "unavailable")) for item in descriptors if item.get("reason")})
        if reasons:
            return f"No screenshots ({'; '.join(reasons)})"
        return "No screenshots captured."

    # -----------------
    # Event handlers
    # -----------------
    def _handle_profile_changed(self, name: str) -> None:
        if not name or name == self.profile_name:
            return
        if self._profile_selection_busy:
            return
        self._profile_selection_busy = True
        try:
            self.profile_name = name
            config.set_active_profile(name)
            self.state = config.load_state(name)
            self._onboarding_force_visible = False
            self._apply_state()
            if self.state.staged_prompt.strip():
                self._render_prepared_prompt(
                    self.intake_preview_bridge.prepare_prompt(self.state.staged_prompt, self._selected_project())
                )
            else:
                self._reset_intake_decision()
            self._reload_profiles()
            self._update_status_panel(f"Profile switched to {name}")
        finally:
            self._profile_selection_busy = False

    def _handle_profile_save(self) -> None:
        self._persist_state()
        self._update_status_panel(f"Profile saved: {self.profile_name}")

    def _handle_profile_create(self) -> None:
        name, accepted = QtWidgets.QInputDialog.getText(self, "Create Profile", "Profile name:")
        if not accepted:
            return
        clean = name.strip()
        if not clean:
            self._show_error("Profile name cannot be empty.")
            return
        if clean in config.list_profiles():
            QtWidgets.QMessageBox.information(self, "AI-E", f"Profile '{clean}' already exists. Select it from the dropdown.")
            return
        self._persist_state()
        self.state = config.ensure_profile(clean, initial_state=self.state)
        self.profile_name = clean
        self._onboarding_force_visible = False
        self._reload_profiles()
        self._apply_state()
        if self.state.staged_prompt.strip():
            self._render_prepared_prompt(
                self.intake_preview_bridge.prepare_prompt(self.state.staged_prompt, self._selected_project())
            )
        else:
            self._reset_intake_decision()
        self._update_status_panel(f"Profile created: {clean}")

    def _handle_project_changed(self, _: str) -> None:
        self._update_active_workspace_label()
        self._persist_state()
        project = self._selected_project()
        if project is None:
            message = self._supported_project_guidance()
            self._reset_intake_decision(message)
            self._reset_live_status(message)
            self._reset_proof_result(message)
            self._update_status_panel(message)
            return
        prompt_text = self.prompt_input.toPlainText().strip()
        if prompt_text:
            self._render_prepared_prompt(
                self.intake_preview_bridge.prepare_prompt(prompt_text, project)
            )
        else:
            self._reset_intake_decision()
        self._update_status_panel(f"Active workspace set: {project.name}")

    def _handle_prompt_changed(self) -> None:
        self._submitted_prompt_key = None
        self._persist_state()
        if self.prompt_input.toPlainText().strip():
            self._reset_intake_decision(
                "Request updated. Choose Prepare Request to review the decision before AI-E runs anything."
            )
        else:
            self._reset_intake_decision()

    def _handle_prepare_prompt(self) -> None:
        preview = self.intake_preview_bridge.prepare_prompt(self.prompt_input.toPlainText().strip(), self._selected_project())
        self._persist_state()
        self._render_prepared_prompt(preview)
        self._update_status_panel(preview.status_message)

    def _handle_intake_next_action(self) -> None:
        preview = self.current_prepared_prompt
        if preview is None:
            self.prompt_input.setFocus()
            return

        if preview.decision_state == "Ready":
            result = self.intake_preview_bridge.submit_prompt(preview, self._selected_project())
            self.intake_feedback_label.setText(result.message)
            self._update_status_panel(result.message)
            if result.ok:
                self._submitted_prompt_key = (preview.normalized_prompt, preview.target_repo)
                self.intake_action_button.setEnabled(False)
                self._set_live_status_target(request_id=result.request_id, task_id=result.task_id, session_id="")
                self._refresh_live_status()
            return

        if preview.decision_state == "Needs approval":
            review = self.intake_preview_bridge.build_review_surface(preview, self._selected_project())
            self._render_request_review(review)
            message = (
                review.status_message
                if review.available
                else "Review is not available for this request yet. Revise the request or choose a supported project."
            )
            self.intake_feedback_label.setText(message)
            self._update_status_panel("Approval review loaded")
            if review.available and review.queue_status:
                self._set_live_status_target(request_id=review.request_id, session_id="")
                self._refresh_live_status()
            return

        if preview.decision_state == "Sandbox first":
            message = (
                "Sandbox is not available from this screen yet. Keep this request staged, or revise it to stay within supported scope."
            )
            self.intake_feedback_label.setText(message)
            self._update_status_panel(message)
            QtWidgets.QMessageBox.information(self, "AI-E", message)
            return

        message = "AI-E is not proceeding with this request. Revise it to stay within supported scope, then prepare it again."
        self.intake_feedback_label.setText(message)
        self._update_status_panel(message)
        self.prompt_input.setFocus()
        cursor = self.prompt_input.textCursor()
        cursor.select(QtGui.QTextCursor.SelectionType.Document)
        self.prompt_input.setTextCursor(cursor)

    def _handle_request_review_action(self, action: str) -> None:
        review = self.current_review_surface
        if review is None:
            message = "No review is open yet. Prepare a request that needs approval, then open review."
            self.approval_review_feedback_label.setText(message)
            self._update_status_panel(message)
            self.prompt_input.setFocus()
            return
        result = self.intake_preview_bridge.apply_review_action(
            review,
            action=action,
            project=self._selected_project(),
            approved_by=self.profile_name,
        )
        self.approval_review_feedback_label.setText(result.message)
        self.intake_feedback_label.setText(result.message)
        self._update_status_panel(result.message)

        if result.ok and result.action == "approve_once" and result.wired and not result.staged_only:
            self._set_live_status_target(
                request_id=result.request_id or review.request_id,
                task_id=result.task_id,
                session_id="",
            )
            if self.current_prepared_prompt is not None:
                refreshed = self.intake_preview_bridge.build_review_surface(
                    self.current_prepared_prompt,
                    self._selected_project(),
                )
                self._render_request_review(refreshed)
                self.approval_review_feedback_label.setText(result.message)
            self._refresh_live_status()
            return

        if result.ok and result.staged_only:
            if result.action == "reject":
                self._set_request_review_badge("Rejected (staged)", "#fee2e2", "#b91c1c")
            elif result.action == "sandbox_first":
                self._set_request_review_badge("Sandbox first (staged)", "#dbeafe", "#1d4ed8")
            if review.queue_status:
                self._set_live_status_target(request_id=review.request_id, session_id="")
                self._refresh_live_status()

    def _handle_refresh_live_status(self) -> None:
        self._refresh_live_status()
        if self.current_live_status is not None:
            self._update_status_panel("Live status refreshed")

    def _handle_open_live_result(self) -> None:
        status = self.current_live_status
        if status is None or not status.result_ready or status.result_path is None:
            message = "No finished result is ready to open here yet. Refresh status, or open History to review earlier results."
            self.live_status_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        self._open_proof_result_from_path(status.result_path)
        self._update_status_panel("Opened result summary")

    def _handle_recent_run_open(self, item: QtWidgets.QTreeWidgetItem, _column: int) -> None:
        payload = item.data(0, QtCore.Qt.ItemDataRole.UserRole)
        path_text = str((payload or {}).get("path") or "").strip() if isinstance(payload, dict) else ""
        if not path_text:
            message = "This row does not have a result to open. Prepare a new request, or choose another saved entry."
            self.history_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        self._open_proof_result_from_path(Path(path_text))
        self._update_status_panel("Opened result summary")

    def _handle_back_to_home_from_proof(self) -> None:
        self._reset_proof_result()
        self.prompt_input.setFocus()
        self._update_status_panel("Returned to home surface")

    def _handle_open_proof_artifact(self) -> None:
        proof = self.current_proof_surface
        if proof is None:
            message = "No result is open yet. Open a finished run first, then open supporting files if you need more detail."
            self.proof_result_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        selected_item = self.proof_result_artifacts_tree.currentItem()
        selected_path = ""
        if selected_item is not None:
            selected_path = str(selected_item.data(0, QtCore.Qt.ItemDataRole.UserRole) or "").strip()
        target = Path(selected_path) if selected_path else proof.primary_artifact_path
        if target is None or not target.exists():
            self.proof_result_feedback_label.setText(
                "Supporting files are not available for this result. Open another finished run or return home and prepare a new request."
            )
            self._update_status_panel("Supporting files are not available")
            return
        QtGui.QDesktopServices.openUrl(QtCore.QUrl.fromLocalFile(str(target)))
        self._update_status_panel("Opened supporting file")

    def _handle_rerun_same_request(self) -> None:
        proof = self.current_proof_surface
        if proof is None or not proof.rerun_prompt.strip():
            message = "This result cannot prepare the same request again. Open another saved result, or type a new request on the home screen."
            self.proof_result_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        self._restage_existing_request(
            prompt_text=proof.rerun_prompt,
            project_path=proof.rerun_project_path,
            feedback_message="Prepared the same request from this result. Review the intake decision before submitting it again.",
            status_message="Prepared same request from result summary",
        )

    def _handle_open_history_result(self) -> None:
        payload = self._selected_history_payload()
        path_text = str(payload.get("path") or "").strip()
        if not path_text:
            message = "No result is available for this entry. Choose another saved entry, or prepare a new request."
            self.history_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        self._open_proof_result_from_path(Path(path_text))
        self.history_feedback_label.setText("Opened the selected history result.")
        self._update_status_panel("Opened result summary")

    def _handle_open_history_session_summary(self) -> None:
        payload = self._selected_history_payload()
        summary_path = str(payload.get("session_summary_path") or "").strip()
        if not summary_path:
            message = "This entry does not have a saved session summary. Open the result instead, or choose another saved entry."
            self.history_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        target = Path(summary_path)
        if not target.exists():
            message = "The saved session summary is not available right now. Open the result instead, or choose another saved entry."
            self.history_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        QtGui.QDesktopServices.openUrl(QtCore.QUrl.fromLocalFile(str(target)))
        self.history_feedback_label.setText("Opened the selected session summary.")
        self._update_status_panel("Opened session summary")

    def _handle_restage_history_request(self) -> None:
        payload = self._selected_history_payload()
        prompt_text = str(payload.get("rerun_prompt") or "").strip()
        if not prompt_text:
            message = "This entry cannot prepare the same request again. Open the result for details, or type a new request."
            self.history_feedback_label.setText(message)
            self._update_status_panel(message)
            return
        self._restage_existing_request(
            prompt_text=prompt_text,
            project_path=str(payload.get("rerun_project_path") or "").strip(),
            feedback_message="Prepared the same request from history. Review the intake decision before submitting it again.",
            status_message="Prepared same request from history",
        )

    def _select_project_by_path(self, project_path: str) -> None:
        normalized = str(project_path or "").strip().lower()
        if not normalized:
            return
        for index, project in enumerate(self.supported_projects):
            if str(project.path).lower() != normalized:
                continue
            if self.project_combo.currentIndex() != index:
                self.project_combo.setCurrentIndex(index)
            return

    def _restage_existing_request(
        self,
        *,
        prompt_text: str,
        project_path: str,
        feedback_message: str,
        status_message: str,
    ) -> None:
        if project_path.strip():
            self._select_project_by_path(project_path)
        self.prompt_input.setPlainText(prompt_text)
        self._render_prepared_prompt(
            self.intake_preview_bridge.prepare_prompt(prompt_text, self._selected_project())
        )
        self._reset_proof_result(feedback_message)
        self.history_feedback_label.setText(feedback_message)
        self._update_status_panel(status_message)

    def _handle_browse(self) -> None:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(self, "Select BABYLON executable", str(Path.home()))
        if path:
            self.exe_path_edit.setText(path)
            self._persist_state()

    def _handle_launch(self) -> None:
        try:
            self.session.launch_babylon(self.exe_path_edit.text().strip())
            self._update_status_panel("BABYLON launch requested")
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_attach(self) -> None:
        exe = self.exe_path_edit.text().strip()
        connected = self.session.refresh_connection(exe, log_event=True)
        snapshot = self.session.process_snapshot
        if connected:
            pid = snapshot.get("pid")
            msg = f"Connected to BABYLON (PID {pid})" if pid else "Connected to BABYLON"
            self._update_status_panel(msg)
        else:
            reason = snapshot.get("reason", "BABYLON not detected")
            self._show_error(f"Attach failed: {reason}")

    def _handle_start_run(self) -> None:
        try:
            run_dir = self.session.start_run(
                map_id=self.map_dropdown.currentText(),
                babylon_exe_path=self.exe_path_edit.text().strip(),
                record_input=self.record_input_checkbox.isChecked(),
                record_mic=self.record_mic_checkbox.isChecked(),
                push_to_talk=self.record_mic_checkbox.isChecked() and self.push_to_talk_checkbox.isChecked(),
            )
            self.session.clear_last_review()
            self._persist_state()
            self._update_status_panel(f"Run started: {run_dir.name}")
            self._refresh_buttons()
            self._update_session_review_panel()
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_stop_run(self) -> None:
        try:
            run_dir = self.session.stop_run()
            self._update_status_panel(f"Run stopped: {run_dir.name}")
            self._refresh_recent_runs()
            self._refresh_buttons()
            self._update_session_review_panel()
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_open_run_folder(self) -> None:
        try:
            self.session.open_last_run_folder()
            self._update_status_panel("Opened run folder")
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_open_logs(self) -> None:
        try:
            self.session.open_logs_folder()
            self._update_status_panel("Opened logs folder")
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_clear_review(self) -> None:
        self.session.clear_last_review()
        self._update_session_review_panel()
        self._update_status_panel("Session review cleared")

    def _handle_action_request(self) -> None:
        descriptor = self.session.action_layer_descriptor()
        if descriptor.get("enabled") and not descriptor.get("armed"):
            message = "Action layer hardware detected but remains disarmed by default."
        else:
            message = (
                "AI-E v5 ships with the action layer locked."
                "\n\nLog automation ideas in /FROZEN_BACKLOG.md and obtain manual approval"
                " before enabling UnityActionInterface."
            )
        QtWidgets.QMessageBox.information(self, "Action Layer", message)

    def _refresh_buttons(self) -> None:
        running = self.session.is_running
        self.start_button.setEnabled(not running)
        self.stop_button.setEnabled(running)
        self.map_dropdown.setEnabled(not running)
        self.record_input_checkbox.setEnabled(not running)
        self.record_mic_checkbox.setEnabled(not running)
        self.push_to_talk_checkbox.setEnabled(self.record_mic_checkbox.isChecked() and not running)
        self.profile_combo.setEnabled(not running)
        self.profile_new_button.setEnabled(not running)
        self.project_combo.setEnabled(not running and bool(self.supported_projects))
        self.prepare_prompt_button.setEnabled(bool(self.supported_projects))
        self.open_run_button.setEnabled(self.session.last_run_dir is not None)
        self.live_status_refresh_button.setEnabled(True)
        self.live_status_open_result_button.setEnabled(
            self.current_live_status is not None
            and bool(self.current_live_status.result_ready and self.current_live_status.result_path)
        )
        self.proof_result_back_button.setEnabled(self.current_proof_surface is not None)
        self.proof_result_open_artifacts_button.setEnabled(
            self.current_proof_surface is not None
            and bool(self.current_proof_surface.raw_artifacts or self.current_proof_surface.primary_artifact_path)
        )
        self.proof_result_rerun_button.setEnabled(
            self.current_proof_surface is not None
            and bool(self.current_proof_surface.rerun_prompt.strip())
        )
        history_payload = self._selected_history_payload()
        self.history_open_result_button.setEnabled(bool(str(history_payload.get("path") or "").strip()))
        self.history_open_session_button.setEnabled(bool(str(history_payload.get("session_summary_path") or "").strip()))
        self.history_restage_button.setEnabled(bool(str(history_payload.get("rerun_prompt") or "").strip()))
        if self.current_review_surface is None:
            self.approval_review_approve_button.setEnabled(False)
            self.approval_review_reject_button.setEnabled(False)
            self.approval_review_sandbox_button.setEnabled(False)
        else:
            self.approval_review_approve_button.setEnabled(self.current_review_surface.approve_enabled and not running)
            self.approval_review_reject_button.setEnabled(self.current_review_surface.reject_enabled and not running)
            self.approval_review_sandbox_button.setEnabled(self.current_review_surface.sandbox_enabled and not running)
        self._update_action_panel()

    def _handle_mic_toggle(self, checked: bool) -> None:
        if not checked:
            self.push_to_talk_checkbox.setChecked(False)
        self.push_to_talk_checkbox.setEnabled(checked and not self.session.is_running)

    # -----------------
    # Status + feedback
    # -----------------
    def _show_acceptance_tests(self) -> None:
        dialog = QtWidgets.QDialog(self)
        dialog.setWindowTitle("AI-E Demo Checklist")
        layout = QtWidgets.QVBoxLayout(dialog)
        intro = QtWidgets.QLabel("Run this quick checklist before a demo or first local-user handoff:")
        intro.setWordWrap(True)
        layout.addWidget(intro)

        checklist = QtWidgets.QListWidget()
        checklist.setAlternatingRowColors(True)
        steps = [
            ("A", "Launch AI-E and confirm the Home screen and guardrails are visible"),
            ("B", "Confirm a supported project is selected, such as BABYLON VER 2"),
            ("C", "Use \"move zombie forward\" and choose Prepare Request"),
            ("D", "Submit when Ready, or open review and Approve once if approval is needed"),
            ("E", "Open the result summary or History and confirm the saved outcome"),
        ]
        for label, text in steps:
            item = QtWidgets.QListWidgetItem(f"{label}. {text}")
            item.setFlags(item.flags() | QtCore.Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(QtCore.Qt.CheckState.Unchecked)
            checklist.addItem(item)
        layout.addWidget(checklist)

        helper = QtWidgets.QLabel("Checks reset each time you open this window.")
        helper.setStyleSheet("color: #666;")
        helper.setWordWrap(True)
        layout.addWidget(helper)

        buttons = QtWidgets.QDialogButtonBox(QtWidgets.QDialogButtonBox.StandardButton.Close)
        buttons.rejected.connect(dialog.reject)
        buttons.accepted.connect(dialog.accept)
        layout.addWidget(buttons)
        dialog.exec()

    def _update_status_panel(self, message: str) -> None:
        status = self.session.status_snapshot()
        connection_text = status.connection_status
        if status.connection_status == "Connected" and status.pid:
            connection_text = f"Connected (PID {status.pid})"
        self.connection_label.setText(connection_text)
        self.pid_label.setText(str(status.pid) if status.pid else "—")
        self.last_action_label.setText(message)
        run_dir = status.run_dir if status.run_dir else self.session.last_run_dir
        self.run_folder_label.setText(str(run_dir) if run_dir else "None")
        self.duration_label.setText(self._format_duration(status.duration_seconds))
        self.artifacts_label.setText(str(status.artifacts_root))

    def _show_error(self, message: str) -> None:
        QtWidgets.QMessageBox.warning(self, "AI-E", message)
        self._update_status_panel(message)

    def _update_duration_label(self) -> None:
        self.duration_label.setText(self._format_duration(self.session.current_duration_seconds))
        if self.session.is_running:
            exe_hint = self.exe_path_edit.text().strip()
            self.session.heartbeat(exe_hint)
            self._update_session_review_panel()
            self._update_action_panel()

    @staticmethod
    def _format_duration(seconds: float) -> str:
        total = max(0, int(seconds))
        hours, remainder = divmod(total, 3600)
        minutes, secs = divmod(remainder, 60)
        if hours:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        return f"{minutes:02d}:{secs:02d}"

    def _update_action_panel(self) -> None:
        descriptor = self.session.action_layer_descriptor()
        enabled = bool(descriptor.get("enabled"))
        armed = bool(descriptor.get("armed"))
        adapter_name = descriptor.get("name", "action_layer")
        if not enabled:
            status_text = "Locked (manual approval required)"
            color = "#a94442"
        elif armed:
            status_text = "Armed"
            color = "#d58512"
        else:
            status_text = "Available (disarmed)"
            color = "#2f8f2f"
        self.action_status_label.setText(f"{adapter_name}: {status_text}")
        self.action_status_label.setStyleSheet(f"font-weight: 600; color: {color};")
        helper = "AI-E never automates without explicit approval. Requests live in /FROZEN_BACKLOG.md."
        self.action_details_label.setText(helper)
        self.action_request_button.setEnabled(not self.session.is_running)


def launch_ui() -> int:
    app = QtWidgets.QApplication.instance()
    owns_app = app is None
    if app is None:
        app = QtWidgets.QApplication(sys.argv)
    window = ControlPanel()
    window.show()
    window.raise_()
    window.activateWindow()
    if owns_app:
        return int(app.exec())
    return 0


def main() -> None:
    raise SystemExit(launch_ui())


if __name__ == "__main__":
    main()
