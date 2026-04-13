"""Append-only JSONL store for durable AI-E data records."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .data_record_models import DataRecord


class DataRecordStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._root_path.mkdir(parents=True, exist_ok=True)

    @property
    def root_path(self) -> Path:
        return self._root_path

    def generate_record_id(self) -> str:
        return f"DAT-{uuid4().hex[:10].upper()}"

    def append(self, record: DataRecord) -> DataRecord:
        stored = DataRecord.from_payload(record.to_payload())
        with self._lock:
            path = self._daily_path(stored.captured_at)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(stored.to_payload(), ensure_ascii=True, sort_keys=True))
                handle.write("\n")
        return stored

    def get(self, record_id: str) -> DataRecord | None:
        normalized = record_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            for path in self._iter_daily_paths(reverse=True):
                for record in self._read_path(path, reverse=True):
                    if record.record_id == normalized:
                        return record
        return None

    def list_records(self, *, limit: int = 8) -> tuple[DataRecord, ...]:
        return self.search(filters={}, limit=limit)

    def search(self, *, filters: dict[str, str], limit: int = 8) -> tuple[DataRecord, ...]:
        normalized_filters = {str(key).strip().lower(): str(value).strip() for key, value in filters.items() if str(value).strip()}
        if limit <= 0:
            return ()
        matches: list[DataRecord] = []
        with self._lock:
            for path in self._iter_daily_paths(reverse=True):
                for record in self._read_path(path, reverse=True):
                    if self._matches(record, normalized_filters):
                        matches.append(record)
                        if len(matches) >= limit:
                            return tuple(matches)
        return tuple(matches)

    def _daily_path(self, captured_at: str) -> Path:
        stamp = captured_at[:10] if len(captured_at) >= 10 else "unknown-date"
        return self._root_path / f"{stamp}.jsonl"

    def _iter_daily_paths(self, *, reverse: bool) -> list[Path]:
        return sorted(self._root_path.glob("*.jsonl"), reverse=reverse)

    @staticmethod
    def _read_path(path: Path, *, reverse: bool) -> list[DataRecord]:
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        if reverse:
            lines = list(reversed(lines))
        records: list[DataRecord] = []
        for line in lines:
            raw = line.strip()
            if not raw:
                continue
            try:
                payload = json.loads(raw)
            except (ValueError, json.JSONDecodeError):
                continue
            if not isinstance(payload, dict):
                continue
            records.append(DataRecord.from_payload(payload))
        return records

    @staticmethod
    def _matches(record: DataRecord, filters: dict[str, str]) -> bool:
        if not filters:
            return True
        haystacks = {
            "id": record.record_id,
            "record_id": record.record_id,
            "type": record.record_type,
            "record_type": record.record_type,
            "label": record.label,
            "outcome": record.outcome,
            "source": record.source,
            "request_id": record.request_id,
            "session_id": record.session_id,
            "chain_id": record.chain_id,
            "step_id": record.step_id,
            "run_id": record.run_id,
            "bundle_id": record.bundle_id,
            "chat_id": record.chat_id,
            "capability_id": record.capability_id,
            "command_label": record.command_label,
        }
        for key, expected in filters.items():
            actual = haystacks.get(key, "")
            if actual.lower() != expected.lower():
                return False
        return True