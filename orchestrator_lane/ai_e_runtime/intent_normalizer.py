from __future__ import annotations

import re


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


def normalize_prompt(prompt: str) -> str:
    normalized = str(prompt or "").lower().strip()
    normalized = _PUNCTUATION_PATTERN.sub(" ", normalized)
    for pattern, replacement in _REPLACEMENTS:
        normalized = pattern.sub(replacement, normalized)
    return _WHITESPACE_PATTERN.sub(" ", normalized).strip()


def fuzzy_match(prompt: str) -> str | None:
    normalized = normalize_prompt(prompt)
    tokens = set(normalized.split())
    if {"move", "zombie", "forward"}.issubset(tokens):
        return "move zombie forward"
    return None
