"""Docker runtime placeholder for a later milestone."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DockerRuntimeStub:
    available: bool = False
    detail: str = "Docker support is deferred until a later milestone."
