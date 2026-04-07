"""OpenAI provider validation for Online Mode."""
from __future__ import annotations

import json
import urllib.error
import urllib.request

from ..platform.secrets import SecretStore
from .base import BaseProviderAdapter, ProviderReply, ProviderStatus


_DEFAULT_OPENAI_MODEL = "gpt-5-mini"
_OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
_OPENAI_TIMEOUT_SECONDS = 20.0
_OPENAI_MAX_RESPONSE_CHARS = 1200


def mask_secret(secret: str) -> str:
    trimmed = secret.strip()
    if len(trimmed) <= 8:
        return "*" * max(4, len(trimmed))
    return f"{trimmed[:6]}...{trimmed[-4:]}"


class OpenAIProviderAdapter(BaseProviderAdapter):
    provider_type = "openai"
    display_name = "OpenAI"

    def validate(self, **kwargs: object) -> ProviderStatus:
        secret_store = kwargs.get("secret_store")
        if not isinstance(secret_store, SecretStore):
            raise TypeError("secret_store is required for OpenAI validation.")

        secret_id = str(kwargs.get("secret_id") or "").strip()
        transient_secret = str(kwargs.get("transient_secret") or "").strip()
        secret = transient_secret or secret_store.get_secret(secret_id)
        if not secret:
            return ProviderStatus(
                provider="openai",
                display_name=self.display_name,
                configured=False,
                available=False,
                validation_state="invalid",
                ready=False,
                message="OpenAI is not configured. Save an API key before switching to Online Mode.",
                is_local=False,
            )

        if not self._looks_like_openai_key(secret):
            source = "provided" if transient_secret else "stored"
            return ProviderStatus(
                provider="openai",
                display_name=self.display_name,
                configured=True,
                available=False,
                validation_state="invalid",
                ready=False,
                message=f"The {source} OpenAI API key does not match the expected format.",
                is_local=False,
            )

        masked = mask_secret(secret)
        if transient_secret:
            message = f"OpenAI API key {masked} looks valid. Save Settings to store it."
        else:
            message = f"OpenAI API key {masked} is stored and format validation passed."
        return ProviderStatus(
            provider="openai",
            display_name=self.display_name,
            configured=True,
            available=True,
            validation_state="valid",
            ready=True,
            message=message,
            is_local=False,
        )

    def ask(self, **kwargs: object) -> ProviderReply:
        secret_store = kwargs.get("secret_store")
        if not isinstance(secret_store, SecretStore):
            raise TypeError("secret_store is required for OpenAI ask requests.")

        secret_id = str(kwargs.get("secret_id") or "").strip()
        transient_secret = str(kwargs.get("transient_secret") or "").strip()
        prompt = str(kwargs.get("prompt") or "").strip()
        model = str(kwargs.get("model") or _DEFAULT_OPENAI_MODEL).strip() or _DEFAULT_OPENAI_MODEL
        if not prompt:
            return ProviderReply(
                provider="openai",
                ok=False,
                text="",
                message="Provide a prompt after /ask before sending it to OpenAI.",
                model=model,
            )

        validation = self.validate(
            secret_store=secret_store,
            secret_id=secret_id,
            transient_secret=transient_secret,
        )
        if not validation.ready:
            return ProviderReply(
                provider="openai",
                ok=False,
                text="",
                message=validation.message,
                model=model,
            )

        secret = transient_secret or secret_store.get_secret(secret_id)
        try:
            payload = self._post_json(
                _OPENAI_RESPONSES_URL,
                {
                    "model": model,
                    "instructions": (
                        "You are Windows OpenClaw Operator Console v1.2. "
                        "Reply concisely in plain text, keep the answer under 6 short sentences, "
                        "and do not include hidden reasoning."
                    ),
                    "input": prompt,
                    "max_output_tokens": 220,
                },
                api_key=secret,
                timeout=_OPENAI_TIMEOUT_SECONDS,
            )
        except RuntimeError as exc:
            return ProviderReply(
                provider="openai",
                ok=False,
                text="",
                message=f"OpenAI request failed: {exc}",
                model=model,
            )

        text = self._extract_text(payload)
        if not text:
            return ProviderReply(
                provider="openai",
                ok=False,
                text="",
                message="OpenAI returned an empty text response.",
                model=model,
            )

        return ProviderReply(
            provider="openai",
            ok=True,
            text=self._trim_text(text),
            message=f"OpenAI replied with model '{model}'.",
            model=model,
        )

    @staticmethod
    def _looks_like_openai_key(secret: str) -> bool:
        trimmed = secret.strip()
        return trimmed.startswith("sk-") and len(trimmed) >= 20

    @staticmethod
    def _post_json(url: str, payload: dict[str, object], *, api_key: str, timeout: float) -> dict[str, object]:
        body = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(
            url,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                response_payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                error_payload = json.loads(exc.read().decode("utf-8"))
                detail = str(error_payload.get("error", {}).get("message") or error_payload.get("message") or "")
            except (OSError, ValueError, AttributeError):
                detail = ""
            suffix = f" {detail}".rstrip()
            raise RuntimeError(f"OpenAI returned HTTP {exc.code}.{suffix}".strip()) from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            raise RuntimeError(str(exc)) from None
        if not isinstance(response_payload, dict):
            raise RuntimeError("OpenAI returned an invalid JSON payload.")
        return response_payload

    @staticmethod
    def _extract_text(payload: dict[str, object]) -> str:
        output = payload.get("output")
        if isinstance(output, list):
            texts: list[str] = []
            for item in output:
                if not isinstance(item, dict):
                    continue
                contents = item.get("content")
                if not isinstance(contents, list):
                    continue
                for content in contents:
                    if not isinstance(content, dict):
                        continue
                    if str(content.get("type") or "") != "output_text":
                        continue
                    text = str(content.get("text") or "").strip()
                    if text:
                        texts.append(text)
            if texts:
                return "\n".join(texts).strip()
        output_text = payload.get("output_text")
        if isinstance(output_text, str):
            return output_text.strip()
        return ""

    @staticmethod
    def _trim_text(text: str, *, limit: int = _OPENAI_MAX_RESPONSE_CHARS) -> str:
        normalized = " ".join(text.split())
        if len(normalized) <= limit:
            return normalized
        return f"{normalized[: limit - 3]}..."
