"""Durable JSON store for bounded evaluation sessions and runs."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .evaluation_session_models import EvaluationRunRecord, EvaluationSessionRecord


class EvaluationSessionStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._sessions_dir().mkdir(parents=True, exist_ok=True)
        self._runs_dir().mkdir(parents=True, exist_ok=True)

    @property
    def root_path(self) -> Path:
        return self._root_path

    def create_session(self, record: EvaluationSessionRecord) -> EvaluationSessionRecord:
        with self._lock:
            stored = EvaluationSessionRecord.from_payload(record.to_payload())
            self._write_json(self._session_path(stored.session_id), stored.to_payload())
            self._session_runs_dir(stored.session_id).mkdir(parents=True, exist_ok=True)
            return stored

    def update_session(self, record: EvaluationSessionRecord) -> EvaluationSessionRecord:
        with self._lock:
            stored = EvaluationSessionRecord.from_payload(record.to_payload())
            self._write_json(self._session_path(stored.session_id), stored.to_payload())
            self._session_runs_dir(stored.session_id).mkdir(parents=True, exist_ok=True)
            return stored

    def get_session(self, session_id: str) -> EvaluationSessionRecord | None:
        normalized = session_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            return self._read_session(self._session_path(normalized))

    def list_sessions(self) -> tuple[EvaluationSessionRecord, ...]:
        with self._lock:
            sessions = [self._read_session(path) for path in sorted(self._sessions_dir().glob("*.json"))]
            records = [record for record in sessions if record is not None]
            return tuple(sorted(records, key=lambda record: (record.created_at, record.session_id), reverse=True))

    def append_run(self, run: EvaluationRunRecord) -> EvaluationRunRecord:
        with self._lock:
            stored = EvaluationRunRecord.from_payload(run.to_payload())
            run_dir = self._session_runs_dir(stored.session_id)
            run_dir.mkdir(parents=True, exist_ok=True)
            self._write_json(run_dir / f"{stored.run_id}.json", stored.to_payload())
            return stored

    def runs_for_session(self, session_id: str, *, limit: int | None = None) -> tuple[EvaluationRunRecord, ...]:
        normalized = session_id.strip().upper()
        if not normalized:
            return ()
        with self._lock:
            run_dir = self._session_runs_dir(normalized)
            if not run_dir.exists():
                return ()
            records = [self._read_run(path) for path in sorted(run_dir.glob("*.json"))]
            filtered = [record for record in records if record is not None]
            filtered.sort(key=lambda record: (record.iteration, record.started_at, record.run_id))
            if limit is not None and limit > 0:
                filtered = filtered[-limit:]
            return tuple(filtered)

    def generate_session_id(self) -> str:
        return f"EV-{uuid4().hex[:8].upper()}"

    def generate_run_id(self) -> str:
        return f"RUN-{uuid4().hex[:8].upper()}"

    def _sessions_dir(self) -> Path:
        return self._root_path / "sessions"

    def _runs_dir(self) -> Path:
        return self._root_path / "runs"

    def _session_path(self, session_id: str) -> Path:
        return self._sessions_dir() / f"{session_id.strip().upper()}.json"

    def _session_runs_dir(self, session_id: str) -> Path:
        return self._runs_dir() / session_id.strip().upper()

    @staticmethod
    def _write_json(path: Path, payload: dict[str, object]) -> None:
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(path)

    @staticmethod
    def _read_session(path: Path) -> EvaluationSessionRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return EvaluationSessionRecord.from_payload(raw)

    @staticmethod
    def _read_run(path: Path) -> EvaluationRunRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return EvaluationRunRecord.from_payload(raw)
