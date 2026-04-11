from __future__ import annotations

from accessibility.schemas import IngestionRequest


def validate_request(req: IngestionRequest) -> bool:
    if req.source == "LOCAL_FILE_REQUIRED":
        raise ValueError("User must provide a file path.")

    if not req.source.startswith(("http://", "https://")):
        raise ValueError("Invalid source format.")

    return True
