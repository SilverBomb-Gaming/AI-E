"""Policy checks for controlled ingestion sources."""
from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
from urllib.parse import urlparse

from app.controller.data_policy_models import SourcePolicyRecord
from app.controller.data_policy_rules import DataPolicyRules


DEFAULT_ROOT = Path(os.environ.get("AI_E_INGEST_ROOT", str(Path(__file__).resolve().parents[1]))).resolve()


@dataclass(frozen=True)
class PolicyDecision:
    allowed: bool
    reason: str
    source_kind: str
    source_type: str
    usage_class: str
    review_status: str
    review_required: bool
    allowed_operations: tuple[str, ...]
    provenance_requirements: tuple[str, ...]
    matched_rule: str = ""


def is_url(value: str) -> bool:
    parsed = urlparse(value.strip())
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def load_allowlist(*, root_path: str | Path | None = None) -> dict[str, object]:
    root = Path(root_path or DEFAULT_ROOT)
    path = root / "policy" / "allowlist.json"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return payload if isinstance(payload, dict) else {}


def load_rules(*, root_path: str | Path | None = None) -> dict[str, object]:
    root = Path(root_path or DEFAULT_ROOT)
    path = root / "policy" / "rules.json"
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    return payload if isinstance(payload, dict) else {}


def policy_decision_for_source(source: str, *, root_path: str | Path | None = None) -> PolicyDecision:
    root = Path(root_path or DEFAULT_ROOT)
    allowlist = load_allowlist(root_path=root)
    rules = load_rules(root_path=root)
    normalized_source = source.strip()
    if not normalized_source:
        return PolicyDecision(
            allowed=False,
            reason="Source is required.",
            source_kind="unknown",
            source_type="",
            usage_class="blocked",
            review_status="draft",
            review_required=True,
            allowed_operations=("blocked",),
            provenance_requirements=(),
        )

    default_usage = str(rules.get("default_usage_class", "retrieval_only"))
    default_review_status = str(rules.get("default_review_status", "approved"))
    default_review_required = bool(rules.get("default_review_required", False))
    default_provenance = tuple(str(item).strip() for item in rules.get("provenance_requirements", []) if str(item).strip())

    if is_url(normalized_source):
        parsed = urlparse(normalized_source)
        domain = (parsed.hostname or parsed.netloc).lower()
        allowed_domains = [str(item).strip().lower() for item in allowlist.get("domains", []) if str(item).strip()]
        matched_domain = next((item for item in allowed_domains if domain == item or domain.endswith(f".{item}")), "")
        if not matched_domain:
            return PolicyDecision(
                allowed=False,
                reason=f"Domain {domain or '(unknown)'} is not present in policy/allowlist.json.",
                source_kind="url",
                source_type="web_domain",
                usage_class="blocked",
                review_status="draft",
                review_required=True,
                allowed_operations=("blocked",),
                provenance_requirements=default_provenance,
            )
        record = DataPolicyRules.normalize_record(
            SourcePolicyRecord(
                source_id=f"POLICY-{matched_domain.upper().replace('.', '_')}",
                source_name=matched_domain,
                source_type="web_domain",
                source_locator=normalized_source,
                created_at="policy-bootstrap",
                updated_at="policy-bootstrap",
                status="active",
                usage_class=default_usage,
                review_status=default_review_status,
                provenance_requirements=default_provenance,
                review_required=default_review_required,
                policy_notes="allowlist-controlled ingestion rule",
                source_scope=matched_domain,
                collection_method_class="manual_invocation",
            )
        )
        allowed = any(operation in record.allowed_operations for operation in {"retrieval", "metadata_only"}) and "blocked" not in record.allowed_operations
        reason = "Allowed by allowlist and datasource policy rules." if allowed else "Datasource policy rules did not grant retrieval access."
        return PolicyDecision(
            allowed=allowed,
            reason=reason,
            source_kind="url",
            source_type=record.source_type,
            usage_class=record.usage_class,
            review_status=record.review_status,
            review_required=record.review_required,
            allowed_operations=record.allowed_operations,
            provenance_requirements=record.provenance_requirements,
            matched_rule=matched_domain,
        )

    local_allowed = bool(rules.get("allow_local_files", True))
    local_path = Path(normalized_source)
    if not local_path.is_absolute():
        local_path = (root / local_path).resolve()
    if not local_allowed:
        return PolicyDecision(
            allowed=False,
            reason="Local file ingestion is disabled by policy/rules.json.",
            source_kind="file",
            source_type="file_bundle",
            usage_class="blocked",
            review_status="draft",
            review_required=True,
            allowed_operations=("blocked",),
            provenance_requirements=default_provenance,
        )
    if not local_path.exists() or not local_path.is_file():
        return PolicyDecision(
            allowed=False,
            reason=f"Local file {local_path} was not found.",
            source_kind="file",
            source_type="file_bundle",
            usage_class="blocked",
            review_status="draft",
            review_required=True,
            allowed_operations=("blocked",),
            provenance_requirements=default_provenance,
        )
    record = DataPolicyRules.normalize_record(
        SourcePolicyRecord(
            source_id=f"POLICY-FILE-{local_path.stem.upper()[:24]}",
            source_name=local_path.name,
            source_type="file_bundle",
            source_locator=str(local_path),
            created_at="policy-bootstrap",
            updated_at="policy-bootstrap",
            status="active",
            usage_class=str(rules.get("local_file_usage_class", default_usage)),
            review_status=str(rules.get("local_file_review_status", default_review_status)),
            provenance_requirements=default_provenance,
            review_required=bool(rules.get("local_file_review_required", default_review_required)),
            policy_notes="local file ingestion rule",
            source_scope=str(local_path.parent),
            collection_method_class="manual_invocation",
        )
    )
    allowed = any(operation in record.allowed_operations for operation in {"retrieval", "metadata_only", "export_reference"}) and "blocked" not in record.allowed_operations
    reason = "Allowed local file by datasource policy rules." if allowed else "Datasource policy rules did not grant local file retrieval access."
    return PolicyDecision(
        allowed=allowed,
        reason=reason,
        source_kind="file",
        source_type=record.source_type,
        usage_class=record.usage_class,
        review_status=record.review_status,
        review_required=record.review_required,
        allowed_operations=record.allowed_operations,
        provenance_requirements=record.provenance_requirements,
        matched_rule="local_file",
    )


def is_source_allowed(source: str, *, root_path: str | Path | None = None) -> bool:
    return policy_decision_for_source(source, root_path=root_path).allowed