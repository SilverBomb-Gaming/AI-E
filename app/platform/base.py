"""Base process and path abstractions for platform-specific runtime control."""
from __future__ import annotations

import os
import shutil
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence


@dataclass(frozen=True)
class CommandDetection:
    name: str
    available: bool
    path: str = ""
    detail: str = ""


class BasePlatformAdapter(ABC):
    platform_name = "generic"
    controller_app_name = "AI-E"
    controller_product_name = "OpenClawController"

    def normalize_path(self, value: str | Path) -> str:
        path = Path(os.path.expandvars(str(value))).expanduser()
        return str(path.resolve(strict=False))

    def ensure_dir(self, value: str | Path) -> str:
        normalized = Path(self.normalize_path(value))
        normalized.mkdir(parents=True, exist_ok=True)
        return str(normalized)

    def controller_state_dir(self) -> str:
        return self.ensure_dir(Path(self.user_config_root()) / self.controller_app_name / self.controller_product_name)

    def detect_command(self, candidates: Sequence[str]) -> CommandDetection:
        for candidate in candidates:
            found = shutil.which(candidate)
            if found:
                return CommandDetection(name=candidate, available=True, path=self.normalize_path(found))
        detail = f"Checked: {', '.join(candidates)}"
        return CommandDetection(name=candidates[0], available=False, detail=detail)

    def _merge_env(self, extra_env: Mapping[str, str] | None = None) -> dict[str, str]:
        merged = dict(os.environ)
        if extra_env:
            merged.update(extra_env)
        return merged

    @abstractmethod
    def user_config_root(self) -> str:
        raise NotImplementedError

    @abstractmethod
    def spawn_process(
        self,
        command: Sequence[str],
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> subprocess.Popen[str]:
        raise NotImplementedError

    @abstractmethod
    def stop_process(self, process: subprocess.Popen[str], *, timeout_seconds: float = 10.0) -> None:
        raise NotImplementedError
