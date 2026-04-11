from __future__ import annotations

from accessibility.schemas import IngestionRequest


def refine_request(parsed: IngestionRequest) -> IngestionRequest:
    if parsed.source == "UNKNOWN":
        raise ValueError("Could not determine source. Ask user for clarification.")

    return parsed
