"""Ollama provider validation for Offline Mode."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from ..runtime.models import RuntimeStatus
from .base import BaseProviderAdapter, ProviderStatus


class OllamaProviderAdapter(BaseProviderAdapter):
    provider_type = "ollama"
    display_name = "Ollama"

    def validate(self, **kwargs: object) -> ProviderStatus:
        runtime_status = kwargs.get("runtime_status")
        if not isinstance(runtime_status, RuntimeStatus):
            raise TypeError("runtime_status is required for Ollama validation.")

        base_url = str(kwargs.get("base_url") or "http://127.0.0.1:11434").rstrip("/")
        preferred_model = str(kwargs.get("preferred_model") or "").strip()
        installation = runtime_status.ollama
        if not installation.installed:
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=bool(preferred_model),
                available=False,
                validation_state="invalid",
                ready=False,
                message="Ollama is not installed or was not found on PATH.",
                is_local=True,
                model=preferred_model,
            )

        try:
            request = urllib.request.Request(f"{base_url}/api/tags", method="GET")
            with urllib.request.urlopen(request, timeout=2.5) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=bool(preferred_model),
                available=False,
                validation_state="invalid",
                ready=False,
                message=f"Ollama is installed but the local service is not reachable at {base_url}: {exc}",
                is_local=True,
                model=preferred_model,
            )

        models = payload.get("models") if isinstance(payload, dict) else None
        if not isinstance(models, list):
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=bool(preferred_model),
                available=True,
                validation_state="partial",
                ready=False,
                message="Ollama responded, but model listing was not available in the expected format.",
                is_local=True,
                model=preferred_model,
            )

        available_models = tuple(
            str(item.get("name")).strip()
            for item in models
            if isinstance(item, dict) and str(item.get("name") or "").strip()
        )
        if preferred_model and preferred_model not in available_models:
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=True,
                available=True,
                validation_state="invalid",
                ready=False,
                message=f"Preferred Ollama model '{preferred_model}' was not found locally.",
                is_local=True,
                model=preferred_model,
                available_models=available_models,
            )

        chosen_model = preferred_model or (available_models[0] if available_models else "")
        if not available_models:
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=bool(preferred_model),
                available=True,
                validation_state="partial",
                ready=False,
                message="Ollama is reachable, but no local models were detected yet.",
                is_local=True,
                model=chosen_model,
                available_models=available_models,
            )

        if not preferred_model:
            return ProviderStatus(
                provider="ollama",
                display_name=self.display_name,
                configured=True,
                available=True,
                validation_state="valid",
                ready=True,
                message=f"Ollama is reachable. {len(available_models)} local model(s) detected.",
                is_local=True,
                model=chosen_model,
                available_models=available_models,
            )

        return ProviderStatus(
            provider="ollama",
            display_name=self.display_name,
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message=f"Ollama is reachable and preferred model '{preferred_model}' is available.",
            is_local=True,
            model=chosen_model,
            available_models=available_models,
        )
