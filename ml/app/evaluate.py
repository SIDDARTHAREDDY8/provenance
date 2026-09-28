"""Evaluation for the ML side.

Two things are checked, because they fail independently:

1. Does the classifier work on data it was not fitted to — including the real
   fixture claims, which come from a different distribution than the generator?
2. Does the Python feature extractor agree, feature for feature, with the
   TypeScript one that actually runs in production? A model is only as good as
   the features it is served, and silent skew is invisible in accuracy numbers.

    uv run python -m app.evaluate
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import roc_auc_score

from .features import FEATURE_NAMES, FEATURE_VERSION, extract, vector
from .synth import generate

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "web" / "data" / "models"
FIXTURES = ROOT / "web" / "data" / "gold" / "claim_outcomes.json"


def predict(model: dict, feats: dict[str, float]) -> float:
    z = model["intercept"] + sum(
        c * feats.get(n, 0.0) for n, c in zip(model["features"], model["coefficients"])
    )
    return float(1 / (1 + np.exp(-z)))


def main() -> int:
    path = MODELS / "claim_risk.json"
    if not path.exists():
        print("claim_risk.json missing — run: uv run python -m app.train")
        return 1
    model = json.loads(path.read_text())

    failures: list[str] = []
    print(f"\nML evaluation — feature version {FEATURE_VERSION}\n")

    # --- held-out synthetic -------------------------------------------------
    X, y = generate(n=800, seed=99)
    proba = np.array(
        [predict(model, dict(zip(FEATURE_NAMES, row))) for row in X]
    )
    auc = roc_auc_score(y, proba)
    print(f"Held-out synthetic (n=800)   roc_auc {auc:.3f}")
    if auc < 0.80:
        failures.append(f"synthetic roc_auc {auc:.3f} below 0.80")

    # --- real fixture claims ------------------------------------------------
    if FIXTURES.exists():
        gold = json.loads(FIXTURES.read_text())
        rows = gold["claims"]
        gy = np.array([1 if r["outcome"] in ("unsupported", "contradicted") else 0 for r in rows])
        gp = np.array(
            [
                predict(
                    model,
                    extract(r["text"], r["category"], r.get("assertedLevel"), r.get("retrievalScores", [])),
                )
                for r in rows
            ]
        )
        if len(set(gy.tolist())) < 2:
            print("Real fixture claims          skipped — single class")
        else:
            gauc = roc_auc_score(gy, gp)
            print(f"Real fixture claims (n={len(rows)})    roc_auc {gauc:.3f}")
            # Deliberately loose. Fourteen out-of-distribution examples is a
            # smoke test, not a measurement, and pretending otherwise would be
            # the exact overclaiming this product exists to catch.
            if gauc < 0.65:
                failures.append(f"fixture roc_auc {gauc:.3f} below 0.65")
    else:
        print("Real fixture claims          skipped — no gold/claim_outcomes.json")

    # --- parity with the TypeScript extractor -------------------------------
    parity = ROOT / "web" / ".data" / "feature-parity.json"
    if parity.exists():
        cases = json.loads(parity.read_text())
        drift = []
        for case in cases:
            mine = extract(
                case["text"], case["category"], case.get("assertedLevel"), case.get("retrievalScores", [])
            )
            for name in FEATURE_NAMES:
                a, b = mine[name], case["features"].get(name)
                if b is None or abs(a - float(b)) > 1e-6:
                    drift.append(f"{case['id']}.{name}: py={a} ts={b}")
        print(f"Feature parity vs TypeScript {len(cases)} cases, {len(drift)} mismatches")
        for d in drift[:8]:
            print(f"    ✗ {d}")
        if drift:
            failures.append(f"{len(drift)} feature mismatches between Python and TypeScript")
    else:
        print("Feature parity               skipped — run `npm run eval` in web/ first")

    print()
    if failures:
        print("FAIL")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("PASS — all gates met\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
