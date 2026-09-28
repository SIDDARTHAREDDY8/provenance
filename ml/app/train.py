"""Train both models and export coefficients for TypeScript inference.

Serving a logistic regression over HTTP would be silly — it is a dot product.
Training happens here with a proper split and reported metrics; the exported
JSON is read directly by web/src/lib/ml/infer.ts.

    uv run python -m app.train
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import train_test_split

from .features import FEATURE_NAMES, FEATURE_VERSION
from .synth import RANK_FEATURES, generate, generate_ranking

OUT = Path(__file__).resolve().parents[2] / "web" / "data" / "models"


def _fit(X: np.ndarray, y: np.ndarray, names: list[str], name: str) -> dict:
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=7, stratify=y
    )
    # L2 with modest C: the feature count is small and the generator is noisy,
    # so the useful thing here is calibration, not squeezing out AUC.
    model = LogisticRegression(max_iter=2000, C=0.9, class_weight="balanced")
    model.fit(X_train, y_train)

    proba = model.predict_proba(X_test)[:, 1]
    metrics = {
        "roc_auc": round(float(roc_auc_score(y_test, proba)), 4),
        "average_precision": round(float(average_precision_score(y_test, proba)), 4),
        "brier": round(float(brier_score_loss(y_test, proba)), 4),
        "n_train": int(len(y_train)),
        "n_test": int(len(y_test)),
        "positive_rate": round(float(y.mean()), 4),
    }

    print(f"\n{name}")
    for k, v in metrics.items():
        print(f"  {k:<20} {v}")
    print("  coefficients")
    for n, c in sorted(zip(names, model.coef_[0]), key=lambda kv: -abs(kv[1])):
        print(f"    {n:<24} {c:+.3f}")

    return {
        "name": name,
        "featureVersion": FEATURE_VERSION,
        "features": names,
        "coefficients": [round(float(c), 6) for c in model.coef_[0]],
        "intercept": round(float(model.intercept_[0]), 6),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
        "metrics": metrics,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    X, y = generate()
    risk = _fit(X, y, list(FEATURE_NAMES), "claim_risk")
    (OUT / "claim_risk.json").write_text(json.dumps(risk, indent=2))

    Xr, yr = generate_ranking()
    ranker = _fit(Xr, yr, list(RANK_FEATURES), "review_ranker")
    (OUT / "review_ranker.json").write_text(json.dumps(ranker, indent=2))

    print(f"\nWrote {OUT}/claim_risk.json and {OUT}/review_ranker.json")
    print("Trained on synthetic data from a documented generator — see app/synth.py.")


if __name__ == "__main__":
    main()
