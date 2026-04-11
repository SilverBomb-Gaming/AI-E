from __future__ import annotations

import re

from accessibility.schemas import IngestionRequest


_DOMAIN_PATTERN = re.compile(
    r"(?P<domain>(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?P<path>/[^\s]*)?",
    re.IGNORECASE,
)


def interpret_input(user_text: str) -> IngestionRequest:
    text = user_text.strip()
    lowered = text.lower()

    if "unity" in lowered and any(keyword in lowered for keyword in {"docs", "documentation", "api", "scriptreference", "scripting"}):
        return IngestionRequest(
            source="https://docs.unity3d.com/ScriptReference/",
            intent="documentation",
            notes="Mapped Unity documentation request to the Unity Script Reference.",
        )

    if "local file" in lowered:
        return IngestionRequest(
            source="LOCAL_FILE_REQUIRED",
            intent="user_provided",
            allow_local=True,
            notes="Conversation indicates a local file but no path was supplied.",
        )

    matched_domain = _DOMAIN_PATTERN.search(lowered)
    if matched_domain:
        source = f"https://{matched_domain.group('domain')}{matched_domain.group('path') or ''}"
        return IngestionRequest(
            source=source,
            intent="web_lookup",
            notes="Derived a direct web source from the conversational request.",
        )

    return IngestionRequest(
        source="UNKNOWN",
        intent="unknown",
        notes="Could not map the request to a supported ingestion source.",
    )
