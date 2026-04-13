"""Durable JSON store for bounded task chains and steps."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .task_chain_models import TaskChainRecord, TaskChainStepRecord


class TaskChainStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._chains_dir().mkdir(parents=True, exist_ok=True)
        self._steps_dir().mkdir(parents=True, exist_ok=True)

    def create_chain(self, record: TaskChainRecord) -> TaskChainRecord:
        with self._lock:
            stored = TaskChainRecord.from_payload(record.to_payload())
            self._write_json(self._chain_path(stored.chain_id), stored.to_payload())
            self._chain_steps_dir(stored.chain_id).mkdir(parents=True, exist_ok=True)
            return stored

    def update_chain(self, record: TaskChainRecord) -> TaskChainRecord:
        with self._lock:
            stored = TaskChainRecord.from_payload(record.to_payload())
            self._write_json(self._chain_path(stored.chain_id), stored.to_payload())
            self._chain_steps_dir(stored.chain_id).mkdir(parents=True, exist_ok=True)
            return stored

    def get_chain(self, chain_id: str) -> TaskChainRecord | None:
        normalized = chain_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            return self._read_chain(self._chain_path(normalized))

    def list_chains(self) -> tuple[TaskChainRecord, ...]:
        with self._lock:
            chains = [self._read_chain(path) for path in sorted(self._chains_dir().glob("*.json"))]
            records = [record for record in chains if record is not None]
            return tuple(sorted(records, key=lambda record: (record.created_at, record.chain_id), reverse=True))

    def append_step(self, step: TaskChainStepRecord) -> TaskChainStepRecord:
        with self._lock:
            stored = TaskChainStepRecord.from_payload(step.to_payload())
            step_dir = self._chain_steps_dir(stored.chain_id)
            step_dir.mkdir(parents=True, exist_ok=True)
            self._write_json(step_dir / f"{stored.step_id}.json", stored.to_payload())
            return stored

    def steps_for_chain(self, chain_id: str, *, limit: int | None = None) -> tuple[TaskChainStepRecord, ...]:
        normalized = chain_id.strip().upper()
        if not normalized:
            return ()
        with self._lock:
            step_dir = self._chain_steps_dir(normalized)
            if not step_dir.exists():
                return ()
            records = [self._read_step(path) for path in sorted(step_dir.glob("*.json"))]
            filtered = [record for record in records if record is not None]
            filtered.sort(key=lambda record: (record.step_number, record.started_at, record.step_id))
            if limit is not None and limit > 0:
                filtered = filtered[-limit:]
            return tuple(filtered)

    def generate_chain_id(self) -> str:
        return f"CH-{uuid4().hex[:8].upper()}"

    def generate_step_id(self) -> str:
        return f"STEP-{uuid4().hex[:8].upper()}"

    def _chains_dir(self) -> Path:
        return self._root_path / "chains"

    def _steps_dir(self) -> Path:
        return self._root_path / "steps"

    def _chain_path(self, chain_id: str) -> Path:
        return self._chains_dir() / f"{chain_id.strip().upper()}.json"

    def _chain_steps_dir(self, chain_id: str) -> Path:
        return self._steps_dir() / chain_id.strip().upper()

    @staticmethod
    def _write_json(path: Path, payload: dict[str, object]) -> None:
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(path)

    @staticmethod
    def _read_chain(path: Path) -> TaskChainRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return TaskChainRecord.from_payload(raw)

    @staticmethod
    def _read_step(path: Path) -> TaskChainStepRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return TaskChainStepRecord.from_payload(raw)