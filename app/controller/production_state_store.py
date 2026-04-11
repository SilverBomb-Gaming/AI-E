"""Durable JSON storage for project production state and chat-scoped production memory."""
from __future__ import annotations

import json
from pathlib import Path
from threading import RLock
from uuid import uuid4

from .production_state_models import ProductionConversationMemory, ProductionProjectState


class ProductionStateStore:
    def __init__(self, *, root_path: str | Path) -> None:
        self._root_path = Path(root_path)
        self._lock = RLock()
        self._projects_dir().mkdir(parents=True, exist_ok=True)
        self._chat_memory_dir().mkdir(parents=True, exist_ok=True)

    def generate_project_id(self) -> str:
        return f"PRJ-{uuid4().hex[:8].upper()}"

    def save_project(self, record: ProductionProjectState) -> ProductionProjectState:
        with self._lock:
            stored = ProductionProjectState.from_payload(record.to_payload())
            self._write_json(self._project_path(stored.project_id), stored.to_payload())
            return stored

    def get_project(self, project_id: str) -> ProductionProjectState | None:
        normalized = project_id.strip().upper()
        if not normalized:
            return None
        with self._lock:
            return self._read_project(self._project_path(normalized))

    def list_projects(self) -> tuple[ProductionProjectState, ...]:
        with self._lock:
            records = [self._read_project(path) for path in sorted(self._projects_dir().glob("*.json"))]
            filtered = [record for record in records if record is not None]
            return tuple(sorted(filtered, key=lambda item: (item.updated_at, item.project_id), reverse=True))

    def save_chat_memory(self, record: ProductionConversationMemory) -> ProductionConversationMemory:
        normalized_chat = self._normalize_chat_id(record.chat_id)
        with self._lock:
            stored = ProductionConversationMemory.from_payload({**record.to_payload(), "chat_id": normalized_chat})
            self._write_json(self._chat_memory_path(normalized_chat), stored.to_payload())
            return stored

    def get_chat_memory(self, chat_id: str) -> ProductionConversationMemory | None:
        normalized_chat = self._normalize_chat_id(chat_id)
        if not normalized_chat:
            return None
        with self._lock:
            return self._read_chat_memory(self._chat_memory_path(normalized_chat))

    def _projects_dir(self) -> Path:
        return self._root_path / "projects"

    def _chat_memory_dir(self) -> Path:
        return self._root_path / "chat_memory"

    def _project_path(self, project_id: str) -> Path:
        return self._projects_dir() / f"{project_id.strip().upper()}.json"

    def _chat_memory_path(self, chat_id: str) -> Path:
        return self._chat_memory_dir() / f"{self._normalize_chat_id(chat_id)}.json"

    @staticmethod
    def _write_json(path: Path, payload: dict[str, object]) -> None:
        temp_path = path.with_suffix(".tmp")
        temp_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        temp_path.replace(path)

    @staticmethod
    def _read_project(path: Path) -> ProductionProjectState | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return ProductionProjectState.from_payload(raw)

    @staticmethod
    def _read_chat_memory(path: Path) -> ProductionConversationMemory | None:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return ProductionConversationMemory.from_payload(raw)

    @staticmethod
    def _normalize_chat_id(chat_id: str) -> str:
        return "".join(char if char.isalnum() or char in {"-", "_"} else "_" for char in chat_id.strip())
