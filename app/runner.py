"""Run management logic for AI-E Control Panel."""
from __future__ import annotations

import os
import subprocess
import time
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config
from .actions import ActionInterface, DisabledActionInterface
from .artifacts import (
    ScreenshotResult,
    build_mapprobe_snapshot,
    build_process_snapshot,
    build_run_summary,
    iso_timestamp,
    write_json,
)
from .diagnostics import FocusTracker, collect_environment_snapshot
from .logger import write_event
from .paths import create_run_dir, ensure_artifacts_root
from .recorders import InputFocusGate, InputRecorder, MicRecorder
from .perception import BasePerceptionAdapter, MovementDelta, PerceptionFrame, UnityWindowPerception


@dataclass
class RunStatus:
    run_dir: Optional[Path]
    last_action: str
    connection_status: str
    pid: Optional[int]
    exe_path: str
    artifacts_root: Path
    duration_seconds: float


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
        self._screenshot_results: List[Dict[str, Any]] = []
        self._environment_snapshot: Dict[str, Any] = {}
        self._focus_tracker: Optional[FocusTracker] = None
        self._run_meta: Dict[str, Any] = {}
        self._run_meta_path: Optional[Path] = None
        self._record_input_requested = False
        self._record_mic_requested = False
        self._active_warnings: List[str] = []
        self._artifacts_root = ensure_artifacts_root()
        self._input_focus_gate = InputFocusGate()
        self._last_review: Dict[str, Any] = {}
        self._perception = UnityWindowPerception()
        self._last_perception_frame: Optional[PerceptionFrame] = None
        self._movement_deltas: List[MovementDelta] = []
        self._awaiting_recovery = False
        self._action_interface: ActionInterface = DisabledActionInterface()
        self._bind_action_logger(self._action_interface)

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
        try:
            snapshot = build_process_snapshot(process_hint)
        except Exception as exc:  # noqa: BLE001
            snapshot = {"status": "error", "reason": str(exc)}
        was_connected = self._connected
        self._process_snapshot = snapshot
        self._connected = snapshot.get("status") == "connected"
        self._last_action = "Detected BABYLON" if self._connected else snapshot.get("reason", "BABYLON not running")
        if self._focus_tracker:
            self._focus_tracker.update_target(snapshot.get("pid"), snapshot.get("exe") or process_hint)
        self._update_input_focus_gate(snapshot, process_hint)

        state_fields = self._process_fields(include_reason=not self._connected)
        if was_connected and not self._connected:
            self._awaiting_recovery = True
            self._log_event("window_lost", level="ERROR", fields=state_fields)
            self._log_event("recovery_attempt", level="WARNING", fields={**state_fields, "status": "pending"})
        elif self._awaiting_recovery and self._connected:
            self._log_event("window_recovered", fields=state_fields)
            self._log_event("recovery_attempt", level="INFO", fields={**state_fields, "status": "restored"})
            self._awaiting_recovery = False
        elif log_event and not self._connected:
            self._log_event("recovery_attempt", level="WARNING", fields=state_fields)

        if log_event and self._current_run_dir:
            event = "attached_ok" if self._connected else "attach_failed"
            level = "INFO" if self._connected else "ERROR"
            payload = self._process_fields(include_reason=True)
            if snapshot.get("status") == "error":
                payload["error"] = snapshot.get("reason", "unknown attach error")
            self._log_event(event, level=level, fields=payload)
            if not self._connected and snapshot.get("reason"):
                self._active_warnings.append(f"Attach failed: {snapshot['reason']}")
        return self._connected

    def heartbeat(self, process_hint: Optional[str]) -> None:
        if not self._current_run_dir:
            return
        hint = (process_hint or self._babylon_exe_path).strip()
        if not hint:
            return
        self.refresh_connection(hint)

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

        map_id = (map_id or "").strip()
        if not map_id:
            raise ValueError("Map selection is required before starting a run.")
        babylon_exe_path = babylon_exe_path.strip()
        if not babylon_exe_path:
            raise ValueError("BABYLON exe path must be configured before starting a run.")

        self._action_interface.disarm()
        self._awaiting_recovery = False
        run_dir = create_run_dir()
        timestamp = os.path.basename(str(run_dir)).split("_run_")[0]
        started_at = time.time()
        meta = {
            "timestamp": timestamp,
            "run_id": run_dir.name,
            "run_dir": str(run_dir),
            "selected_map": map_id,
            "babylon_exe_path": babylon_exe_path,
            "version": "v0.2",
            "record_input": record_input,
            "record_mic": record_mic,
            "push_to_talk": push_to_talk,
            "map_confirmed": "unknown",
            "started_at": iso_timestamp(started_at),
        }
        run_meta_path = run_dir / "run_meta.json"
        write_json(run_meta_path, meta, overwrite=False)

        self._current_run_dir = run_dir
        self._last_run_dir = run_dir
        self._map_id = map_id
        self._babylon_exe_path = babylon_exe_path
        self._perception.bind_target(babylon_exe_path)
        self._run_start_ts = started_at
        self._run_meta = meta
        self._run_meta_path = run_meta_path
        self._screenshot_results = []
        self._movement_deltas = []
        self._last_perception_frame = None
        self._active_warnings = []
        self._record_input_requested = record_input
        self._record_mic_requested = record_mic
        self._environment_snapshot = collect_environment_snapshot()
        self._focus_tracker = FocusTracker(
            target_exe=babylon_exe_path,
            log_callback=lambda event, fields: self._log_event(event, fields=fields),
        )
        self._focus_tracker.start()

        self._log_event(
            "environment_snapshot",
            fields={"is_elevated": self._environment_snapshot.get("is_elevated", False), "exe": self._environment_snapshot.get("exe_path")},
        )
        self._log_event(
            "babylon_launched",
            fields={"status": "pending", "hint": "Use Launch BABYLON button if needed"},
        )
        self._log_event("run_started", fields={"map": map_id})

        self._capture_perception_frame("start")

        self.refresh_connection(babylon_exe_path, log_event=True)
        if not self._connected:
            self._awaiting_recovery = True
            warning = self._process_snapshot.get("reason", "BABYLON not detected")
            self._active_warnings.append(f"Connection pending: {warning}")
            self._log_event("window_not_found", level="WARNING", fields=self._process_fields(include_reason=True))

        self._input_recorder = None
        if record_input:
            recorder = InputRecorder(focus_gate=self._input_focus_gate)
            if recorder.start(run_dir):
                self._log_event("input_recording_started")
                self._input_recorder = recorder
            else:
                reason = recorder.last_error or "input recorder unavailable"
                self._log_event("input_recording_failed", level="ERROR", fields={"reason": reason})
                self._active_warnings.append(f"Input recorder unavailable: {reason}")

        self._mic_recorder = None
        if record_mic:
            mic = MicRecorder()
            if mic.start(run_dir, push_to_talk=push_to_talk):
                self._log_event("mic_recording_started", fields={"push_to_talk": push_to_talk})
                self._mic_recorder = mic
            else:
                reason = mic.last_error or "mic recorder unavailable"
                self._log_event("mic_recording_failed", level="ERROR", fields={"reason": reason})
                self._active_warnings.append(f"Mic recorder unavailable: {reason}")

        focus_snapshot = self._focus_tracker.snapshot().as_dict() if self._focus_tracker else None
        snapshot = build_mapprobe_snapshot(
            map_id,
            self._process_snapshot,
            "running",
            started_at=self._run_start_ts,
            focus_summary=focus_snapshot,
        )
        write_json(run_dir / "mapprobe_snapshot.json", snapshot, overwrite=False)
        self._last_action = f"Run started ({map_id})"
        return run_dir

    def stop_run(self) -> Path:
        if self._current_run_dir is None:
            raise RuntimeError("No active run to stop.")
        run_dir = self._current_run_dir
        self._log_event("run_stopping")

        self._capture_perception_frame("end")

        input_events = 0
        input_focus_filtered = 0
        if self._input_recorder:
            recorder = self._input_recorder
            recorder.stop()
            input_events = recorder.event_count
            input_focus_filtered = recorder.focus_filtered_events
            self._log_event(
                "input_recording_stopped",
                fields={"events": input_events, "focus_filtered": input_focus_filtered},
            )
            self._input_recorder = None

        mic_meta: Dict[str, object] = {"enabled": False, "recorded_seconds": 0.0, "reason": "mic recording disabled"}
        if self._mic_recorder:
            mic_meta = self._mic_recorder.stop()
            self._log_event("mic_recording_stopped", fields={"duration": mic_meta.get("recorded_seconds", 0.0)})
            self._mic_recorder = None

        focus_summary = self._stop_focus_tracker()

        stop_ts = time.time()
        duration = stop_ts - self._run_start_ts if self._run_start_ts else 0.0
        warnings = list(self._active_warnings)
        if not self._connected:
            warnings.append("BABYLON not attached during run")
        if self._record_input_requested and input_events == 0:
            focus_note = ""
            if input_focus_filtered:
                focus_note = f" Focus filter suppressed {input_focus_filtered} out-of-focus events."
            warnings.append("Input capture enabled but recorded 0 events. Check elevation/focus diagnostics." + focus_note)
        if not any(item.get("status") == "captured" for item in self._screenshot_results):
            warnings.append("Screenshots not captured. Desktop capture permissions may be missing.")

        diagnostics = self._environment_snapshot or {"is_elevated": False}

        summary = build_run_summary(
            map_id=self._map_id,
            exe_path=self._babylon_exe_path or str(self._process_snapshot.get("exe", "unknown")),
            duration_seconds=duration,
            process_snapshot=self._process_snapshot,
            screenshot_descriptors=self._screenshot_results,
            input_events=input_events,
            input_focus_filtered=input_focus_filtered,
            input_enabled=self._record_input_requested,
            mic_meta=mic_meta,
            warnings=warnings,
            diagnostics=diagnostics,
            focus_summary=focus_summary,
            perception_adapter=self._perception.describe(),
            movement_deltas=[delta.as_dict() for delta in self._movement_deltas],
            action_layer=self._action_interface.describe(),
        )
        write_json(run_dir / "run_summary.json", summary, overwrite=False)

        snapshot = build_mapprobe_snapshot(
            self._map_id,
            self._process_snapshot,
            "stopped",
            started_at=self._run_start_ts,
            stopped_at=stop_ts,
            focus_summary=focus_summary,
        )
        write_json(run_dir / "mapprobe_snapshot.json", snapshot)

        if self._run_meta_path:
            self._run_meta.update(
                {
                    "stopped_at": iso_timestamp(stop_ts),
                    "duration_seconds": round(duration, 2),
                    "process_snapshot": self._process_snapshot,
                    "diagnostics": diagnostics,
                    "focus": focus_summary,
                    "input_events": input_events,
                    "input_focus_filtered_events": input_focus_filtered,
                    "mic_recorded_seconds": mic_meta.get("recorded_seconds", 0.0),
                    "perception_adapter": self._perception.describe(),
                    "movement": [delta.as_dict() for delta in self._movement_deltas],
                    "action_layer": self._action_interface.describe(),
                },
            )
            write_json(self._run_meta_path, self._run_meta)

        self._assert_required_artifacts(run_dir)

        self._log_event("run_stopped", fields={"duration": round(duration, 2)})
        self._last_review = {
            "map_id": self._map_id,
            "duration_seconds": round(duration, 2),
            "input_events": input_events,
            "input_detected": input_events > 0,
            "screenshots": list(self._screenshot_results),
            "warnings": warnings,
            "run_dir": str(run_dir),
            "timestamp": iso_timestamp(stop_ts),
        }
        finished_dir = self._current_run_dir
        self._current_run_dir = None
        self._run_start_ts = None
        self._last_action = "Run stopped"
        self._action_interface.disarm()
        self._awaiting_recovery = False
        return finished_dir

    def open_last_run_folder(self) -> None:
        if self._last_run_dir is None:
            raise RuntimeError("No run folder exists yet.")
        os.startfile(self._last_run_dir)  # type: ignore[attr-defined]
        self._last_action = "Opened run folder"

    def open_logs_folder(self) -> None:
        root = self.artifacts_root
        os.startfile(root)  # type: ignore[attr-defined]
        self._last_action = "Opened artifacts folder"

    # -----------------
    # Reporting helpers
    # -----------------
    def status_snapshot(self) -> RunStatus:
        return RunStatus(
            run_dir=self._current_run_dir,
            last_action=self._last_action,
            connection_status="Connected" if self._connected else self._process_snapshot.get("reason", "Not connected"),
            pid=self._process_snapshot.get("pid"),
            exe_path=self._process_snapshot.get("exe") or self._babylon_exe_path,
            artifacts_root=self.artifacts_root,
            duration_seconds=self.current_duration_seconds,
        )

    def set_perception_adapter(self, adapter: Optional[BasePerceptionAdapter]) -> None:
        self._perception = adapter or UnityWindowPerception()
        if self._babylon_exe_path:
            self._perception.bind_target(self._babylon_exe_path)

    def set_action_interface(self, interface: Optional[ActionInterface]) -> None:
        self._action_interface = interface or DisabledActionInterface()
        self._bind_action_logger(self._action_interface)
        self._action_interface.disarm()

    def action_layer_descriptor(self) -> Dict[str, Any]:
        return self._action_interface.describe()

    def _bind_action_logger(self, interface: ActionInterface) -> None:
        interface.bind_logger(self._handle_action_guardrail_event)

    def _handle_action_guardrail_event(self, event: str, fields: Dict[str, Any]) -> None:
        level = "WARNING" if "denied" in event else "INFO"
        self._log_event(event, level=level, fields=fields)
        if level == "WARNING":
            self._active_warnings.append(f"Action layer guardrail: {event}")
        operator = fields.get("operator") if isinstance(fields, dict) else None
        descriptor = event.replace("_", " ").title()
        if operator:
            self._last_action = f"{descriptor} ({operator})"
        else:
            self._last_action = descriptor

    @property
    def is_running(self) -> bool:
        return self._current_run_dir is not None

    @property
    def last_run_dir(self) -> Optional[Path]:
        return self._last_run_dir

    @property
    def artifacts_root(self) -> Path:
        self._artifacts_root.mkdir(parents=True, exist_ok=True)
        return self._artifacts_root

    @property
    def current_duration_seconds(self) -> float:
        if not self._run_start_ts:
            return 0.0
        return max(0.0, time.time() - self._run_start_ts)

    @property
    def process_snapshot(self) -> Dict[str, object]:
        return self._process_snapshot

    @property
    def last_review(self) -> Dict[str, Any]:
        return deepcopy(self._last_review)

    def clear_last_review(self) -> None:
        self._last_review = {}

    def _log_event(self, event: str, *, level: str = "INFO", fields: Optional[Dict[str, object]] = None) -> None:
        if self._current_run_dir:
            write_event(self._current_run_dir, event, level=level, fields=fields)

    def _assert_required_artifacts(self, run_dir: Path) -> None:
        required = ["run_meta.json", "run_summary.json", "mapprobe_snapshot.json"]
        missing = [name for name in required if not (run_dir / name).exists()]
        if missing:
            self._log_event("artifact_missing", level="ERROR", fields={"missing": missing})
            raise RuntimeError(f"Artifact set incomplete for {run_dir.name}: missing {', '.join(missing)}")

    def _process_fields(self, *, include_reason: bool = False) -> Dict[str, object]:
        snapshot = self._process_snapshot
        fields: Dict[str, object] = {"status": snapshot.get("status", "unknown")}
        if snapshot.get("pid"):
            fields["pid"] = snapshot["pid"]
        if snapshot.get("name"):
            fields["name"] = snapshot["name"]
        if snapshot.get("exe"):
            fields["exe"] = snapshot["exe"]
        if include_reason and snapshot.get("reason"):
            fields["reason"] = snapshot["reason"]
        return fields

    def _capture_perception_frame(self, label: str) -> None:
        if not self._current_run_dir:
            return
        if not self._connected:
            screenshot = ScreenshotResult(label=label, path=None, status="no_data", reason="window_not_connected")
            frame = PerceptionFrame(label=label, timestamp=iso_timestamp(), screenshot=screenshot, frame_hash=None)
        else:
            frame = self._perception.capture_frame(self._current_run_dir, label)
        result = frame.screenshot
        self._screenshot_results.append(result.as_dict())
        delta = self._perception.detect_delta(self._last_perception_frame, frame)
        self._movement_deltas.append(delta)
        self._prune_history()
        if result.status == "captured" and result.path:
            self._log_event("screenshot_saved", fields={"label": label, "path": str(result.path)})
        else:
            self._log_event(
                "screenshot_missing",
                level="WARNING",
                fields={"label": label, "reason": result.reason or "capture_failed"},
            )
        if delta.status == "delta":
            self._log_event("movement_delta", fields={"label": label, "changed": delta.changed})
        self._last_perception_frame = frame

    def _prune_history(self, *, limit: int = 64) -> None:
        if len(self._screenshot_results) > limit:
            self._screenshot_results = self._screenshot_results[-limit:]
        if len(self._movement_deltas) > limit:
            self._movement_deltas = self._movement_deltas[-limit:]

    def _update_input_focus_gate(self, snapshot: Dict[str, Any], process_hint: str) -> None:
        if not self._input_focus_gate:
            return
        exe_hint = snapshot.get("exe") or process_hint or self._babylon_exe_path
        self._input_focus_gate.update_target(snapshot.get("pid"), exe_hint)

    def _stop_focus_tracker(self) -> Dict[str, Any]:
        if not self._focus_tracker:
            return {"supported": False}
        summary = self._focus_tracker.stop().as_dict()
        self._focus_tracker = None
        return summary


def update_saved_state(new_state: config.AppState, *, profile_name: Optional[str] = None) -> None:
    config.save_state(new_state, profile_name=profile_name)
