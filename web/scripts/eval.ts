/**
 * Verification eval.
 *
 * Scores every labelled application, then gates on the pooled result. Two
 * candidates with different failure profiles — one résumé with a couple of
 * inflated claims, one padded with borrowed credit and stale numbers — catch
 * different things, and a harness tuned on a single corpus tells you mostly
 * about that corpus.
 *
 * Five axes, because they fail independently and the consequences differ:
 *
 *   1. Verdict accuracy  — did we reach the conclusion a human reached?
 *   2. Adverse precision — when we said "contradicted" or "unsupported", were
 *      we right? Weighted above recall on purpose: a false adverse verdict is a
 *      person not hired for a reason that was not true.
 *   3. Retrieval recall  — was the deciding document even in context? Scored
 *      apart from adjudication because "judged badly" and "never shown the
 *      document" need opposite fixes and otherwise look identical.
 *   4. Grounding         — an adversarial probe against the citation validator.
 *   5. Score integrity   — verification must never inflate a claimed score.
 *
 * Also writes .data/feature-parity.json for ml/app/evaluate.py.
 *
 *   npm run eval
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assessApplication } from "../src/lib/assess";
import { checkCitations } from "../src/lib/verify";
import { store } from "../src/lib/store";
import { extractFeatures } from "../src/lib/ml/features";
import { claimRisk } from "../src/lib/ml/infer";
import type { VerdictStatus } from "../src/lib/types";

interface GoldApplication {
  candidateId: string;
  verdicts: Record<string, { status: VerdictStatus; text: string; expectedEvidence?: string }>;
}
interface Gold {
  note: string;
  applications: Record<string, GoldApplication>;
}

const ADVERSE: VerdictStatus[] = ["contradicted", "unsupported"];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (label: string, value: string, note = "") =>
  console.log(`  ${label.padEnd(28)} ${value.padEnd(10)} ${note}`);

interface Pooled {
  exact: number;
  total: number;
  advTp: number;
  advPredicted: number;
  advActual: number;
  retrievedOk: number;
  retrievedTotal: number;
  citations: number;
  uncitedContradictions: number;
  stepFailures: number;
  inflated: number;
  riskFlagged: number;
  claims: number;
}

async function scoreOne(
  applicationId: string,
  gold: GoldApplication,
  p: Pooled,
  parity: unknown[],
): Promise<void> {
  const assessment = await assessApplication(applicationId);
  const { run, verdicts, match, claims, fabricated } = assessment;

  console.log(`\n── ${applicationId} · ${gold.candidateId} ──`);
  console.log(
    `  ${claims.length} claims · ${run.totalModelCalls} model calls · ` +
      `${assessment.embedder} over ${assessment.indexSize} chunks`,
  );

  for (const step of run.steps) {
    const failed = step.checks.filter((c) => !c.passed);
    if (step.status === "failed") p.stepFailures += 1;
    for (const c of failed) console.log(`      ✗ ${step.agent}/${c.name}: ${c.detail}`);
  }

  // 1. verdict accuracy
  let exact = 0;
  const disagreements: string[] = [];
  for (const v of verdicts) {
    const want = gold.verdicts[v.claimId];
    if (!want) continue;
    if (want.status === v.status) exact += 1;
    else disagreements.push(`${v.claimId}: got ${v.status}, expected ${want.status}`);
  }
  p.exact += exact;
  p.total += verdicts.length;
  row("verdict accuracy", pct(verdicts.length ? exact / verdicts.length : 0), `${exact}/${verdicts.length}`);
  for (const d of disagreements) row("", "", d);

  // 2. adverse precision / recall
  const predicted = verdicts.filter((v) => ADVERSE.includes(v.status));
  const actual = Object.entries(gold.verdicts).filter(([, g]) => ADVERSE.includes(g.status));
  const tp = predicted.filter((v) => ADVERSE.includes(gold.verdicts[v.claimId]?.status as VerdictStatus));
  p.advTp += tp.length;
  p.advPredicted += predicted.length;
  p.advActual += actual.length;
  row("adverse precision", pct(predicted.length ? tp.length / predicted.length : 1), `${tp.length}/${predicted.length}`);
  row("adverse recall", pct(actual.length ? tp.length / actual.length : 1), `${tp.length}/${actual.length}`);

  const uncited = predicted.filter((v) => v.status === "contradicted" && v.citations.length === 0);
  p.uncitedContradictions += uncited.length;

  // 3. retrieval recall
  const labelled = Object.entries(gold.verdicts).filter(([, g]) => g.expectedEvidence);
  const found = labelled.filter(([claimId, g]) =>
    (assessment.retrieval[claimId] ?? []).some((r) => r.docId === g.expectedEvidence),
  );
  p.retrievedOk += found.length;
  p.retrievedTotal += labelled.length;
  row("retrieval recall", pct(labelled.length ? found.length / labelled.length : 1), `${found.length}/${labelled.length}`);
  for (const [claimId, g] of labelled.filter(([id]) => !found.some(([f]) => f === id))) {
    row("", "", `${claimId}: ${g.expectedEvidence} not retrieved — verdict was context-limited`);
  }

  // 4/5. grounding and score integrity
  p.citations += verdicts.flatMap((v) => v.citations).length;
  if (match.verifiedScore > match.claimedScore + 1e-9) p.inflated += 1;
  row("claimed → verified", `${pct(match.claimedScore)} → ${pct(match.verifiedScore)}`,
    `inflation ${pct(match.claimedScore - match.verifiedScore)} · ${assessment.decision.outcome}`);
  if (fabricated.length > 0) {
    for (const f of fabricated) console.log(`      ✗ ${f.claimId} → ${f.docId} [${f.reason}]`);
  }

  // claim-risk features, for the Python parity check
  for (const claim of claims) {
    const scores = (assessment.retrieval[claim.id] ?? []).map((r) => r.score);
    const features = extractFeatures({ claim, retrievalScores: scores });
    parity.push({
      id: `${applicationId}/${claim.id}`,
      text: claim.text,
      category: claim.category,
      assertedLevel: claim.assertedLevel ?? null,
      retrievalScores: scores,
      features,
    });
    const risk = await claimRisk(features);
    if (risk !== null && risk >= 0.5) p.riskFlagged += 1;
    p.claims += 1;
  }
}

/** Attack the validator directly: honest captured output cites honestly, so a
 *  zero-rejection run says nothing about whether the gate works. */
async function probe(candidateId: string): Promise<{ passed: boolean; reasons: string[] }> {
  const docs = await store().evidence(candidateId);
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const first = docs[0];
  const second = docs[1];
  if (!first || !second) return { passed: false, reasons: [] };

  const realQuoteFromElsewhere = second.body.slice(0, 60);
  const result = checkCitations(
    [
      { docId: first.id, quote: "This candidate personally rewrote the entire platform over one weekend" },
      { docId: "ev_does_not_exist", quote: "A well-formed quote attributed to a phantom document" },
      { docId: second.id, quote: realQuoteFromElsewhere },
    ],
    docsById,
    new Set([first.id]),
  );
  return { passed: result.valid.length === 0 && result.rejected.length === 3, reasons: result.rejected.map((r) => r.reason) };
}

async function reportAndGate(p: Pooled, parity: unknown[], probeResult: { passed: boolean; reasons: string[] }): Promise<void> {
  const accuracy = p.total ? p.exact / p.total : 0;
  const precision = p.advPredicted ? p.advTp / p.advPredicted : 1;
  const recall = p.advActual ? p.advTp / p.advActual : 1;
  const retrieval = p.retrievedTotal ? p.retrievedOk / p.retrievedTotal : 1;

  console.log(`\n── pooled ──`);
  row("verdict accuracy", pct(accuracy), `${p.exact}/${p.total} claims`);
  row("adverse precision", pct(precision), `${p.advTp}/${p.advPredicted} adverse calls correct`);
  row("adverse recall", pct(recall), `${p.advTp}/${p.advActual} adverse claims caught`);
  row("retrieval recall", pct(retrieval), `${p.retrievedOk}/${p.retrievedTotal} deciding documents`);
  row("citations in verdicts", String(p.citations));
  row("claim-risk flagged", String(p.riskFlagged), `of ${p.claims} claims, pre-corroboration`);

  console.log(`\n── adversarial probe ──`);
  row("fabricated quote", probeResult.reasons.includes("quote_not_found") ? "rejected" : "LEAKED");
  row("phantom document", probeResult.reasons.includes("unknown_document") ? "rejected" : "LEAKED");
  row("quote outside context", probeResult.reasons.includes("not_retrieved") ? "rejected" : "LEAKED");

  const dir = path.join(process.cwd(), ".data");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "feature-parity.json"), JSON.stringify(parity, null, 2));
  console.log(`\n  ${parity.length} parity cases → .data/feature-parity.json`);

  const failures: string[] = [];
  if (!probeResult.passed) failures.push("the citation validator let an adversarial citation through");
  if (p.uncitedContradictions > 0) failures.push(`${p.uncitedContradictions} contradicted verdict(s) with no citation`);
  if (p.inflated > 0) failures.push("verification inflated a claimed score");
  if (p.stepFailures > 0) failures.push(`${p.stepFailures} pipeline step(s) failed`);
  if (precision < 0.9) failures.push(`adverse precision ${pct(precision)} below 90%`);
  if (accuracy < 0.85) failures.push(`verdict accuracy ${pct(accuracy)} below 85%`);
  if (retrieval < 0.85) failures.push(`retrieval recall ${pct(retrieval)} below 85%`);

  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("PASS — all gates met\n");
}

async function main(): Promise<void> {
  const gold = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "gold", "verdicts.json"), "utf8"),
  ) as Gold;

  const pooled: Pooled = {
    exact: 0, total: 0, advTp: 0, advPredicted: 0, advActual: 0,
    retrievedOk: 0, retrievedTotal: 0, citations: 0, uncitedContradictions: 0,
    stepFailures: 0, inflated: 0, riskFlagged: 0, claims: 0,
  };
  const parity: unknown[] = [];

  const entries = Object.entries(gold.applications);
  console.log(`\nVerification eval — ${entries.length} labelled applications`);
  for (const [applicationId, spec] of entries) {
    await scoreOne(applicationId, spec, pooled, parity);
  }

  const first = entries[0];
  const probeResult = first ? await probe(first[1].candidateId) : { passed: false, reasons: [] };
  await reportAndGate(pooled, parity, probeResult);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
