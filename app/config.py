"""Persist simple operator preferences across sessions."""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict, fields
from pathlib import Path
from typing import Any, Dict

from .paths import APP_STATE_PATH, PROJECT_ROOT


@dataclass
class AppState:
    babylon_exe_path: str = ""
    last_selected_map: str = "001"
    record_input: bool = False
    record_mic: bool = False
    push_to_talk: bool = False


def _default_state() -> AppState:
    return AppState()


def load_state() -> AppState:
    if not APP_STATE_PATH.exists():
        return _default_state()
    try:
        data = json.loads(APP_STATE_PATH.read_text(encoding="utf-8"))
        state = _default_state()
        for field in fields(AppState):
            if field.name in data:
                setattr(state, field.name, data[field.name])
        return state
    except (json.JSONDecodeError, TypeError, ValueError):
        # Fall back to safe defaults if file is corrupted.
        return _default_state()


def save_state(state: AppState) -> None:
    APP_STATE_PATH.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")


def describe_environment() -> Dict[str, Any]:
    return {
        "project_root": str(PROJECT_ROOT),
        "state_file": str(APP_STATE_PATH),
    }
