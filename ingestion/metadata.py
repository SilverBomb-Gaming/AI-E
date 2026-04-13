"""Metadata generation for ingestion output chunks."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib

from .policy_check import PolicyDecision


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def generate_metadata(
    *,
    source: str,
    content: str,
    dataset_id: str,
    chunk_index: int,
    chunk_count: int,
    policy_decision: PolicyDecision,
) -> dict[str, object]:
    return {
        "dataset_id": dataset_id,
        "source": source,
        "source_kind": policy_decision.source_kind,
        "source_type": policy_decision.source_type,
        "timestamp": utc_now_iso(),
        "hash": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "chunk_index": chunk_index,
        "chunk_count": chunk_count,
        "policy": {
            "matched_rule": policy_decision.matched_rule,
            "usage_class": policy_decision.usage_class,
            "review_status": policy_decision.review_status,
            "review_required": policy_decision.review_required,
            "allowed_operations": list(policy_decision.allowed_operations),
            "provenance_requirements": list(policy_decision.provenance_requirements),
        },
        "usage": {
            "retrieval": "retrieval" in policy_decision.allowed_operations,
            "training": "training" in policy_decision.allowed_operations,
            "evaluation": "evaluation" in policy_decision.allowed_operations,
        },
    }