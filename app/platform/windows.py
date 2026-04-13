"""Windows-first process helpers."""
from __future__ import annotations

import os
import subprocess
from typing import Mapping, Sequence

from .base import BasePlatformAdapter


class WindowsPlatformAdapter(BasePlatformAdapter):
    platform_name = "windows"

    def user_config_root(self) -> str:
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            return self.normalize_path(local_app_data)
        return self.normalize_path("~\\AppData\\Local")

    def spawn_process(
        self,
        command: Sequence[str],
        *,
        cwd: str | None = None,
        env: Mapping[str, str] | None = None,
    ) -> subprocess.Popen[str]:
        creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "CREATE_NO_WINDOW", 0)
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
            creationflags=creationflags,
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
