"""Durable JSON store for controlled data-source policy records."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .data_policy_models import SourcePolicyRecord


class DataPolicyStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._policies_dir().mkdir(parents=True, exist_ok=True)

    def generate_source_id(self) -> str:
        return f"DSRC-{uuid4().hex[:8].upper()}"

    def save_source_policy(self, record: SourcePolicyRecord) -> SourcePolicyRecord:
        with self._lock:
            stored = SourcePolicyRecord.from_payload(record.to_payload())
            self._write_json(self._policy_path(stored.source_id), stored.to_payload())
            return stored

    def get_source_policy(self, source_id: str) -> SourcePolicyRecord | None:
        normalized = source_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            return self._read_policy(self._policy_path(normalized))

    def list_source_policies(self) -> tuple[SourcePolicyRecord, ...]:
        with self._lock:
            records = [self._read_policy(path) for path in sorted(self._policies_dir().glob("*.json"))]
        valid = [record for record in records if record is not None]
        return tuple(sorted(valid, key=lambda item: (item.updated_at, item.source_id), reverse=True))

    def _policies_dir(self) -> Path:
        return self._root_path / "records"

    def _policy_path(self, source_id: str) -> Path:
        return self._policies_dir() / f"{source_id.strip().upper()}.json"

    @staticmethod
    def _write_json(path: Path, payload: dict[str, object]) -> None:
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        temp_path.replace(path)

    @staticmethod
    def _read_json(path: Path) -> dict[str, object] | None:
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        return payload if isinstance(payload, dict) else None

    @classmethod
    def _read_policy(cls, path: Path) -> SourcePolicyRecord | None:
        payload = cls._read_json(path)
        return SourcePolicyRecord.from_payload(payload) if isinstance(payload, dict) else None