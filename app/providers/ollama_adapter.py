"""Ollama provider validation for Offline Mode."""
from __future__ import annotations

import json
import urllib.error
import urllib.request
from urllib.parse import urljoin

from ..runtime.models import RuntimeStatus
from .base import BaseProviderAdapter, ProviderReply, ProviderStatus


_OLLAMA_TIMEOUT_SECONDS = 15.0
_OLLAMA_MAX_RESPONSE_CHARS = 1200


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
            payload = self._request_json(urljoin(f"{base_url}/", "api/tags"), timeout=2.5)
        except RuntimeError as exc:
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

    def ask(self, **kwargs: object) -> ProviderReply:
        runtime_status = kwargs.get("runtime_status")
        if not isinstance(runtime_status, RuntimeStatus):
            raise TypeError("runtime_status is required for Ollama ask requests.")

        base_url = str(kwargs.get("base_url") or "http://127.0.0.1:11434").rstrip("/")
        preferred_model = str(kwargs.get("preferred_model") or "").strip()
        prompt = str(kwargs.get("prompt") or "").strip()
        if not prompt:
            return ProviderReply(
                provider="ollama",
                ok=False,
                text="",
                message="Provide a prompt after /ask before sending it to Ollama.",
                model=preferred_model,
            )

        validation = self.validate(
            runtime_status=runtime_status,
            base_url=base_url,
            preferred_model=preferred_model,
        )
        if not validation.ready:
            return ProviderReply(
                provider="ollama",
                ok=False,
                text="",
                message=validation.message,
                model=validation.model,
            )

        model = validation.model or preferred_model
        payload = {
            "model": model,
            "prompt": self._build_prompt(prompt),
            "stream": False,
        }
        try:
            response = self._post_json(urljoin(f"{base_url}/", "api/generate"), payload, timeout=_OLLAMA_TIMEOUT_SECONDS)
        except RuntimeError as exc:
            return ProviderReply(
                provider="ollama",
                ok=False,
                text="",
                message=f"Ollama request failed: {exc}",
                model=model,
            )

        text = str(response.get("response") or "").strip()
        if not text:
            return ProviderReply(
                provider="ollama",
                ok=False,
                text="",
                message="Ollama returned an empty response.",
                model=model,
            )

        return ProviderReply(
            provider="ollama",
            ok=True,
            text=self._trim_text(text),
            message=f"Ollama replied with model '{model}'.",
            model=model,
        )

    @staticmethod
    def _build_prompt(prompt: str) -> str:
        return (
            "You are Windows OpenClaw Operator Console v1.2. "
            "Reply concisely in plain text, keep the answer under 6 short sentences, "
            "and do not mention hidden reasoning.\n\n"
            f"User request: {prompt}"
        )

    @staticmethod
    def _trim_text(text: str, *, limit: int = _OLLAMA_MAX_RESPONSE_CHARS) -> str:
        normalized = " ".join(text.split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: limit - 3]}..."

    @staticmethod
    def _request_json(url: str, *, timeout: float) -> dict[str, object]:
        request = urllib.request.Request(url, method="GET")
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"Ollama returned HTTP {exc.code}.") from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            raise RuntimeError(str(exc)) from None
        if not isinstance(payload, dict):
            raise RuntimeError("Ollama returned an invalid JSON payload.")
        return payload

    @staticmethod
    def _post_json(url: str, payload: dict[str, object], *, timeout: float) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                error_payload = json.loads(exc.read().decode("utf-8"))
                detail = str(error_payload.get("error") or error_payload.get("message") or "")
            except (OSError, ValueError):
                detail = ""
            suffix = f" {detail}".rstrip()
            raise RuntimeError(f"Ollama returned HTTP {exc.code}.{suffix}".strip()) from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            raise RuntimeError(str(exc)) from None
        if not isinstance(response_payload, dict):
            raise RuntimeError("Ollama returned an invalid JSON payload.")
        return response_payload
