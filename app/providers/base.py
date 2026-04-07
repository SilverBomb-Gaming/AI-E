"""Provider abstractions for mode and validation handling."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Literal, Tuple


ProviderType = Literal["ollama", "openai"]
ValidationState = Literal["unknown", "valid", "invalid", "partial"]


@dataclass(frozen=True)
class ProviderStatus:
    provider: ProviderType
    display_name: str
    configured: bool
    available: bool
    validation_state: ValidationState
    ready: bool
    message: str
    is_local: bool
    model: str = ""
    available_models: Tuple[str, ...] = ()

    def as_payload(self) -> dict[str, object]:
        return {
            "provider": self.provider,
            "display_name": self.display_name,
            "configured": self.configured,
            "available": self.available,
            "validation_state": self.validation_state,
            "ready": self.ready,
            "message": self.message,
            "is_local": self.is_local,
            "model": self.model,
            "available_models": list(self.available_models),
        }


class BaseProviderAdapter(ABC):
    provider_type: ProviderType
    display_name: str

    @abstractmethod
    def validate(self, **kwargs: object) -> ProviderStatus:
        raise NotImplementedError
