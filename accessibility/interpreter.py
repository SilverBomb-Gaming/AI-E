from __future__ import annotations

import re

from accessibility.schemas import IngestionRequest


_DOMAIN_PATTERN = re.compile(
    r"(?P<domain>(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?P<path>/[^\s]*)?",
    re.IGNORECASE,
)
_QUOTED_PATH_PATTERN = re.compile(r'"(?P<path>[^"]+)"')
_WINDOWS_PATH_PATTERN = re.compile(r"(?P<path>[a-zA-Z]:\\[^\r\n\"]+)")
_RELATIVE_PATH_PATTERN = re.compile(r"(?P<path>(?:\.{1,2}[\\/]|[\w.-]+[\\/])[^\r\n\"]+)")
_DOC_KEYWORDS = {"docs", "documentation", "api", "scriptreference", "scripting", "reference"}
_INGEST_KEYWORDS = {"get", "grab", "fetch", "ingest", "load", "pull"}


def _build_partial_request(*, intent: str, notes: str, question: str, allow_local: bool = False) -> IngestionRequest:
    return IngestionRequest(
        source="",
        intent=intent,
        allow_local=allow_local,
        notes=notes,
        missing_fields=("source",),
        clarification_question=question,
    )


def _extract_local_path(text: str) -> str:
    for pattern in (_QUOTED_PATH_PATTERN, _WINDOWS_PATH_PATTERN, _RELATIVE_PATH_PATTERN):
        match = pattern.search(text)
        if not match:
            continue
        candidate = match.group("path").strip()
        if "\\" in candidate or "/" in candidate:
            return candidate
    return ""


def _intent_from_keywords(lowered: str) -> str:
    return "documentation" if any(keyword in lowered for keyword in _DOC_KEYWORDS) else "web_lookup"


def _interpret_standalone_input(user_text: str) -> IngestionRequest:
    text = user_text.strip()
    lowered = text.lower()

    local_path = _extract_local_path(text)
    if local_path:
        return IngestionRequest(
            source=local_path,
            intent="user_provided",
            allow_local=True,
            notes="Resolved a local file path from the conversational request.",
        )

    if "unity" in lowered and any(keyword in lowered for keyword in _DOC_KEYWORDS):
        return IngestionRequest(
            source="https://docs.unity3d.com/ScriptReference/",
            intent="documentation",
            notes="Mapped Unity documentation request to the Unity Script Reference.",
        )

    if "local file" in lowered:
        return _build_partial_request(
            intent="user_provided",
            allow_local=True,
            notes="Conversation indicates a local file but no path was supplied.",
            question="Which local file should I ingest? Provide a file path.",
        )

    matched_domain = _DOMAIN_PATTERN.search(lowered)
    if matched_domain:
        source = f"https://{matched_domain.group('domain')}{matched_domain.group('path') or ''}"
        return IngestionRequest(
            source=source,
            intent=_intent_from_keywords(lowered),
            notes="Derived a direct web source from the conversational request.",
        )

    if any(keyword in lowered for keyword in _DOC_KEYWORDS):
        return _build_partial_request(
            intent="documentation",
            notes="The request indicates documentation ingestion but does not identify the documentation source.",
            question="Which documentation source should I ingest? For example, say 'unity scripting api'.",
        )

    if any(keyword in lowered for keyword in _INGEST_KEYWORDS):
        return _build_partial_request(
            intent="web_lookup",
            notes="The request indicates ingestion intent but does not identify a concrete source.",
            question="What source should I ingest? Provide a URL, domain, or local file path.",
        )

    return IngestionRequest(
        source="UNKNOWN",
        intent="unknown",
        notes="Could not map the request to a supported ingestion source.",
        missing_fields=("source",),
        clarification_question="What source should I ingest? Provide a URL, domain, or local file path.",
    )


def _fill_from_previous_request(current: IngestionRequest, previous_request: IngestionRequest) -> IngestionRequest:
    if not previous_request.requires_clarification:
        return current

    merged_source = current.source or previous_request.source
    merged_intent = current.intent if current.intent != "unknown" else previous_request.intent
    merged_allow_local = current.allow_local or previous_request.allow_local
    merged_notes = " ".join(part for part in [previous_request.notes, current.notes] if part).strip()

    if current.requires_clarification and not current.source:
        return IngestionRequest(
            source=merged_source,
            intent=merged_intent,
            allow_local=merged_allow_local,
            notes=merged_notes,
            missing_fields=current.missing_fields or previous_request.missing_fields,
            clarification_question=current.clarification_question or previous_request.clarification_question,
        )

    return IngestionRequest(
        source=merged_source,
        intent=merged_intent,
        allow_local=merged_allow_local,
        notes=merged_notes,
    )


def interpret_input(user_text: str, *, previous_request: IngestionRequest | None = None) -> IngestionRequest:
    current = _interpret_standalone_input(user_text)
    if previous_request is None:
        return current
    return _fill_from_previous_request(current, previous_request)
