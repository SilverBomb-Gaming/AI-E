"""Durable JSON store for local model experiments."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .model_experiment_models import ModelExperimentRecord


class ModelExperimentStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._experiments_dir().mkdir(parents=True, exist_ok=True)
        self._artifacts_dir().mkdir(parents=True, exist_ok=True)

    def generate_experiment_id(self) -> str:
        return f"MX-{uuid4().hex[:8].upper()}"

    def create_experiment(self, record: ModelExperimentRecord) -> ModelExperimentRecord:
        return self.update_experiment(record)

    def update_experiment(self, record: ModelExperimentRecord) -> ModelExperimentRecord:
        with self._lock:
            stored = ModelExperimentRecord.from_payload(record.to_payload())
            self._write_json(self._experiment_path(stored.experiment_id), stored.to_payload())
            self.artifact_root(stored.experiment_id)
            return stored

    def get_experiment(self, experiment_id: str) -> ModelExperimentRecord | None:
        normalized = experiment_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            return self._read_experiment(self._experiment_path(normalized))

    def list_experiments(self) -> tuple[ModelExperimentRecord, ...]:
        with self._lock:
            records = [self._read_experiment(path) for path in sorted(self._experiments_dir().glob("*.json"))]
        valid = [record for record in records if record is not None]
        return tuple(sorted(valid, key=lambda item: (item.updated_at, item.experiment_id), reverse=True))

    def latest_approved_for_task(self, *, task_type: str) -> ModelExperimentRecord | None:
        normalized_task = task_type.strip().lower().replace("-", "_")
        for record in self.list_experiments():
            if record.task_type != normalized_task:
                continue
            if record.integration_status == "approved_for_advisory_use" and record.status in {"trained", "evaluated"}:
                return record
        return None

    def artifact_root(self, experiment_id: str) -> Path:
        path = self._artifacts_dir() / experiment_id.strip().upper()
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _experiments_dir(self) -> Path:
        return self._root_path / "records"

    def _artifacts_dir(self) -> Path:
        return self._root_path / "artifacts"

    def _experiment_path(self, experiment_id: str) -> Path:
        return self._experiments_dir() / f"{experiment_id.strip().upper()}.json"

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
    def _read_experiment(cls, path: Path) -> ModelExperimentRecord | None:
        payload = cls._read_json(path)
        return ModelExperimentRecord.from_payload(payload) if isinstance(payload, dict) else None