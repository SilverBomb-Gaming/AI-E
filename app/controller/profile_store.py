"""Persistent non-secret controller settings."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

from ..platform import get_platform_adapter
from ..platform.base import BasePlatformAdapter
from .channel_models import TelegramChannelStatus


Mode = Literal["offline", "online"]
Policy = Literal["always_offline", "ask_before_online", "always_online"]
ProviderType = Literal["ollama", "openai"]


def _default_repo_root() -> str:
    return str(Path(__file__).resolve().parents[2])


@dataclass
class ControllerConfig:
    schema_version: int = 5
    current_mode: Mode = "offline"
    selected_mode: Mode = "offline"
    selected_provider: ProviderType = "ollama"
    policy: Policy = "ask_before_online"
    gateway_bind: str = "loopback"
    gateway_port: int = 18789
    preferred_ollama_model: str = ""
    ollama_base_url: str = "http://127.0.0.1:11434"
    repo_root: str = field(default_factory=_default_repo_root)
    file_allowed_roots: tuple[str, ...] = ()
    openai_secret_id: str = "openai/default"
    openai_key_masked: str = ""
    openai_has_secret: bool = False
    telegram_secret_id: str = "telegram/default"
    telegram_last_processed_update_id: int = 0
    telegram_status: TelegramChannelStatus = field(default_factory=TelegramChannelStatus)
    last_provider_statuses: dict[str, dict[str, Any]] = field(default_factory=dict)


class ControllerConfigStore:
    def __init__(self, platform_adapter: BasePlatformAdapter | None = None, *, config_path: str | Path | None = None) -> None:
        self._platform = platform_adapter or get_platform_adapter()
        default_path = Path(self._platform.controller_state_dir()) / "controller_config.json"
        self._config_path = Path(config_path or default_path)
        self._config_path.parent.mkdir(parents=True, exist_ok=True)
        self.last_load_error = ""
        self.last_save_error = ""

    @property
    def path(self) -> Path:
        return self._config_path

    def load(self) -> ControllerConfig:
        if not self._config_path.exists():
            config = ControllerConfig()
            self.save(config)
            self.last_load_error = ""
            return config
        try:
            raw = json.loads(self._config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError, ValueError) as exc:
            config = ControllerConfig()
            self.save(config)
            self.last_load_error = str(exc)
            return config
        if not isinstance(raw, dict):
            config = ControllerConfig()
            self.save(config)
            self.last_load_error = "Controller config file did not contain a JSON object."
            return config
        self.last_load_error = ""
        return self._from_payload(raw)

    def save(self, config: ControllerConfig) -> None:
        try:
            self._config_path.write_text(json.dumps(asdict(config), indent=2), encoding="utf-8")
            self.last_save_error = ""
        except OSError as exc:
            self.last_save_error = str(exc)
            raise

    def _from_payload(self, raw: dict[str, Any]) -> ControllerConfig:
        last_provider_statuses = raw.get("last_provider_statuses")
        if not isinstance(last_provider_statuses, dict):
            last_provider_statuses = {}
        return ControllerConfig(
            schema_version=int(raw.get("schema_version", 5)),
            current_mode=str(raw.get("current_mode", "offline")),  # type: ignore[arg-type]
            selected_mode=str(raw.get("selected_mode", raw.get("current_mode", "offline"))),  # type: ignore[arg-type]
            selected_provider=str(raw.get("selected_provider", "ollama")),  # type: ignore[arg-type]
            policy=str(raw.get("policy", "ask_before_online")),  # type: ignore[arg-type]
            gateway_bind=str(raw.get("gateway_bind", "loopback")),
            gateway_port=int(raw.get("gateway_port", 18789)),
            preferred_ollama_model=str(raw.get("preferred_ollama_model", "")),
            ollama_base_url=str(raw.get("ollama_base_url", "http://127.0.0.1:11434")),
            repo_root=str(raw.get("repo_root", _default_repo_root())),
            file_allowed_roots=tuple(
                str(item).strip()
                for item in raw.get("file_allowed_roots", [])
                if str(item).strip()
            ),
            openai_secret_id=str(raw.get("openai_secret_id", "openai/default")),
            openai_key_masked=str(raw.get("openai_key_masked", "")),
            openai_has_secret=bool(raw.get("openai_has_secret", False)),
            telegram_secret_id=str(raw.get("telegram_secret_id", "telegram/default")),
            telegram_last_processed_update_id=int(raw.get("telegram_last_processed_update_id", 0)),
            telegram_status=TelegramChannelStatus.from_payload(raw.get("telegram_status")),
            last_provider_statuses={str(key): value for key, value in last_provider_statuses.items() if isinstance(value, dict)},
        )
