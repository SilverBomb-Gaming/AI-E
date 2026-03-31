"""Persist simple operator preferences across sessions."""
from __future__ import annotations

import json
from dataclasses import dataclass, asdict, fields
from typing import Any, Dict, List, Optional

from .paths import APP_STATE_EXAMPLE_PATH, APP_STATE_PATH, PROJECT_ROOT


@dataclass
class AppState:
    babylon_exe_path: str = ""
    last_selected_map: str = "001"
    record_input: bool = False
    record_mic: bool = False
    push_to_talk: bool = False
    active_project_name: str = ""
    active_project_path: str = ""
    staged_prompt: str = ""


DEFAULT_PROFILE = "default"


def _default_state() -> AppState:
    return AppState()


def _state_from_payload(payload: Dict[str, Any]) -> AppState:
    state = _default_state()
    for field in fields(AppState):
        if field.name in payload:
            setattr(state, field.name, payload[field.name])
    return state


def _new_profiles_blob() -> Dict[str, Any]:
    return {
        "active_profile": DEFAULT_PROFILE,
        "profiles": {DEFAULT_PROFILE: asdict(_default_state())},
    }


def _default_profiles_blob() -> Dict[str, Any]:
    if APP_STATE_EXAMPLE_PATH.exists():
        try:
            raw = json.loads(APP_STATE_EXAMPLE_PATH.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, TypeError, ValueError):
            raw = None
        if isinstance(raw, dict):
            if "profiles" not in raw:
                state = _state_from_payload(raw)
                return {"active_profile": DEFAULT_PROFILE, "profiles": {DEFAULT_PROFILE: asdict(state)}}

            profiles_section = raw.get("profiles") or {}
            sanitized: Dict[str, Dict[str, Any]] = {}
            for name, payload in profiles_section.items():
                if isinstance(name, str) and isinstance(payload, dict):
                    sanitized[name] = asdict(_state_from_payload(payload))

            if sanitized:
                active = raw.get("active_profile") or DEFAULT_PROFILE
                if active not in sanitized:
                    active = DEFAULT_PROFILE
                return {"active_profile": active, "profiles": sanitized}

    return _new_profiles_blob()


def _ensure_local_profiles_blob() -> Dict[str, Any]:
    if APP_STATE_PATH.exists():
        return {}
    blob = _default_profiles_blob()
    APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
    return blob


def _load_profiles_blob() -> Dict[str, Any]:
    created_blob = _ensure_local_profiles_blob()
    if created_blob:
        return created_blob
    if not APP_STATE_PATH.exists():
        blob = _default_profiles_blob()
        APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
        return blob
    try:
        raw = json.loads(APP_STATE_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, TypeError, ValueError):
        blob = _default_profiles_blob()
        APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
        return blob

    if not isinstance(raw, dict):
        blob = _default_profiles_blob()
        APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
        return blob

    if "profiles" not in raw:
        # Legacy single-profile file: treat entire payload as default profile state.
        state = _state_from_payload(raw)
        blob = {"active_profile": DEFAULT_PROFILE, "profiles": {DEFAULT_PROFILE: asdict(state)}}
        APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
        return blob

    profiles_section = raw.get("profiles") or {}
    sanitized: Dict[str, Dict[str, Any]] = {}
    for name, payload in profiles_section.items():
        if isinstance(name, str) and isinstance(payload, dict):
            sanitized[name] = asdict(_state_from_payload(payload))

    if not sanitized:
        sanitized[DEFAULT_PROFILE] = asdict(_default_state())

    active = raw.get("active_profile") or DEFAULT_PROFILE
    if active not in sanitized:
        active = DEFAULT_PROFILE

    blob = {"active_profile": active, "profiles": sanitized}
    APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")
    return blob


def _write_profiles_blob(blob: Dict[str, Any]) -> None:
    APP_STATE_PATH.write_text(json.dumps(blob, indent=2), encoding="utf-8")


def list_profiles() -> List[str]:
    blob = _load_profiles_blob()
    return sorted(blob.get("profiles", {}).keys())


def get_active_profile_name() -> str:
    blob = _load_profiles_blob()
    return blob.get("active_profile", DEFAULT_PROFILE)


def set_active_profile(profile_name: str) -> AppState:
    blob = _load_profiles_blob()
    profiles = blob.setdefault("profiles", {})
    if profile_name not in profiles:
        profiles[profile_name] = asdict(_default_state())
    blob["active_profile"] = profile_name
    _write_profiles_blob(blob)
    return _state_from_payload(profiles[profile_name])


def load_state(profile_name: Optional[str] = None) -> AppState:
    blob = _load_profiles_blob()
    active_name = profile_name or blob.get("active_profile", DEFAULT_PROFILE)
    profiles = blob.get("profiles", {})
    if active_name not in profiles:
        active_name = DEFAULT_PROFILE
        if active_name not in profiles:
            profiles[active_name] = asdict(_default_state())
            blob["profiles"] = profiles
            blob["active_profile"] = active_name
            _write_profiles_blob(blob)
    return _state_from_payload(profiles[active_name])


def save_state(state: AppState, profile_name: Optional[str] = None) -> None:
    blob = _load_profiles_blob()
    name = profile_name or blob.get("active_profile", DEFAULT_PROFILE)
    blob.setdefault("profiles", {})[name] = asdict(state)
    blob["active_profile"] = name
    _write_profiles_blob(blob)


def ensure_profile(profile_name: str, *, initial_state: Optional[AppState] = None) -> AppState:
    blob = _load_profiles_blob()
    profiles = blob.setdefault("profiles", {})
    if profile_name not in profiles:
        profiles[profile_name] = asdict(initial_state or _default_state())
        blob["active_profile"] = profile_name
        _write_profiles_blob(blob)
    return _state_from_payload(profiles[profile_name])


def profile_storage_hint() -> str:
    return str(APP_STATE_PATH)


def describe_environment() -> Dict[str, Any]:
    blob = _load_profiles_blob()
    return {
        "project_root": str(PROJECT_ROOT),
        "state_file": str(APP_STATE_PATH),
        "active_profile": blob.get("active_profile", DEFAULT_PROFILE),
        "profiles": list(blob.get("profiles", {}).keys()),
    }
