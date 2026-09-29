import { runAssessment } from "@/lib/agents/pipeline";
import { record } from "@/lib/audit";
import { store, type StoredAssessment } from "@/lib/store";
import type { ReusableCorroboration } from "@/lib/agents/pipeline";
import { extractFeatures } from "@/lib/ml/features";
import { claimRisk } from "@/lib/ml/infer";

export interface AssessProgress {
  (text: string): void | Promise<void>;
}

/**
 * The application-level operation: assess one application end to end, persist
 * it, and leave an audit trail. Called by the queue worker and by the eval
 * harness, so the thing under test is the thing that runs.
 */
export async function assessApplication(
  applicationId: string,
  progress: AssessProgress = () => {},
): Promise<StoredAssessment> {
  const db = store();
  const [applications, roles, skills] = await Promise.all([db.applications(), db.roles(), db.skills()]);

  const application = applications.find((a) => a.id === applicationId);
  if (!application) throw new Error(`Unknown application ${applicationId}`);
  const role = roles.find((r) => r.id === application.roleId);
  if (!role) throw new Error(`Unknown role ${application.roleId}`);

  const [resume, docs] = await Promise.all([
    db.resume(application.candidateId),
    db.evidence(application.candidateId),
  ]);

  await progress(`Indexing ${docs.length} evidence documents`);
  await record("run_started", "system", `Assessment started for ${applicationId}`, {
    subjectId: application.candidateId,
    detail: { roleId: role.id, evidenceDocs: docs.length },
  });

  // Corroboration is a property of the candidate and their evidence, not of the
  // job. If this person has been assessed before against the same evidence pack,
  // reuse those verdicts and only re-score — one candidate applying to four
  // roles should cost one corroboration, not four.
  const reuse = await findReusableCorroboration(application.candidateId, docs.length);
  await progress(reuse ? "Reusing prior corroboration, re-scoring for this role" : "Extracting and corroborating claims");
  const result = await runAssessment({ application, role, resume, docs, skills, reuse });

  const stored: StoredAssessment = {
    applicationId,
    run: result.run,
    claims: result.claims,
    verdicts: result.verdicts,
    match: result.match,
    decision: result.decision,
    fabricated: result.fabricated,
    retrieval: result.retrieval,
    indexSize: result.indexSize,
    embedder: result.embedder,
    evidenceCount: docs.length,
  };

  await progress("Persisting results");
  await db.saveAssessment(stored);

  for (const f of result.fabricated) {
    await record("claim_rejected", "citation validator", `Unresolvable citation on ${f.claimId} — ${f.reason}`, {
      subjectId: application.candidateId,
      detail: { docId: f.docId, quote: f.quote },
    });
  }

  const adverse = result.verdicts.filter(
    (v) => v.status === "contradicted" || v.status === "unsupported",
  ).length;
  await record(
    "run_completed",
    "system",
    `${result.verdicts.length} verdicts · ${adverse} adverse · verified fit ${Math.round(result.match.verifiedScore * 100)}%`,
    {
      subjectId: application.candidateId,
      detail: {
        runId: result.run.id,
        provider: result.run.provider,
        model: result.run.model,
        modelCalls: result.run.totalModelCalls,
        embedder: result.embedder,
      },
    },
  );

  await record("decision_recorded", "policy engine", `${result.decision.outcome}: ${result.decision.rationale}`, {
    subjectId: application.candidateId,
    detail: { applicationId, adverseFactors: result.decision.adverseFactors },
  });

  if (result.decision.requiresHumanSignoff) {
    await record("signoff_required", "policy engine", `Adverse outcome held pending a named reviewer`, {
      subjectId: application.candidateId,
      detail: { applicationId, outcome: result.decision.outcome },
    });
  }

  return stored;
}

/**
 * Prior corroboration for this candidate, if any assessment already covered the
 * same evidence pack.
 *
 * The pack size is the staleness check: add a reference or a certificate and the
 * verdicts have to be recomputed, because new evidence can overturn one. It is a
 * coarse check — a document edited in place would slip through — and a real
 * system would hash the pack. Named here rather than left as a silent
 * assumption.
 */
async function findReusableCorroboration(
  candidateId: string,
  evidenceCount: number,
): Promise<ReusableCorroboration | undefined> {
  const db = store();
  const applications = await db.applications();
  const siblings = applications.filter((a) => a.candidateId === candidateId);

  for (const sibling of siblings) {
    const prior = await db.getAssessment(sibling.id);
    if (!prior || prior.claims.length === 0) continue;
    if (prior.indexSize === 0) continue;
    // Any human override makes the prior verdicts more trustworthy, not less,
    // so corrected verdicts propagate to the candidate's other applications.
    const stale = prior.evidenceCount !== undefined && prior.evidenceCount !== evidenceCount;
    if (stale) continue;
    return {
      claims: prior.claims,
      verdicts: prior.verdicts,
      fabricated: prior.fabricated,
      retrieval: prior.retrieval,
      indexSize: prior.indexSize,
      embedder: prior.embedder,
    };
  }
  return undefined;
}

/**
 * Pre-corroboration triage score for each claim. It answers "where should the
 * expensive verification effort go", not "is this person honest" — which is why
 * it is computed alongside the verdicts and never feeds into them.
 */
export async function claimRiskScores(
  stored: StoredAssessment,
): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = {};
  for (const claim of stored.claims) {
    const scores = (stored.retrieval[claim.id] ?? []).map((r) => r.score);
    out[claim.id] = await claimRisk(extractFeatures({ claim, retrievalScores: scores }));
  }
  return out;
}
