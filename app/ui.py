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
        self._submitted_prompt_key: tuple[str, str] | None = None
        self._profile_selection_busy = False
        self._build_ui()
        self._build_menu_bar()
        self._duration_timer = QtCore.QTimer(self)
        self._duration_timer.setInterval(1000)
        self._duration_timer.timeout.connect(self._update_duration_label)
        self._duration_timer.start()
        self._reload_profiles()
        self._reload_supported_projects()
        self._apply_state()
        self._update_status_panel("Ready")
        self._update_session_review_panel()
        self._refresh_recent_runs()
        if self.state.staged_prompt.strip():
            self._render_prepared_prompt(
                self.intake_preview_bridge.prepare_prompt(self.state.staged_prompt, self._selected_project())
            )
        else:
            self._reset_intake_decision()
        self._refresh_dependency_label()
        self._update_duration_label()
        self._refresh_buttons()

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

        header = QtWidgets.QLabel("Operator Control Panel")
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
            "Select a supported project, stage a request into the existing intake flow, and review recent proof and session artifacts."
        )
        subtitle.setWordWrap(True)
        subtitle.setStyleSheet("color: #555;")
        layout.addWidget(subtitle)

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
            "This stages a request for the existing intake system only. It does not execute, queue, or mutate anything yet."
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
        layout.addWidget(prompt_group)

        runs_group = QtWidgets.QGroupBox("Recent Runs")
        runs_layout = QtWidgets.QVBoxLayout(runs_group)
        runs_hint = QtWidgets.QLabel(
            "Pulled from existing runner artifacts and persistent session artifacts already written by AI-E."
        )
        runs_hint.setWordWrap(True)
        runs_hint.setStyleSheet("color: #555;")
        runs_layout.addWidget(runs_hint)

        self.recent_runs_tree = QtWidgets.QTreeWidget()
        self.recent_runs_tree.setColumnCount(4)
        self.recent_runs_tree.setHeaderLabels(["Name", "Source", "Status", "Updated"])
        self.recent_runs_tree.setRootIsDecorated(False)
        self.recent_runs_tree.setAlternatingRowColors(True)
        self.recent_runs_tree.setUniformRowHeights(True)
        self.recent_runs_tree.header().setStretchLastSection(False)
        self.recent_runs_tree.header().setSectionResizeMode(0, QtWidgets.QHeaderView.ResizeMode.Stretch)
        self.recent_runs_tree.header().setSectionResizeMode(1, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(2, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        self.recent_runs_tree.header().setSectionResizeMode(3, QtWidgets.QHeaderView.ResizeMode.ResizeToContents)
        runs_layout.addWidget(self.recent_runs_tree)
        layout.addWidget(runs_group)

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
        tests_action = QtGui.QAction("Acceptance Tests…", self)
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
        self.dependency_label = QtWidgets.QLabel("Checking…")
        self.dependency_label.setWordWrap(True)

        layout.addRow("Connection:", self.connection_label)
        layout.addRow("PID:", self.pid_label)
        layout.addRow("Run Duration:", self.duration_label)
        layout.addRow("Last Action:", self.last_action_label)
        layout.addRow("Run Folder:", self.run_folder_label)
        layout.addRow("Artifacts:", self.artifacts_label)
        layout.addRow("System Warnings:", self.dependency_label)
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

    def _select_active_project(self) -> None:
        if not self.supported_projects:
            return
        desired_path = self.state.active_project_path.strip().lower()
        desired_name = self.state.active_project_name.strip().lower()
        selected_index = 0
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

    def _update_active_workspace_label(self) -> None:
        project = self._selected_project()
        if project is None:
            self.workspace_value_label.setText("No supported project available.")
            return
        self.workspace_value_label.setText(f"{project.name} ({project.project_type})")

    def _refresh_recent_runs(self) -> None:
        self.recent_runs_tree.clear()
        entries = home_surface.load_recent_runs()
        if not entries:
            self.recent_runs_tree.addTopLevelItem(
                QtWidgets.QTreeWidgetItem(["No runs found yet", "-", "-", "-"])
            )
            return
        for entry in entries:
            item = QtWidgets.QTreeWidgetItem(
                [
                    entry.title,
                    entry.source,
                    entry.status,
                    entry.updated_label,
                ]
            )
            item.setToolTip(0, entry.detail or entry.title)
            item.setToolTip(1, entry.detail or entry.source)
            item.setToolTip(2, entry.detail or entry.status)
            item.setToolTip(3, entry.detail or entry.updated_label)
            self.recent_runs_tree.addTopLevelItem(item)

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

    def _reset_intake_decision(self, message: str = "Prepare a prompt to see the intake decision.") -> None:
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
        self.intake_feedback_label.setText("Requests remain staged until you choose a next action.")

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

    def _refresh_dependency_label(self) -> None:
        summary = dependencies.dependency_summary_text()
        warnings = dependencies.dependency_warnings()
        if warnings:
            self.dependency_label.setStyleSheet("color: #a94442;")
        else:
            self.dependency_label.setStyleSheet("color: #2f8f2f;")
        self.dependency_label.setText(summary)

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
            self._reset_intake_decision("No supported project selected.")
            self._update_status_panel("No supported project selected")
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
                "Prompt edited. Choose Prepare Request to see the intake decision without executing."
            )
        else:
            self._reset_intake_decision()

    def _handle_prepare_prompt(self) -> None:
        preview = self.intake_preview_bridge.prepare_prompt(self.prompt_input.toPlainText().strip(), self._selected_project())
        self._persist_state()
        self._render_prepared_prompt(preview)
        self._update_status_panel("Request prepared for intake preview")

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
            return

        if preview.decision_state == "Needs approval":
            message = "Review UI is deferred to Step 3+. This request remains staged and has not been submitted here."
            self.intake_feedback_label.setText(message)
            QtWidgets.QMessageBox.information(self, "AI-E", message)
            return

        if preview.decision_state == "Sandbox first":
            message = "Sandbox UI is deferred to a later step. This request remains staged and nothing has executed."
            self.intake_feedback_label.setText(message)
            QtWidgets.QMessageBox.information(self, "AI-E", message)
            return

        self.intake_feedback_label.setText("Revise the prompt and prepare it again.")
        self.prompt_input.setFocus()
        cursor = self.prompt_input.textCursor()
        cursor.select(QtGui.QTextCursor.SelectionType.Document)
        self.prompt_input.setTextCursor(cursor)

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
        dialog.setWindowTitle("AI-E Acceptance Tests")
        layout = QtWidgets.QVBoxLayout(dialog)
        intro = QtWidgets.QLabel("Run this quick checklist before capturing a session:")
        intro.setWordWrap(True)
        layout.addWidget(intro)

        checklist = QtWidgets.QListWidget()
        checklist.setAlternatingRowColors(True)
        steps = [
            ("A", "AI-E.exe opens"),
            ("B", "Browse → set BABYLON exe path"),
            ("C", "Launch → Attach shows Connected"),
            ("D", "Start Run → two screenshots within 30 seconds"),
            ("E", "Stop Run → run folder has meta + summary + events log"),
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


def launch_ui() -> None:
    app = QtWidgets.QApplication(sys.argv)
    window = ControlPanel()
    window.show()
    sys.exit(app.exec())
