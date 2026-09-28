"""Entity resolution over skill and organisation surface forms.

Mirrors web/src/lib/ml/entity.ts. Served here so the same resolver can be
called from data pipelines and notebooks without going through the web app.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ACCEPT = 0.87
TOKENS = re.compile(r"[^a-z0-9]+")


def jaro_winkler(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0

    window = max(0, max(len(a), len(b)) // 2 - 1)
    a_flags = [False] * len(a)
    b_flags = [False] * len(b)
    matches = 0

    for i, ch in enumerate(a):
        for j in range(max(0, i - window), min(i + window + 1, len(b))):
            if b_flags[j] or b[j] != ch:
                continue
            a_flags[i] = b_flags[j] = True
            matches += 1
            break

    if matches == 0:
        return 0.0

    transpositions = 0
    k = 0
    for i, ch in enumerate(a):
        if not a_flags[i]:
            continue
        while not b_flags[k]:
            k += 1
        if ch != b[k]:
            transpositions += 1
        k += 1
    transpositions //= 2

    jaro = (matches / len(a) + matches / len(b) + (matches - transpositions) / matches) / 3
    prefix = 0
    for x, y in zip(a[:4], b[:4]):
        if x != y:
            break
        prefix += 1
    return jaro + prefix * 0.1 * (1 - jaro)


def token_set_ratio(a: str, b: str) -> float:
    ta = {t for t in TOKENS.split(a.lower()) if t}
    tb = {t for t in TOKENS.split(b.lower()) if t}
    if not ta or not tb:
        return 0.0
    return 2 * len(ta & tb) / (len(ta) + len(tb))


@dataclass
class Candidate:
    id: str
    label: str
    aliases: list[str]


def resolve(surface: str, candidates: list[Candidate]) -> dict[str, object]:
    needle = surface.strip().lower()
    if not needle:
        return {"id": None, "score": 0.0, "matched_on": None}

    block = needle[0]
    best_id: str | None = None
    best_score = 0.0
    best_form: str | None = None

    for cand in candidates:
        for form in [cand.id, cand.label, *cand.aliases]:
            f = form.lower()
            if f == needle:
                return {"id": cand.id, "score": 1.0, "matched_on": form}
            # Blocking, but only where a first-character mismatch is a reliable
            # negative — short forms like "ts"/"js" stay in the pool.
            if f[:1] != block and len(f) > 4 and len(needle) > 4:
                continue
            score = max(jaro_winkler(f, needle), token_set_ratio(f, needle))
            if score > best_score:
                best_score, best_id, best_form = score, cand.id, form

    if best_score >= ACCEPT:
        return {"id": best_id, "score": round(best_score, 3), "matched_on": best_form}
    return {"id": None, "score": round(best_score, 3), "matched_on": best_form}
