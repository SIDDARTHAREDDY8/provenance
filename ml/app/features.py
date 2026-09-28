"""Feature extraction for the claim-risk classifier.

Mirrored in web/src/lib/ml/features.ts. The two definitions are checked against
each other by evaluate.py: training/serving skew in a model that decides where
verification effort goes would surface as quietly worse verification, which is
the kind of regression nobody notices for a quarter.
"""

from __future__ import annotations

import re

FEATURE_VERSION = 2

FEATURE_NAMES = [
    "has_number",
    "has_large_number",
    "has_superlative",
    "has_scope_verb",
    "asserts_level",
    "asserts_top_level",
    "is_achievement",
    "is_credential",
    "word_count_norm",
    "retrieval_max",
    "retrieval_mean",
    "retrieval_count_norm",
]

SUPERLATIVES = re.compile(
    r"\b(expert|world-class|best|leading|pioneer|unmatched|exceptional|deep expertise)\b", re.I
)
SCOPE_VERBS = re.compile(
    r"\b(led|owned|architected|founded|headed|drove|spearheaded|managed)\b", re.I
)
NUMBERS = re.compile(r"\d[\d,.]*")


def extract(
    text: str,
    category: str,
    asserted_level: str | None,
    retrieval_scores: list[float],
) -> dict[str, float]:
    numbers = NUMBERS.findall(text)
    largest = 0.0
    for n in numbers:
        try:
            largest = max(largest, float(n.replace(",", "")))
        except ValueError:
            continue
    scores = retrieval_scores or [0.0]

    return {
        "has_number": 1.0 if numbers else 0.0,
        "has_large_number": 1.0 if largest >= 10 else 0.0,
        "has_superlative": 1.0 if SUPERLATIVES.search(text) else 0.0,
        "has_scope_verb": 1.0 if SCOPE_VERBS.search(text) else 0.0,
        "asserts_level": 1.0 if asserted_level else 0.0,
        "asserts_top_level": 1.0 if asserted_level in ("expert", "advanced") else 0.0,
        "is_achievement": 1.0 if category == "achievement" else 0.0,
        "is_credential": 1.0 if category == "credential" else 0.0,
        "word_count_norm": min(1.0, len(text.split()) / 40),
        "retrieval_max": max(scores),
        "retrieval_mean": sum(scores) / len(scores),
        "retrieval_count_norm": min(1.0, len(retrieval_scores) / 6),
    }


def vector(features: dict[str, float]) -> list[float]:
    return [float(features.get(name, 0.0)) for name in FEATURE_NAMES]
