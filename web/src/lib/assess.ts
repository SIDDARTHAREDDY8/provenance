import { runAssessment } from "@/lib/agents/pipeline";
import { record } from "@/lib/audit";
import { store, type StoredAssessment } from "@/lib/store";
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

  await progress("Extracting and corroborating claims");
  const result = await runAssessment({ application, role, resume, docs, skills });

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
