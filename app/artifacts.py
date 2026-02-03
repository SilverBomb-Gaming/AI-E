"""Artifact helpers for AI-E runs."""
from __future__ import annotations

import json
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

import psutil


def iso_timestamp(epoch_seconds: Optional[float] = None) -> str:
    ts = epoch_seconds if epoch_seconds is not None else time.time()
    return datetime.utcfromtimestamp(ts).isoformat(timespec="seconds") + "Z"


def write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def take_screenshot(run_dir: Path, label: str) -> Optional[Path]:
    try:
        import mss
    except Exception:  # noqa: BLE001 - optional dependency failures handled by caller
        return None

    output = run_dir / f"screenshot_{label}.png"
    try:
        with mss.mss() as sct:
            sct.shot(mon=-1, output=str(output))
        return output
    except Exception:  # noqa: BLE001
        if output.exists():
            output.unlink(missing_ok=True)
        return None


def build_process_snapshot(process_hint: str) -> Dict[str, Any]:
    if not process_hint:
        return {"status": "no_hint", "reason": "BABYLON exe path not set"}

    target_name = Path(process_hint).name.lower()
    if not target_name:
        return {"status": "invalid_hint", "reason": "Executable name missing"}

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
) -> Dict[str, Any]:
    return {
        "requested_map": map_id,
        "map_confirmed": process_snapshot.get("map_confirmed", "unknown"),
        "run_state": run_state,
        "connection": {
            "status": process_snapshot.get("status", "unknown"),
            "connected": process_snapshot.get("status") == "connected",
        },
        "process": process_snapshot,
        "heartbeat": {
            "started_at": iso_timestamp(started_at) if started_at else None,
            "last_update": iso_timestamp(stopped_at if stopped_at else time.time()),
        },
        "camera_state": "unavailable",
    }


def build_run_summary(
    *,
    map_id: str,
    exe_path: str,
    duration_seconds: float,
    process_snapshot: Dict[str, Any],
    screenshot_count: int,
    input_events: int,
    mic_meta: Dict[str, Any],
    warnings: list[str],
) -> Dict[str, Any]:
    return {
        "version": "v0.2",
        "map_id": map_id,
        "exe_path": exe_path,
        "duration_seconds": round(duration_seconds, 2),
        "attach_method": process_snapshot.get("match_strategy", "process_name"),
        "attach_status": process_snapshot.get("status", "unknown"),
        "artifact_counts": {
            "screenshots": screenshot_count,
            "input_events": input_events,
            "audio_seconds": mic_meta.get("recorded_seconds", 0.0),
        },
        "mic": mic_meta,
        "warnings": warnings,
        "timestamp": iso_timestamp(),
    }
