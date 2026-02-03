"""Run management logic for AI-E Control Panel."""
from __future__ import annotations

import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

from . import config
from .artifacts import (
    build_mapprobe_snapshot,
    build_process_snapshot,
    build_run_summary,
    take_screenshot,
    write_json,
)
from .logger import write_event
from .paths import create_run_dir
from .recorders import InputRecorder, MicRecorder


@dataclass
class RunStatus:
    run_dir: Optional[Path]
    last_action: str
    connection_status: str


class RunSession:
    def __init__(self) -> None:
        self._current_run_dir: Optional[Path] = None
        self._last_run_dir: Optional[Path] = None
        self._last_action: str = "Waiting for operator input"
        self._connected: bool = False
        self._process_snapshot: Dict[str, object] = {"status": "unknown"}
        self._map_id: str = "001"
        self._run_start_ts: Optional[float] = None
        self._babylon_exe_path: str = ""
        self._input_recorder: Optional[InputRecorder] = None
        self._mic_recorder: Optional[MicRecorder] = None
        self._screenshot_paths: list[Path] = []

    # -----------------
    # BABYLON helpers
    # -----------------
    def launch_babylon(self, exe_path: str) -> None:
        path = Path(exe_path)
        if not exe_path:
            raise ValueError("BABYLON exe path is empty.")
        if not path.exists():
            raise FileNotFoundError(f"BABYLON exe not found: {exe_path}")
        subprocess.Popen(str(path), cwd=str(path.parent))
        self._last_action = "Launched BABYLON"
        if self._current_run_dir:
            self._log_event("babylon_launched", fields={"path": str(path)})

    def refresh_connection(self, process_hint: str, *, log_event: bool = False) -> bool:
        self._process_snapshot = build_process_snapshot(process_hint)
        self._connected = self._process_snapshot.get("status") == "connected"
        self._last_action = "Detected BABYLON" if self._connected else "BABYLON not running"
        if log_event and self._current_run_dir:
            event = "attached_ok" if self._connected else "attach_failed"
            self._log_event(event, fields=self._process_fields())
        return self._connected

    # -----------------
    # Run lifecycle
    # -----------------
    def start_run(
        self,
        map_id: str,
        babylon_exe_path: str,
        record_input: bool,
        record_mic: bool,
        push_to_talk: bool,
    ) -> Path:
        if self._current_run_dir is not None:
            raise RuntimeError("A run is already active. Stop it before starting a new one.")

        run_dir = create_run_dir()
        timestamp = os.path.basename(str(run_dir)).split("_run_")[0]
        meta = {
            "timestamp": timestamp,
            "selected_map": map_id,
            "babylon_exe_path": babylon_exe_path,
            "version": "v0.2",
            "record_input": record_input,
            "record_mic": record_mic,
            "push_to_talk": push_to_talk,
            "map_confirmed": "unknown",
        }
        write_json(run_dir / "run_meta.json", meta)

        self._current_run_dir = run_dir
        self._last_run_dir = run_dir
        self._map_id = map_id
        self._babylon_exe_path = babylon_exe_path
        self._run_start_ts = time.time()
        self._screenshot_paths = []
        self._log_event("babylon_launched", fields={"status": "pending", "hint": "Use Launch BABYLON button if needed"})
        self._log_event("run_started", fields={"map": map_id})

        screenshot = take_screenshot(run_dir, "start")
        if screenshot:
            self._screenshot_paths.append(screenshot)

        self._input_recorder = None
        if record_input:
            recorder = InputRecorder()
            if recorder.start(run_dir):
                self._log_event("input_recording_started")
                self._input_recorder = recorder
            else:
                self._log_event("input_recording_failed", level="ERROR", fields={"reason": recorder.last_error})

        self._mic_recorder = None
        if record_mic:
            mic = MicRecorder()
            if mic.start(run_dir, push_to_talk=push_to_talk):
                self._log_event("mic_recording_started", fields={"push_to_talk": push_to_talk})
                self._mic_recorder = mic
            else:
                self._log_event("mic_recording_failed", level="ERROR", fields={"reason": mic.last_error})

        self.refresh_connection(babylon_exe_path, log_event=True)
        snapshot = build_mapprobe_snapshot(
            map_id,
            self._process_snapshot,
            "running",
            started_at=self._run_start_ts,
        )
        write_json(run_dir / "mapprobe_snapshot.json", snapshot)
        self._last_action = f"Run started ({map_id})"
        return run_dir

    def stop_run(self) -> Path:
        if self._current_run_dir is None:
            raise RuntimeError("No active run to stop.")
        run_dir = self._current_run_dir
        self._log_event("run_stopping")

        screenshot = take_screenshot(run_dir, "end")
        if screenshot:
            self._screenshot_paths.append(screenshot)

        input_events = 0
        if self._input_recorder:
            self._input_recorder.stop()
            input_events = self._input_recorder.event_count
            self._log_event("input_recording_stopped", fields={"events": input_events})
            self._input_recorder = None

        mic_meta: Dict[str, object] = {}
        if self._mic_recorder:
            mic_meta = self._mic_recorder.stop()
            self._log_event("mic_recording_stopped", fields={"duration": mic_meta.get("recorded_seconds", 0.0)})
            self._mic_recorder = None

        stop_ts = time.time()
        duration = stop_ts - self._run_start_ts if self._run_start_ts else 0.0
        warnings = []
        if not self._connected:
            warnings.append("BABYLON not attached during run")

        summary = build_run_summary(
            map_id=self._map_id,
            exe_path=self._babylon_exe_path or str(self._process_snapshot.get("exe", "unknown")),
            duration_seconds=duration,
            process_snapshot=self._process_snapshot,
            screenshot_count=len(self._screenshot_paths),
            input_events=input_events,
            mic_meta=mic_meta,
            warnings=warnings,
        )
        write_json(run_dir / "run_summary.json", summary)

        snapshot = build_mapprobe_snapshot(
            self._map_id,
            self._process_snapshot,
            "stopped",
            started_at=self._run_start_ts,
            stopped_at=stop_ts,
        )
        write_json(run_dir / "mapprobe_snapshot.json", snapshot)

        self._log_event("run_stopped")
        finished_dir = self._current_run_dir
        self._current_run_dir = None
        self._run_start_ts = None
        self._last_action = "Run stopped"
        return finished_dir

    def open_last_run_folder(self) -> None:
        if self._last_run_dir is None:
            raise RuntimeError("No run folder exists yet.")
        os.startfile(self._last_run_dir)  # type: ignore[attr-defined]
        self._last_action = "Opened run folder"

    # -----------------
    # Reporting helpers
    # -----------------
    def status_snapshot(self) -> RunStatus:
        return RunStatus(
            run_dir=self._current_run_dir,
            last_action=self._last_action,
            connection_status="Connected" if self._connected else "Not connected",
        )

    @property
    def is_running(self) -> bool:
        return self._current_run_dir is not None

    @property
    def last_run_dir(self) -> Optional[Path]:
        return self._last_run_dir

    def _log_event(self, event: str, *, level: str = "INFO", fields: Optional[Dict[str, object]] = None) -> None:
        if self._current_run_dir:
            write_event(self._current_run_dir, event, level=level, fields=fields)

    def _process_fields(self) -> Dict[str, object]:
        snapshot = self._process_snapshot
        fields: Dict[str, object] = {"status": snapshot.get("status", "unknown")}
        if snapshot.get("pid"):
            fields["pid"] = snapshot["pid"]
        if snapshot.get("name"):
            fields["name"] = snapshot["name"]
        return fields


def update_saved_state(new_state: config.AppState) -> None:
    config.save_state(new_state)
