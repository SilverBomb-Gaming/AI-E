from __future__ import annotations

import re
from dataclasses import dataclass


_PUNCTUATION_PATTERN = re.compile(r"[\.,!\?;:]+")
_WHITESPACE_PATTERN = re.compile(r"\s+")
_REPLACEMENTS = (
    (re.compile(r"\bbackwards\b"), " backward "),
    (re.compile(r"\ba\s+bit\b"), " "),
    (re.compile(r"\bagain\b"), " "),
    (re.compile(r"\bslightly\b"), " "),
    (re.compile(r"\bjust\b"), " "),
    (re.compile(r"\bplease\b"), " "),
)
_ENTITY_MAPPINGS = (
    ("enemy", "zombie"),
    ("character", "zombie"),
)


@dataclass(frozen=True)
class PromptEntityMapping:
    source_term: str
    target_term: str


@dataclass(frozen=True)
class PromptResolution:
    normalized_prompt: str
    lookup_prompt: str
    applied_entity_mappings: tuple[PromptEntityMapping, ...]

    @property
    def entity_mapping_applied(self) -> bool:
        return bool(self.applied_entity_mappings)


def normalize_prompt(prompt: str) -> str:
    normalized = str(prompt or "").lower().strip()
    normalized = _PUNCTUATION_PATTERN.sub(" ", normalized)
    for pattern, replacement in _REPLACEMENTS:
        normalized = pattern.sub(replacement, normalized)
    return _WHITESPACE_PATTERN.sub(" ", normalized).strip()


def resolve_prompt(prompt: str) -> PromptResolution:
    normalized_prompt = normalize_prompt(prompt)
    lookup_prompt = normalized_prompt
    applied: list[PromptEntityMapping] = []
    for source_term, target_term in _ENTITY_MAPPINGS:
        pattern = re.compile(rf"\b{re.escape(source_term)}\b")
        if pattern.search(lookup_prompt) is None:
            continue
        lookup_prompt = pattern.sub(target_term, lookup_prompt)
        mapping = PromptEntityMapping(source_term=source_term, target_term=target_term)
        if mapping not in applied:
            applied.append(mapping)
    lookup_prompt = _WHITESPACE_PATTERN.sub(" ", lookup_prompt).strip()
    return PromptResolution(
        normalized_prompt=normalized_prompt,
        lookup_prompt=lookup_prompt,
        applied_entity_mappings=tuple(applied),
    )


def entity_confirmation_message(resolution: PromptResolution) -> str | None:
    if not resolution.applied_entity_mappings:
        return None
    sources = [f'"{mapping.source_term}"' for mapping in resolution.applied_entity_mappings]
    source_label = ", ".join(sources)
    return (
        f"I understood {source_label} as the supported zombie system in BABYLON. "
        "AI-E can continue only if you want to use that supported target. "
        "Confirm the zombie target before execution."
    )


def fuzzy_match(prompt: str) -> str | None:
    resolution = resolve_prompt(prompt)
    tokens = set(resolution.lookup_prompt.split())
    if {"move", "zombie", "forward"}.issubset(tokens):
        return "move zombie forward"
    return None
