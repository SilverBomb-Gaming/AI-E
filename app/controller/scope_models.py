"""Execution scope models for capability sandboxing."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Tuple


ScopeAccessMode = Literal["read", "write", "execute"]
ScopeType = Literal["internal", "filesystem", "repository", "network"]


@dataclass(frozen=True)
class ExecutionScope:
    repo_root: str = ""
    allowed_paths: Tuple[str, ...] = ()
    target_path: str = ""
    domain_allowlist: Tuple[str, ...] = ()
    target_domain: str = ""
    access_mode: ScopeAccessMode = "read"
    scope_type: ScopeType = "internal"


@dataclass(frozen=True)
class ScopeValidationResult:
    allowed: bool
    reason_code: str
    message: str
    scope_summary: str
