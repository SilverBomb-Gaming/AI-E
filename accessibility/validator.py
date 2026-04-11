from __future__ import annotations

from pathlib import Path

from accessibility.schemas import ClarificationNeededError, IngestionRequest


def _looks_like_local_path(value: str) -> bool:
    candidate = Path(value)
    return bool(candidate.suffix) or any(separator in value for separator in {"\\", "/"})


def validate_request(req: IngestionRequest) -> bool:
    if req.requires_clarification or not req.source:
        raise ClarificationNeededError(
            req.clarification_question or "More information is required before ingestion can continue.",
            partial_request=req,
        )

    if req.allow_local and _looks_like_local_path(req.source):
        return True

    if not req.source.startswith(("http://", "https://")):
        raise ValueError("Invalid source format.")

    return True
