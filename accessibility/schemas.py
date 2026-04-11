from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IngestionRequest:
    source: str
    intent: str
    allow_local: bool = False
    notes: str = ""
