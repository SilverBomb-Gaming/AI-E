"""Manual policy-aware ingestion entrypoint."""
from __future__ import annotations

import json
from pathlib import Path
import secrets
import sys

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from accessibility.interpreter import interpret_input
from accessibility.refiner import refine_request
from accessibility.validator import validate_request
from ingestion.chunker import chunk_text
from ingestion.cleaner import clean_content
from ingestion.fetcher import fetch_source
from ingestion.metadata import generate_metadata, utc_now_iso
from ingestion.policy_check import DEFAULT_ROOT, is_url, policy_decision_for_source


def _ensure_json_file(path: Path, *, default_payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps(default_payload, indent=2), encoding="utf-8")


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _safe_name(source: str) -> str:
    return "".join(character if character.isalnum() else "_" for character in source)[:80].strip("_") or "source"


def register_dataset(*, root_path: Path, record: dict[str, object]) -> list[dict[str, object]]:
    registry_path = root_path / "data" / "registry.json"
    _ensure_json_file(registry_path, default_payload=[])
    payload = json.loads(registry_path.read_text(encoding="utf-8-sig"))
    registry = payload if isinstance(payload, list) else []
    registry.append(record)
    _write_json(registry_path, registry)
    return registry


def _looks_like_direct_source(value: str, *, root_path: Path) -> bool:
    stripped = value.strip()
    if not stripped:
        return False

    if is_url(stripped):
        return True

    candidate = Path(stripped)
    if candidate.exists():
        return True

    if not candidate.is_absolute() and (root_path / candidate).exists():
        return True

    return any(separator in stripped for separator in {"\\", "/"}) or bool(candidate.suffix)


def ingest_source(source: str, *, root_path: str | Path | None = None) -> dict[str, object]:
    root = Path(root_path or DEFAULT_ROOT)
    decision = policy_decision_for_source(source, root_path=root)
    if not decision.allowed:
        raise ValueError(f"Source not allowed by policy: {decision.reason}")

    rules = json.loads((root / "policy" / "rules.json").read_text(encoding="utf-8-sig"))
    chunk_size = int(rules.get("chunk_size", 500) or 500)
    timeout_seconds = int(rules.get("timeout_seconds", 10) or 10)
    rate_limit_seconds = float(rules.get("rate_limit_seconds", 1.0) or 1.0)

    raw_text, source_kind = fetch_source(
        source,
        root_path=root,
        timeout_seconds=timeout_seconds,
        rate_limit_seconds=rate_limit_seconds,
    )
    cleaned = clean_content(raw_text, source=source, source_kind=source_kind)
    chunks = chunk_text(cleaned, chunk_size=chunk_size)
    if not chunks:
        raise ValueError("No content remained after cleaning; nothing to register.")

    dataset_id = f"ING-{secrets.token_hex(4).upper()}"
    timestamp = utc_now_iso()
    raw_name = f"{dataset_id}_{_safe_name(source)}.txt"
    raw_path = root / "data" / "raw" / raw_name
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(raw_text, encoding="utf-8")

    dataset_entries: list[dict[str, object]] = []
    for chunk_index, chunk in enumerate(chunks):
        dataset_entries.append(
            {
                "content": chunk,
                "metadata": generate_metadata(
                    source=source,
                    content=chunk,
                    dataset_id=dataset_id,
                    chunk_index=chunk_index,
                    chunk_count=len(chunks),
                    policy_decision=decision,
                ),
            }
        )

    processed_dir = root / "data" / "processed"
    processed_dir.mkdir(parents=True, exist_ok=True)
    latest_output_path = processed_dir / "output.json"
    dataset_output_path = processed_dir / f"{dataset_id}.json"
    _write_json(latest_output_path, dataset_entries)
    _write_json(dataset_output_path, dataset_entries)

    registry_record = {
        "dataset_id": dataset_id,
        "source": source,
        "source_kind": decision.source_kind,
        "source_type": decision.source_type,
        "entries": len(dataset_entries),
        "raw_path": str(raw_path.relative_to(root)),
        "output_path": str(dataset_output_path.relative_to(root)),
        "usage_class": decision.usage_class,
        "review_status": decision.review_status,
        "allowed_operations": list(decision.allowed_operations),
        "ingested_at": timestamp,
    }
    register_dataset(root_path=root, record=registry_record)
    return {
        "dataset_id": dataset_id,
        "entry_count": len(dataset_entries),
        "output_path": str(dataset_output_path),
        "latest_output_path": str(latest_output_path),
        "raw_path": str(raw_path),
        "policy": registry_record,
    }


def ingest_from_conversation(user_input: str, *, root_path: str | Path | None = None) -> dict[str, object]:
    parsed = interpret_input(user_input)
    refined = refine_request(parsed)
    validate_request(refined)
    return ingest_source(refined.source, root_path=root_path)


def main(argv: list[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    if len(args) != 1:
        print("Usage: python ingestion/ingest.py <url-or-file-or-natural-language-request>")
        return 1
    try:
        root = Path(DEFAULT_ROOT)
        request = args[0]
        if _looks_like_direct_source(request, root_path=root):
            result = ingest_source(request, root_path=root)
        else:
            result = ingest_from_conversation(request, root_path=root)
    except Exception as exc:
        print(f"Ingestion failed: {exc}")
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())