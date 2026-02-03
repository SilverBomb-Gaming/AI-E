"""PySide6 UI layer for the AI-E Control Panel."""
from __future__ import annotations

import sys
from pathlib import Path

from PySide6 import QtCore, QtWidgets

from . import config
from .runner import RunSession, update_saved_state


class ControlPanel(QtWidgets.QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("AI-E Control Panel v0.2")
        self.state = config.load_state()
        self.session = RunSession()
        self._build_ui()
        self._apply_state()
        self._update_status_panel("Ready")

    # -----------------
    # UI construction
    # -----------------
    def _build_ui(self) -> None:
        central = QtWidgets.QWidget()
        self.setCentralWidget(central)
        layout = QtWidgets.QVBoxLayout(central)
        layout.setSpacing(12)

        header = QtWidgets.QLabel("AI-E Control Panel v0.2")
        header.setAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)
        header.setStyleSheet("font-size: 20px; font-weight: 600;")
        layout.addWidget(header)

        layout.addWidget(self._build_target_panel())
        layout.addWidget(self._build_run_panel())
        layout.addWidget(self._build_status_panel())
        layout.addStretch(1)

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

        self.record_input_checkbox = QtWidgets.QCheckBox("Record Input")
        self.record_mic_checkbox = QtWidgets.QCheckBox("Record Mic")
        self.record_mic_checkbox.toggled.connect(self._handle_mic_toggle)
        self.push_to_talk_checkbox = QtWidgets.QCheckBox("Enable Push-to-Talk (Space)")
        self.push_to_talk_checkbox.setEnabled(False)

        self.start_button = QtWidgets.QPushButton("Start Run")
        self.start_button.clicked.connect(self._handle_start_run)
        self.stop_button = QtWidgets.QPushButton("Stop Run")
        self.stop_button.clicked.connect(self._handle_stop_run)
        self.open_button = QtWidgets.QPushButton("Open Last Run Folder")
        self.open_button.clicked.connect(self._handle_open_folder)

        layout.addWidget(QtWidgets.QLabel("Map"), 0, 0)
        layout.addWidget(self.map_dropdown, 0, 1)
        layout.addWidget(self.record_input_checkbox, 1, 0, 1, 2)
        layout.addWidget(self.record_mic_checkbox, 2, 0, 1, 2)
        layout.addWidget(self.push_to_talk_checkbox, 3, 0, 1, 2)
        layout.addWidget(self.start_button, 4, 0)
        layout.addWidget(self.stop_button, 4, 1)
        layout.addWidget(self.open_button, 5, 0, 1, 2)
        return group

    def _build_status_panel(self) -> QtWidgets.QGroupBox:
        group = QtWidgets.QGroupBox("Status")
        layout = QtWidgets.QFormLayout(group)

        self.connection_label = QtWidgets.QLabel("Not connected")
        self.last_action_label = QtWidgets.QLabel("Idle")
        self.run_folder_label = QtWidgets.QLabel("None")

        layout.addRow("Connection:", self.connection_label)
        layout.addRow("Last Action:", self.last_action_label)
        layout.addRow("Run Folder:", self.run_folder_label)
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

    def _persist_state(self) -> None:
        self.state.babylon_exe_path = self.exe_path_edit.text().strip()
        self.state.last_selected_map = self.map_dropdown.currentText()
        self.state.record_input = self.record_input_checkbox.isChecked()
        self.state.record_mic = self.record_mic_checkbox.isChecked()
        self.state.push_to_talk = self.push_to_talk_checkbox.isChecked()
        update_saved_state(self.state)

    # -----------------
    # Event handlers
    # -----------------
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
        msg = "Connected to BABYLON" if connected else "BABYLON not detected"
        self._update_status_panel(msg)

    def _handle_start_run(self) -> None:
        try:
            run_dir = self.session.start_run(
                map_id=self.map_dropdown.currentText(),
                babylon_exe_path=self.exe_path_edit.text().strip(),
                record_input=self.record_input_checkbox.isChecked(),
                record_mic=self.record_mic_checkbox.isChecked(),
                push_to_talk=self.record_mic_checkbox.isChecked() and self.push_to_talk_checkbox.isChecked(),
            )
            self._persist_state()
            self._update_status_panel(f"Run started: {run_dir.name}")
            self._refresh_buttons()
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_stop_run(self) -> None:
        try:
            run_dir = self.session.stop_run()
            self._update_status_panel(f"Run stopped: {run_dir.name}")
            self._refresh_buttons()
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _handle_open_folder(self) -> None:
        try:
            self.session.open_last_run_folder()
            self._update_status_panel("Opened run folder")
        except Exception as exc:  # noqa: BLE001
            self._show_error(str(exc))

    def _refresh_buttons(self) -> None:
        running = self.session.is_running
        self.start_button.setEnabled(not running)
        self.stop_button.setEnabled(running)
        self.push_to_talk_checkbox.setEnabled(self.record_mic_checkbox.isChecked() and not running)

    def _handle_mic_toggle(self, checked: bool) -> None:
        if not checked:
            self.push_to_talk_checkbox.setChecked(False)
        self.push_to_talk_checkbox.setEnabled(checked and not self.session.is_running)

    # -----------------
    # Status + feedback
    # -----------------
    def _update_status_panel(self, message: str) -> None:
        status = self.session.status_snapshot()
        self.connection_label.setText(status.connection_status)
        self.last_action_label.setText(message)
        run_dir = status.run_dir if status.run_dir else self.session.last_run_dir
        self.run_folder_label.setText(str(run_dir) if run_dir else "None")

    def _show_error(self, message: str) -> None:
        QtWidgets.QMessageBox.warning(self, "AI-E", message)
        self._update_status_panel(message)


def launch_ui() -> None:
    app = QtWidgets.QApplication(sys.argv)
    window = ControlPanel()
    window.resize(600, 500)
    window.show()
    sys.exit(app.exec())
