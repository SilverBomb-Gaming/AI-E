from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


@dataclass(frozen=True)
class IngestionRequest:
    source: str
    intent: str
    allow_local: bool = False
    notes: str = ""
    missing_fields: tuple[str, ...] = ()
    clarification_question: str = ""

    @property
    def requires_clarification(self) -> bool:
        return bool(self.missing_fields)


class ClarificationNeededError(ValueError):
    def __init__(self, message: str, *, partial_request: IngestionRequest) -> None:
        super().__init__(message)
        self.partial_request = partial_request

    def to_payload(self) -> dict[str, Any]:
        return {
            "status": "needs_clarification",
            "message": str(self),
            "question": self.partial_request.clarification_question or str(self),
            "partial_request": request_to_payload(self.partial_request),
        }


def request_to_payload(request: IngestionRequest) -> dict[str, Any]:
    payload = asdict(request)
    payload["missing_fields"] = list(request.missing_fields)
    payload["requires_clarification"] = request.requires_clarification
    return payload


def request_from_payload(payload: Mapping[str, Any]) -> IngestionRequest:
    return IngestionRequest(
        source=str(payload.get("source", "")),
        intent=str(payload.get("intent", "unknown")),
        allow_local=bool(payload.get("allow_local", False)),
        notes=str(payload.get("notes", "")),
        missing_fields=tuple(str(item) for item in payload.get("missing_fields", []) if str(item)),
        clarification_question=str(payload.get("clarification_question", "")),
    )
