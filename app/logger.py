"""Structured run event logging helpers."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, Optional


def _timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def write_event(run_dir: Path, event: str, *, level: str = "INFO", fields: Optional[Dict[str, object]] = None) -> None:
    """Append a timestamped line to events.log inside run_dir."""
    events_path = run_dir / "events.log"
    payload = ""
    if fields:
        kv_pairs = [f"{key}={value}" for key, value in fields.items()]
        payload = " | " + " ".join(kv_pairs)
    line = f"{_timestamp()} | {level} | {event}{payload}\n"
    with events_path.open("a", encoding="utf-8") as handle:
        handle.write(line)
