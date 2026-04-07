"""Provider adapters for local/offline and remote/online configuration."""

from .base import BaseProviderAdapter, ProviderStatus, ProviderType, ValidationState
from .ollama_adapter import OllamaProviderAdapter
from .openai_adapter import OpenAIProviderAdapter, mask_secret

__all__ = [
    "BaseProviderAdapter",
    "OllamaProviderAdapter",
    "OpenAIProviderAdapter",
    "ProviderStatus",
    "ProviderType",
    "ValidationState",
    "mask_secret",
]
