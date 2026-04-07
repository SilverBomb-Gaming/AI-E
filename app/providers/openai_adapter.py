"""OpenAI provider validation for Online Mode."""
from __future__ import annotations

from ..platform.secrets import SecretStore
from .base import BaseProviderAdapter, ProviderStatus


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

    @staticmethod
    def _looks_like_openai_key(secret: str) -> bool:
        trimmed = secret.strip()
        return trimmed.startswith("sk-") and len(trimmed) >= 20
