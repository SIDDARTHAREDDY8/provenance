/**
 * Verification eval.
 *
 * Four axes, because they fail independently and the consequences differ:
 *
 *   1. Verdict accuracy — did we reach the conclusion a human reached?
 *   2. Adverse precision — when we said "contradicted" or "unsupported", were
 *      we right? A false adverse verdict is a person not hired for a reason
 *      that was not true, so this is weighted above recall on purpose.
 *   3. Grounding — did any citation that does not exist survive into a verdict?
 *      Hard gate. One is a failure.
 *   4. Score integrity — verification must never inflate a claimed score.
 *
 * Also writes .data/feature-parity.json so ml/app/evaluate.py can check that
 * the Python feature extractor agrees with this one, feature for feature.
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

interface Gold {
  candidateId: string;
  verdicts: Record<string, { status: VerdictStatus; text: string; expectedEvidence?: string }>;
}

const ADVERSE: VerdictStatus[] = ["contradicted", "unsupported"];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const row = (label: string, value: string, note = "") =>
  console.log(`  ${label.padEnd(28)} ${value.padEnd(10)} ${note}`);

async function main(): Promise<void> {
  const gold = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "gold", "verdicts.json"), "utf8"),
  ) as Gold;

  const assessment = await assessApplication("app_001");
  const { run, verdicts, match, fabricated, claims } = assessment;

  console.log(`\nVerification eval — provider=${run.provider} model=${run.model}`);
  console.log(`Retrieval: ${assessment.embedder} over ${assessment.indexSize} chunks`);
  console.log(`Run: ${run.steps.length} steps · ${run.totalModelCalls} model calls\n`);

  console.log("Pipeline steps");
  for (const step of run.steps) {
    const failed = step.checks.filter((c) => !c.passed);
    row(
      `${step.agent}`,
      step.status,
      `${step.modelCalls} calls · ${step.checks.length - failed.length}/${step.checks.length} checks · ${step.latencyMs}ms`,
    );
    for (const c of failed) console.log(`      ✗ ${c.name}: ${c.detail}`);
  }

  // --- 1. verdict accuracy ---------------------------------------------------
  let exact = 0;
  const disagreements: string[] = [];
  for (const v of verdicts) {
    const want = gold.verdicts[v.claimId];
    if (!want) continue;
    if (want.status === v.status) exact += 1;
    else disagreements.push(`${v.claimId}: got ${v.status}, expected ${want.status}`);
  }
  const accuracy = verdicts.length === 0 ? 0 : exact / verdicts.length;

  console.log("\nVerdict accuracy");
  row("exact agreement", pct(accuracy), `${exact}/${verdicts.length}`);
  for (const d of disagreements) row("", "", d);

  // --- 2. adverse precision / recall ----------------------------------------
  const predictedAdverse = verdicts.filter((v) => ADVERSE.includes(v.status));
  const actualAdverse = Object.entries(gold.verdicts).filter(([, g]) => ADVERSE.includes(g.status));
  const truePositives = predictedAdverse.filter((v) => ADVERSE.includes(gold.verdicts[v.claimId]?.status as VerdictStatus));
  const precision = predictedAdverse.length === 0 ? 1 : truePositives.length / predictedAdverse.length;
  const recall = actualAdverse.length === 0 ? 1 : truePositives.length / actualAdverse.length;

  console.log("\nAdverse verdicts");
  row("precision", pct(precision), `${truePositives.length}/${predictedAdverse.length} adverse calls correct`);
  row("recall", pct(recall), `${truePositives.length}/${actualAdverse.length} adverse claims caught`);
  const uncited = predictedAdverse.filter((v) => v.status === "contradicted" && v.citations.length === 0);
  row("contradictions cited", uncited.length === 0 ? "yes" : "NO", `${uncited.length} uncited`);

  // --- 2b. retrieval recall --------------------------------------------------
  //
  // Scored separately because an adjudicator cannot be better than its context.
  // Without this, "the model judged badly" and "the model was never shown the
  // deciding document" both surface as a verdict error, and they need opposite
  // fixes.
  const labelled = Object.entries(gold.verdicts).filter(([, g]) => g.expectedEvidence);
  const retrieved = labelled.filter(([claimId, g]) =>
    (assessment.retrieval[claimId] ?? []).some((r) => r.docId === g.expectedEvidence),
  );
  const missed = labelled.filter(([claimId]) => !retrieved.some(([id]) => id === claimId));

  console.log("\nRetrieval");
  row("deciding doc retrieved", pct(labelled.length ? retrieved.length / labelled.length : 1),
    `${retrieved.length}/${labelled.length} labelled claims`);
  for (const [claimId, g] of missed) {
    row("", "", `${claimId}: ${g.expectedEvidence} not retrieved — verdict was context-limited`);
  }

  // --- 3. grounding ----------------------------------------------------------
  const allCitations = verdicts.flatMap((v) => v.citations);
  console.log("\nGrounding");
  row("citations in verdicts", String(allCitations.length));
  row("rejected by validator", String(fabricated.length), fabricated.map((f) => f.reason).join(", "));
  for (const f of fabricated) {
    console.log(`      ✗ ${f.claimId} → ${f.docId} [${f.reason}] "${f.quote.slice(0, 70)}…"`);
  }

  // --- 3b. adversarial probe -------------------------------------------------
  //
  // With real captured output the model cites honestly, so "0 rejected" says
  // nothing about whether the gate works. Rather than plant a fabrication in the
  // fixtures and call catching it a result, the validator is attacked directly
  // with one citation of each kind it must refuse.
  const docs = await store().evidence(gold.candidateId);
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const retrievedForProbe = new Set(["ev_001"]);
  const probe = checkCitations(
    [
      { docId: "ev_001", quote: "Maya single-handedly rewrote the entire settlement platform in one weekend" },
      { docId: "ev_does_not_exist", quote: "A perfectly well-formed quote attributed to a phantom document" },
      { docId: "ev_004", quote: "Proposal to move the ledger_entries table (890M rows) to declarative partitioning" },
    ],
    docsById,
    retrievedForProbe,
  );
  const probeReasons = probe.rejected.map((r) => r.reason);
  const probePassed = probe.valid.length === 0 && probeReasons.length === 3;

  console.log("\nAdversarial probe");
  row("fabricated quote", probeReasons.includes("quote_not_found") ? "rejected" : "LEAKED");
  row("phantom document", probeReasons.includes("unknown_document") ? "rejected" : "LEAKED");
  row("real quote, not in context", probeReasons.includes("not_retrieved") ? "rejected" : "LEAKED");

  // --- 4. score integrity ----------------------------------------------------
  console.log("\nScoring");
  row("claimed fit", pct(match.claimedScore));
  row("verified fit", pct(match.verifiedScore));
  row("inflation", pct(match.claimedScore - match.verifiedScore), "what an ATS would have believed");
  row("blockers", String(match.blockers.length), match.blockers.join(", "));
  row("decision", assessment.decision.outcome, assessment.decision.requiresHumanSignoff ? "held for signoff" : "");

  // --- claim-risk model ------------------------------------------------------
  const parity: unknown[] = [];
  let risky = 0;
  for (const claim of claims) {
    const scores = (assessment.retrieval[claim.id] ?? []).map((r) => r.score);
    const features = extractFeatures({ claim, retrievalScores: scores });
    parity.push({
      id: claim.id,
      text: claim.text,
      category: claim.category,
      assertedLevel: claim.assertedLevel ?? null,
      retrievalScores: scores,
      features,
    });
    const risk = await claimRisk(features);
    if (risk !== null && risk >= 0.5) risky += 1;
  }
  const dir = path.join(process.cwd(), ".data");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "feature-parity.json"), JSON.stringify(parity, null, 2));

  console.log("\nClaim-risk triage");
  row("flagged high-risk", String(risky), `of ${claims.length} claims, pre-corroboration`);
  row("parity cases written", String(parity.length), ".data/feature-parity.json → ml/app/evaluate.py");

  // --- gates -----------------------------------------------------------------
  const failures: string[] = [];
  if (fabricated.some((f) => allCitations.some((c) => c.quote === f.quote))) {
    failures.push("a fabricated citation survived into a verdict");
  }
  if (uncited.length > 0) failures.push(`${uncited.length} contradicted verdict(s) with no citation`);
  if (match.verifiedScore > match.claimedScore) failures.push("verification inflated the score");
  if (precision < 0.9) failures.push(`adverse precision ${pct(precision)} below 90%`);
  const recall2 = labelled.length ? retrieved.length / labelled.length : 1;
  if (recall2 < 0.85) failures.push(`retrieval recall ${pct(recall2)} below 85%`);
  if (accuracy < 0.85) failures.push(`verdict accuracy ${pct(accuracy)} below 85%`);
  if (run.steps.some((s) => s.status === "failed")) failures.push("a pipeline step failed");
  if (!probePassed) failures.push("the citation validator let an adversarial citation through");

  console.log("");
  if (failures.length > 0) {
    console.error(`FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("PASS — all gates met\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
