"""In-memory store for the active bounded feature bundle per chat."""
from __future__ import annotations

from .feature_bundle_models import FeatureBundleRecord


class FeatureBundleStore:
    def __init__(self) -> None:
        self._active_bundles: dict[str, FeatureBundleRecord] = {}

    def get_active(self, *, chat_id: str) -> FeatureBundleRecord | None:
        return self._active_bundles.get(chat_id)

    def set_active(self, *, chat_id: str, bundle: FeatureBundleRecord) -> None:
        self._active_bundles[chat_id] = bundle

    def clear_active(self, *, chat_id: str) -> FeatureBundleRecord | None:
        return self._active_bundles.pop(chat_id, None)

    def clear_terminal(self, *, chat_id: str) -> FeatureBundleRecord | None:
        existing = self._active_bundles.get(chat_id)
        if existing is None or existing.state not in {"applied", "validated", "failed", "invalidated"}:
            return None
        return self._active_bundles.pop(chat_id, None)