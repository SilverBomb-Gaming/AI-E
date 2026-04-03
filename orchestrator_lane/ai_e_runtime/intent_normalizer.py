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
_CANONICAL_PATTERNS = (
    (re.compile(r"\bspeed\s+up\s+(?:the\s+)?([a-z0-9_]+)\b"), r"make \1 faster"),
    (re.compile(r"\bslow\s+(?:the\s+)?([a-z0-9_]+)\s+down\b"), r"make \1 slower"),
)
_ENTITY_MAPPINGS = (
    ("enemy", "zombie"),
    ("character", "zombie"),
)
_GENERALIZED_ENTITY_TERMS = frozenset(source_term for source_term, _ in _ENTITY_MAPPINGS)


@dataclass(frozen=True)
class PromptEntityMapping:
    source_term: str
    target_term: str


@dataclass(frozen=True)
class PromptResolution:
    normalized_prompt: str
    lookup_prompt: str
    applied_entity_mappings: tuple[PromptEntityMapping, ...]
    ambiguous_entity_terms: tuple[str, ...]

    @property
    def entity_mapping_applied(self) -> bool:
        return bool(self.applied_entity_mappings)

    @property
    def entity_ambiguity_detected(self) -> bool:
        return bool(self.ambiguous_entity_terms)


def normalize_prompt(prompt: str) -> str:
    normalized = str(prompt or "").lower().strip()
    normalized = _PUNCTUATION_PATTERN.sub(" ", normalized)
    for pattern, replacement in _REPLACEMENTS:
        normalized = pattern.sub(replacement, normalized)
    for pattern, replacement in _CANONICAL_PATTERNS:
        normalized = pattern.sub(replacement, normalized)
    return _WHITESPACE_PATTERN.sub(" ", normalized).strip()


def resolve_prompt(prompt: str) -> PromptResolution:
    normalized_prompt = normalize_prompt(prompt)
    lookup_prompt = normalized_prompt
    applied: list[PromptEntityMapping] = []
    ambiguous_terms: list[str] = []
    for source_term, target_term in _ENTITY_MAPPINGS:
        pattern = re.compile(rf"\b{re.escape(source_term)}\b")
        if pattern.search(lookup_prompt) is None:
            continue
        if source_term in _GENERALIZED_ENTITY_TERMS and len(_supported_enemy_entities()) > 1:
            if source_term not in ambiguous_terms:
                ambiguous_terms.append(source_term)
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
        ambiguous_entity_terms=tuple(ambiguous_terms),
    )


def entity_confirmation_message(resolution: PromptResolution) -> str | None:
    if not resolution.applied_entity_mappings:
        return None
    sources = [f'"{mapping.source_term}"' for mapping in resolution.applied_entity_mappings]
    source_label = ", ".join(sources)
    targets = [str(mapping.target_term).strip() for mapping in resolution.applied_entity_mappings if str(mapping.target_term).strip()]
    target_label = ", ".join(dict.fromkeys(targets))
    return (
        f"I understood {source_label} as the supported {target_label} system in BABYLON. "
        "AI-E can continue only if you want to use that supported target. "
        "Confirm that supported target before execution."
    )


def fuzzy_match(prompt: str) -> str | None:
    resolution = resolve_prompt(prompt)
    tokens = set(resolution.lookup_prompt.split())
    if {"move", "zombie", "forward"}.issubset(tokens):
        return "move zombie forward"
    if {"make", "zombie", "faster"}.issubset(tokens):
        return "make zombie faster"
    if {"make", "zombie", "slower"}.issubset(tokens):
        return "make zombie slower"
    if {"make", "runner", "faster"}.issubset(tokens):
        return "make runner faster"
    if {"make", "runner", "slower"}.issubset(tokens):
        return "make runner slower"
    return None


def _supported_enemy_entities() -> tuple[str, ...]:
    try:
        from .enemy_profiles import supported_enemy_entities
    except Exception:
        return ("zombie",)
    entities = tuple(str(entity).strip() for entity in supported_enemy_entities() if str(entity).strip())
    return entities or ("zombie",)
