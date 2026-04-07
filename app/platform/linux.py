"""Linux compatibility stub for a later portability pass."""
from __future__ import annotations

import os
import subprocess
from typing import Mapping, Sequence

from .base import BasePlatformAdapter


class LinuxPlatformAdapter(BasePlatformAdapter):
    platform_name = "linux"

    def user_config_root(self) -> str:
        xdg_config = os.environ.get("XDG_CONFIG_HOME")
        if xdg_config:
            return self.normalize_path(xdg_config)
        return self.normalize_path("~/.config")

    def spawn_process(
        self,
        command: Sequence[str],
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> subprocess.Popen[str]:
        return subprocess.Popen(
            list(command),
            cwd=cwd,
            env=self._merge_env(env),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            start_new_session=True,
        )

    def stop_process(self, process: subprocess.Popen[str], *, timeout_seconds: float = 10.0) -> None:
        if process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=timeout_seconds)
