"""FastAPI surface for the ML pieces.

The web app does not need this to run — it loads the exported coefficients and
does inference in-process. The service exists for the things that genuinely
want a Python runtime: batch entity resolution over a large evidence corpus,
re-scoring after a retrain, and being callable from a pipeline or a notebook
without going through the product.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .entity import Candidate, resolve
from .features import FEATURE_NAMES, FEATURE_VERSION, extract, vector

MODELS = Path(__file__).resolve().parents[2] / "web" / "data" / "models"

app = FastAPI(
    title="Provenance ML",
    version="0.1.0",
    summary="Claim-risk classification, review ranking and entity resolution",
)

_cache: dict[str, dict] = {}


def _model(name: str) -> dict:
    if name in _cache:
        return _cache[name]
    path = MODELS / f"{name}.json"
    if not path.exists():
        raise HTTPException(503, f"{name} not trained. Run: uv run python -m app.train")
    model = json.loads(path.read_text())
    if model["featureVersion"] != FEATURE_VERSION:
        raise HTTPException(
            503,
            f"{name} was trained on feature version {model['featureVersion']}, service is {FEATURE_VERSION}",
        )
    _cache[name] = model
    return model


def _predict(model: dict, feats: dict[str, float]) -> float:
    z = model["intercept"] + sum(
        c * feats.get(n, 0.0) for n, c in zip(model["features"], model["coefficients"])
    )
    return float(1 / (1 + np.exp(-z)))


class ClaimIn(BaseModel):
    text: str
    category: str = "achievement"
    asserted_level: str | None = None
    retrieval_scores: list[float] = Field(default_factory=list)


class RiskOut(BaseModel):
    risk: float
    features: dict[str, float]
    model_version: int


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "feature_version": FEATURE_VERSION,
        "models": [p.stem for p in MODELS.glob("*.json")] if MODELS.exists() else [],
    }


@app.post("/score/claim-risk", response_model=RiskOut)
def claim_risk(claim: ClaimIn) -> RiskOut:
    """Probability a claim will fail verification. Used to order work, never to decide."""
    feats = extract(claim.text, claim.category, claim.asserted_level, claim.retrieval_scores)
    return RiskOut(risk=round(_predict(_model("claim_risk"), feats), 4), features=feats, model_version=FEATURE_VERSION)


@app.post("/score/claim-risk/batch")
def claim_risk_batch(claims: list[ClaimIn]) -> list[float]:
    model = _model("claim_risk")
    return [
        round(_predict(model, extract(c.text, c.category, c.asserted_level, c.retrieval_scores)), 4)
        for c in claims
    ]


class RankIn(BaseModel):
    verified_score: float
    claimed_score: float
    inflation: float
    blockers: int = 0
    contradicted: int = 0
    attested_ratio: float = 0.0
    distinct_sources_norm: float = 0.0


@app.post("/score/review-priority")
def review_priority(item: RankIn) -> dict:
    """Which application a human reads first. A scheduling call, not an adverse action."""
    return {"priority": round(_predict(_model("review_ranker"), item.model_dump()), 4)}


class ResolveIn(BaseModel):
    surface: str
    candidates: list[dict]


@app.post("/resolve")
def resolve_entity(payload: ResolveIn) -> dict:
    cands = [
        Candidate(id=c["id"], label=c.get("label", c["id"]), aliases=c.get("aliases", []))
        for c in payload.candidates
    ]
    return resolve(payload.surface, cands)


@app.get("/features")
def features() -> dict:
    """Published so the TypeScript side can assert it is computing the same thing."""
    return {"version": FEATURE_VERSION, "names": list(FEATURE_NAMES)}


@app.post("/features/extract")
def features_extract(claim: ClaimIn) -> dict:
    feats = extract(claim.text, claim.category, claim.asserted_level, claim.retrieval_scores)
    return {"features": feats, "vector": vector(feats), "version": FEATURE_VERSION}
