"""Platform abstractions for runtime control."""
from __future__ import annotations

import os

from .base import BasePlatformAdapter
from .linux import LinuxPlatformAdapter
from .windows import WindowsPlatformAdapter


def get_platform_adapter() -> BasePlatformAdapter:
    if os.name == "nt":
        return WindowsPlatformAdapter()
    return LinuxPlatformAdapter()


__all__ = ["BasePlatformAdapter", "get_platform_adapter", "LinuxPlatformAdapter", "WindowsPlatformAdapter"]
