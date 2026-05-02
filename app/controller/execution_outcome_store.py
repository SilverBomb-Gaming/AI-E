"""Append-only JSONL execution outcome store for the learning substrate."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .execution_outcome_models import ExecutionOutcomeRecord


class ExecutionOutcomeStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._root_path.mkdir(parents=True, exist_ok=True)

    @property
    def root_path(self) -> Path:
        return self._root_path

    def generate_outcome_id(self) -> str:
        return f"OUT-{uuid4().hex[:10].upper()}"

    def append(self, record: ExecutionOutcomeRecord) -> ExecutionOutcomeRecord:
        stored = ExecutionOutcomeRecord.from_payload(record.to_payload())
        with self._lock:
            path = self._daily_path(stored.created_at)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(stored.to_payload(), ensure_ascii=True, sort_keys=True))
                handle.write("\n")
        return stored

    def list_records(self, *, limit: int = 8) -> tuple[ExecutionOutcomeRecord, ...]:
        if limit <= 0:
            return ()
        records: list[ExecutionOutcomeRecord] = []
        with self._lock:
            for path in sorted(self._root_path.glob("*.jsonl"), reverse=True):
                try:
                    lines = list(reversed(path.read_text(encoding="utf-8").splitlines()))
                except OSError:
                    continue
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
                    records.append(ExecutionOutcomeRecord.from_payload(payload))
                    if len(records) >= limit:
                        return tuple(records)
        return tuple(records)

    def _daily_path(self, created_at: str) -> Path:
        stamp = created_at[:10] if len(created_at) >= 10 else "unknown-date"
        return self._root_path / f"{stamp}.jsonl"