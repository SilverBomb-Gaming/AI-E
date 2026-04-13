"""Session-scoped generated project metadata for isolated scaffold targets."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


GeneratedProjectStatus = Literal["proposed", "created", "active"]


@dataclass(frozen=True)
class GeneratedProjectRecord:
    project_id: str
    project_type: str
    project_root: str
    entrypoint_path: str = ""
    created_at_utc: str = ""
    status: GeneratedProjectStatus = "active"

    def to_payload(self) -> dict[str, str]:
        return {
            "project_id": self.project_id,
            "project_type": self.project_type,
            "project_root": self.project_root,
            "entrypoint_path": self.entrypoint_path,
            "created_at_utc": self.created_at_utc,
            "status": self.status,
        }