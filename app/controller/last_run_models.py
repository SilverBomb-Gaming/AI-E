"""Session-scoped record for the most recent approved run result."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LastRunRecord:
    command_label: str
    target_root: str | None
    entrypoint_path: str | None
    argv: list[str]
    exit_code: int | None
    stdout_preview: str
    stderr_preview: str
    summary: str
    created_at_utc: str
    is_patch_relevant: bool

    def to_payload(self) -> dict[str, object]:
        return {
            "command_label": self.command_label,
            "target_root": self.target_root,
            "entrypoint_path": self.entrypoint_path,
            "argv": list(self.argv),
            "exit_code": self.exit_code,
            "stdout_preview": self.stdout_preview,
            "stderr_preview": self.stderr_preview,
            "summary": self.summary,
            "created_at_utc": self.created_at_utc,
            "is_patch_relevant": self.is_patch_relevant,
        }