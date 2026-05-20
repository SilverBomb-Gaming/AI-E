"""Append-only JSONL store for governed execution receipts."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .execution_plan import ExecutionReceipt


class ExecutionReceiptStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._root_path.mkdir(parents=True, exist_ok=True)

    @property
    def root_path(self) -> Path:
        return self._root_path

    def generate_receipt_id(self) -> str:
        return f"REC-{uuid4().hex[:10].upper()}"

    def append(self, receipt: ExecutionReceipt) -> ExecutionReceipt:
        stored = ExecutionReceipt.from_payload(receipt.to_payload())
        with self._lock:
            path = self._daily_path(stored.execution_finished)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(stored.to_payload(), ensure_ascii=True, sort_keys=True))
                handle.write("\n")
        return stored

    def list_receipts(self, *, limit: int = 8) -> tuple[ExecutionReceipt, ...]:
        if limit <= 0:
            return ()
        receipts: list[ExecutionReceipt] = []
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
                    receipts.append(ExecutionReceipt.from_payload(payload))
                    if len(receipts) >= limit:
                        return tuple(receipts)
        return tuple(receipts)

    def _daily_path(self, execution_finished: str) -> Path:
        stamp = execution_finished[:10] if len(execution_finished) >= 10 else "unknown-date"
        return self._root_path / f"{stamp}.jsonl"
