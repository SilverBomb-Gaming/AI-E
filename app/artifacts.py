"""Artifact helpers for AI-E runs."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import psutil
except ImportError:  # pragma: no cover - optional dependency
    psutil = None  # type: ignore[assignment]


def iso_timestamp(epoch_seconds: Optional[float] = None) -> str:
    ts = epoch_seconds if epoch_seconds is not None else time.time()
    return datetime.utcfromtimestamp(ts).isoformat(timespec="seconds") + "Z"


def write_json(path: Path, payload: Dict[str, Any], *, overwrite: bool = True) -> None:
    if not overwrite and path.exists():
        raise FileExistsError(f"Refusing to overwrite existing artifact: {path}")
    try:
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError as exc:  # pragma: no cover - surfaced to caller
        raise RuntimeError(f"Failed to write artifact {path}: {exc}") from exc


@dataclass
class ScreenshotResult:
    label: str
    path: Optional[Path]
    status: str
    reason: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {"label": self.label, "status": self.status}
        if self.path:
            data["path"] = str(self.path)
        if self.reason:
            data["reason"] = self.reason
        return data


def take_screenshot(run_dir: Path, label: str) -> ScreenshotResult:
    try:
        import mss
    except Exception as exc:  # noqa: BLE001 - optional dependency failures handled by caller
        return ScreenshotResult(label=label, path=None, status="no_data", reason=str(exc) or "mss_unavailable")

    output = run_dir / f"screenshot_{label}.png"
    try:
        with mss.mss() as sct:
            sct.shot(mon=-1, output=str(output))
        return ScreenshotResult(label=label, path=output, status="captured")
    except Exception as exc:  # noqa: BLE001
        if output.exists():
            output.unlink(missing_ok=True)
        return ScreenshotResult(label=label, path=None, status="no_data", reason=str(exc) or "capture_failed")


def no_data(reason: str) -> Dict[str, Any]:
    return {"status": "no_data", "reason": reason}


def build_process_snapshot(process_hint: str) -> Dict[str, Any]:
    if not process_hint:
        return {"status": "no_hint", "reason": "BABYLON exe path not set"}

    target_name = Path(process_hint).name.lower()
    if not target_name:
        return {"status": "invalid_hint", "reason": "Executable name missing"}

    if psutil is None:  # type: ignore[truthy-bool]
        return {
            "status": "psutil_missing",
            "reason": "psutil is not installed. Attach diagnostics unavailable.",
        }

    for proc in psutil.process_iter(["pid", "name", "exe", "create_time", "status"]):
        try:
            name = (proc.info.get("name") or "").lower()
            exe_name = Path(proc.info.get("exe") or "").name.lower()
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        if name == target_name or exe_name == target_name:
            try:
                with proc.oneshot():
                    snapshot = {
                        "status": "connected",
                        "pid": proc.pid,
                        "name": proc.info.get("name"),
                        "exe": proc.info.get("exe"),
                        "create_time": proc.info.get("create_time"),
                        "match_strategy": "process_name",
                        "map_confirmed": "unknown",
                    }
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                break
            return snapshot

    return {
        "status": "not_running",
        "reason": f"No process matches {target_name}",
        "match_strategy": "process_name",
    }


def build_mapprobe_snapshot(
    map_id: str,
    process_snapshot: Dict[str, Any],
    run_state: str,
    *,
    started_at: Optional[float],
    stopped_at: Optional[float] = None,
    focus_summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    status = process_snapshot.get("status", "unknown")
    snapshot = {
        "requested_map": map_id,
        "map_confirmed": process_snapshot.get("map_confirmed", "unknown"),
        "run_state": run_state,
        "data_status": "ok" if status == "connected" else "no_data",
        "connection": {
            "status": status,
            "connected": status == "connected",
            "reason": process_snapshot.get("reason"),
        },
        "process": process_snapshot,
        "heartbeat": {
            "started_at": iso_timestamp(started_at) if started_at else None,
            "last_update": iso_timestamp(stopped_at if stopped_at else time.time()),
        },
        "camera_state": "unavailable",
    }
    if focus_summary:
        snapshot["focus"] = focus_summary
    return snapshot


def build_run_summary(
    *,
    map_id: str,
    exe_path: str,
    duration_seconds: float,
    process_snapshot: Dict[str, Any],
    screenshot_descriptors: List[Dict[str, Any]],
    input_events: int,
    input_focus_filtered: int,
    input_enabled: bool,
    mic_meta: Dict[str, Any],
    warnings: list[str],
    diagnostics: Dict[str, Any],
    focus_summary: Dict[str, Any],
    perception_adapter: str,
    movement_deltas: List[Dict[str, Any]],
    action_layer: Dict[str, Any],
) -> Dict[str, Any]:
    screenshot_count = sum(1 for item in screenshot_descriptors if item.get("status") == "captured")
    screenshot_section: Dict[str, Any] = {
        "count": screenshot_count,
        "status": "ok" if screenshot_count else "no_data",
        "items": screenshot_descriptors,
    }
    if screenshot_count == 0:
        reasons = [item.get("reason") for item in screenshot_descriptors if item.get("reason")]
        screenshot_section.update(no_data("; ".join(reasons) if reasons else "screenshot_not_available"))

    input_section: Dict[str, Any] = {
        "enabled": input_enabled,
        "events": input_events,
    }
    if input_focus_filtered:
        input_section["focus_filtered_events"] = input_focus_filtered
    if not input_enabled:
        input_section["status"] = "skipped"
        input_section["reason"] = "input capture disabled"
    elif input_events == 0:
        input_section.update(
            no_data("0 input events captured. Ensure BABYLON window is focused and AI-E is running elevated."),
        )
    else:
        input_section["status"] = "ok"

    audio_status = "ok" if mic_meta.get("recorded_seconds", 0.0) > 0 else "no_data"
    audio_section: Dict[str, Any] = {"status": audio_status, "details": mic_meta}
    if audio_status == "no_data" and "reason" not in mic_meta:
        audio_section["details"] = {**mic_meta, **no_data("Mic recording disabled or captured 0 seconds.")}

    run_status = "ok" if process_snapshot.get("status") == "connected" else "attention"

    return {
        "version": "v0.2",
        "map_id": map_id,
        "exe_path": exe_path,
        "duration_seconds": round(duration_seconds, 2),
        "attach_method": process_snapshot.get("match_strategy", "process_name"),
        "attach_status": process_snapshot.get("status", "unknown"),
        "artifacts": {
            "screenshots": screenshot_section,
            "input": input_section,
            "audio": audio_section,
        },
        "perception": {
            "adapter": perception_adapter,
            "frames": len(screenshot_descriptors),
            "movement": movement_deltas,
        },
        "action_layer": action_layer,
        "warnings": warnings,
        "diagnostics": diagnostics,
        "focus": focus_summary,
        "status": run_status,
        "timestamp": iso_timestamp(),
    }
