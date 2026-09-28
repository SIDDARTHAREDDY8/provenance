"""Synthetic training data, generated from a documented process.

Being explicit about this: there is no real labelled corpus of résumé claims
and their verification outcomes to train on, so the classifier is fitted on
samples drawn from a generative process written down here. That makes the
reported metrics a statement about the process, not about the world.

The process encodes hypotheses a hiring team would recognise — an unsupported
claim tends to assert scope, carry a round number, use a superlative, and
retrieve poorly — plus label noise, so the model cannot simply invert the
generator. The real fixture claims are held out in evaluate.py as a small
honest test set.
"""

from __future__ import annotations

import numpy as np

from .features import extract

CATEGORIES = ["employment", "skill", "achievement", "credential", "scope"]

VERIFIABLE_TEMPLATES = [
    "Reduced p95 latency on the invoice endpoint from 1.9s to 240ms",
    "Added a partial index on events(tenant_id, created_at) for settlement reporting",
    "Wrote the postmortem for the payout webhook stall and closed all four actions",
    "Shipped idempotency keys with a 24h replay window on the payouts API",
    "Migrated the ledger table to declarative partitioning over five staged cutovers",
    "Instrumented the settlement path with OpenTelemetry spans",
    "Replaced example tests with a property suite that found a JPY rounding bug",
    "Built a resumable settlement importer that checkpoints per file chunk",
]

RISKY_TEMPLATES = [
    "Led a team of {n} engineers across three business units",
    "Architected the company's entire {thing} platform from scratch",
    "Recognised as the leading expert in {thing} across the organisation",
    "Drove {n}% revenue growth through {thing} initiatives",
    "Owned {thing} strategy for a {n}-person engineering organisation",
    "Spearheaded the {thing} transformation delivering {n}x throughput",
    "World-class expertise in {thing} at production scale",
]

THINGS = ["streaming", "data", "payments", "ML", "infrastructure", "observability"]


def _sample(rng: np.random.Generator, risky: bool) -> tuple[dict[str, float], int]:
    if risky:
        text = rng.choice(RISKY_TEMPLATES).format(
            n=int(rng.choice([5, 8, 12, 20, 40, 60, 90])), thing=rng.choice(THINGS)
        )
        category = str(rng.choice(["scope", "achievement", "skill"], p=[0.45, 0.35, 0.20]))
        level = str(rng.choice([None, "advanced", "expert"], p=[0.2, 0.3, 0.5]))
        # Risky claims retrieve poorly: there is usually nothing in the pack.
        n_hits = int(rng.integers(0, 4))
        scores = list(np.clip(rng.normal(0.16, 0.09, n_hits), 0, 1))
        label = 1
    else:
        text = str(rng.choice(VERIFIABLE_TEMPLATES))
        category = str(rng.choice(["achievement", "skill", "employment"], p=[0.5, 0.35, 0.15]))
        level = str(rng.choice([None, "intermediate", "advanced"], p=[0.45, 0.35, 0.20]))
        n_hits = int(rng.integers(3, 7))
        scores = list(np.clip(rng.normal(0.52, 0.14, n_hits), 0, 1))
        label = 0

    # Label noise: verifiable claims whose evidence was simply never supplied,
    # and inflated claims a generous referee happened to corroborate.
    if rng.random() < 0.12:
        label = 1 - label

    feats = extract(text, category, None if level == "None" else level, scores)
    return feats, label


def generate(n: int = 2400, seed: int = 11) -> tuple[np.ndarray, np.ndarray]:
    from .features import vector

    rng = np.random.default_rng(seed)
    rows, labels = [], []
    for _ in range(n):
        feats, label = _sample(rng, risky=bool(rng.random() < 0.42))
        rows.append(vector(feats))
        labels.append(label)
    return np.array(rows, dtype=float), np.array(labels, dtype=int)


RANK_FEATURES = [
    "verified_score",
    "claimed_score",
    "inflation",
    "blockers",
    "contradicted",
    "attested_ratio",
    "distinct_sources_norm",
]


def generate_ranking(n: int = 1800, seed: int = 23) -> tuple[np.ndarray, np.ndarray]:
    """Review-priority training data.

    The label is "a human reviewer, given this application, moved it forward" —
    a scheduling target, not a hiring one. Verified fit drives it; inflation and
    contradictions suppress it; claimed fit on its own is close to worthless,
    which is the hypothesis the whole product rests on.
    """
    rng = np.random.default_rng(seed)
    rows, labels = [], []
    for _ in range(n):
        verified = float(rng.beta(2, 3))
        inflation = float(np.clip(rng.beta(2, 6), 0, 1 - verified))
        claimed = min(1.0, verified + inflation)
        blockers = int(rng.poisson(0.35))
        contradicted = int(rng.poisson(0.22))
        attested = float(rng.beta(2, 4))
        sources = float(rng.beta(3, 2))

        utility = (
            3.4 * verified
            - 1.9 * inflation
            - 1.5 * blockers
            - 1.2 * contradicted
            + 0.7 * attested
            + 0.4 * sources
            - 1.15
        )
        p = 1 / (1 + np.exp(-utility))
        labels.append(int(rng.random() < p))
        rows.append([verified, claimed, inflation, blockers, contradicted, attested, sources])

    return np.array(rows, dtype=float), np.array(labels, dtype=int)
