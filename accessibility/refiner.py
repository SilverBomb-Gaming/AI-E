from __future__ import annotations

from accessibility.schemas import ClarificationNeededError, IngestionRequest


def refine_request(parsed: IngestionRequest) -> IngestionRequest:
    if parsed.requires_clarification or parsed.source in {"", "UNKNOWN"}:
        question = parsed.clarification_question or "What source should I ingest? Provide a URL, domain, or local file path."
        raise ClarificationNeededError(question, partial_request=parsed)

    return parsed
