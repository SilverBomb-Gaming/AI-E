"""Persistent bounded dispatch records for shared-directory node orchestration."""
from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .node_models import NodeDescriptor, NodeDispatchRecord, NodeDispatchTarget


class NodeDispatchError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class NodeDispatcher:
    def __init__(self, *, registry_root: str = "") -> None:
        self._lock = RLock()
        self._registry_root = Path(registry_root).resolve() if registry_root.strip() else None
        if self._registry_root is not None:
            self._jobs_dir().mkdir(parents=True, exist_ok=True)

    def registry_root(self) -> Path | None:
        return self._registry_root

    def set_registry_root(self, registry_root: str) -> None:
        with self._lock:
            self._registry_root = Path(registry_root).resolve() if registry_root.strip() else None
            if self._registry_root is not None:
                self._jobs_dir().mkdir(parents=True, exist_ok=True)

    def create_job(self, *, record: NodeDispatchRecord) -> NodeDispatchRecord:
        if self._registry_root is None:
            raise NodeDispatchError("dispatch_registry_missing", "Node registry root is not configured.")
        with self._lock:
            self._write_record(record)
            return record

    def new_job_id(self) -> str:
        return f"JOB-{uuid4().hex[:8].upper()}"

    def get_job(self, job_id: str) -> NodeDispatchRecord | None:
        normalized = job_id.strip().upper()
        if not normalized or self._registry_root is None:
            return None
        with self._lock:
            path = self._job_path(normalized)
            if not path.exists():
                return None
            return self._read_record(path)

    def list_jobs(self) -> tuple[NodeDispatchRecord, ...]:
        if self._registry_root is None:
            return ()
        with self._lock:
            records = [self._read_record(path) for path in sorted(self._jobs_dir().glob("*.json"))]
            return tuple(record for record in records if record is not None)

    def claim_next_job(self, *, node: NodeDescriptor, now_iso: str) -> NodeDispatchRecord | None:
        if self._registry_root is None:
            return None
        with self._lock:
            for record in self.list_jobs():
                if record.target_node_id != node.node_id or record.status != "queued":
                    continue
                claimed = replace(record, status="running", started_at=now_iso, current_job_state="running")
                self._write_record(claimed)
                return claimed
        return None

    def complete_job(self, *, job_id: str, result_summary: str, finished_at: str) -> NodeDispatchRecord | None:
        return self._update_job(job_id=job_id, status="completed", result_summary=result_summary, failure_reason="", finished_at=finished_at, current_job_state="completed")

    def fail_job(self, *, job_id: str, failure_reason: str, finished_at: str) -> NodeDispatchRecord | None:
        return self._update_job(job_id=job_id, status="failed", failure_reason=failure_reason, result_summary=failure_reason, finished_at=finished_at, current_job_state="failed")

    def refuse_job(self, *, job_id: str, failure_reason: str, finished_at: str) -> NodeDispatchRecord | None:
        return self._update_job(job_id=job_id, status="refused", failure_reason=failure_reason, result_summary=failure_reason, finished_at=finished_at, current_job_state="refused")

    def _update_job(self, *, job_id: str, status: str, result_summary: str, failure_reason: str, finished_at: str, current_job_state: str) -> NodeDispatchRecord | None:
        if self._registry_root is None:
            return None
        with self._lock:
            existing = self.get_job(job_id)
            if existing is None:
                return None
            updated = replace(
                existing,
                status=status,  # type: ignore[arg-type]
                result_summary=result_summary.strip(),
                failure_reason=failure_reason.strip(),
                finished_at=finished_at.strip(),
                current_job_state=current_job_state.strip(),
            )
            self._write_record(updated)
            return updated

    def _jobs_dir(self) -> Path:
        if self._registry_root is None:
            raise NodeDispatchError("dispatch_registry_missing", "Node registry root is not configured.")
        return self._registry_root / "jobs"

    def _job_path(self, job_id: str) -> Path:
        return self._jobs_dir() / f"{job_id.strip().upper()}.json"

    def _read_record(self, path: Path) -> NodeDispatchRecord | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return NodeDispatchRecord.from_payload(raw)

    def _write_record(self, record: NodeDispatchRecord) -> None:
        path = self._job_path(record.job_id)
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(record.to_payload(), indent=2), encoding="utf-8")
        temp_path.replace(path)