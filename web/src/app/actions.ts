"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { assessApplication } from "@/lib/assess";
import { record } from "@/lib/audit";
import { queue } from "@/lib/queue";
import { store } from "@/lib/store";
import { meterRun } from "@/lib/billing";
import type { VerdictStatus } from "@/lib/types";

let consuming = false;

/**
 * Registers the worker once per process. Assessments run off a queue rather than
 * inside the request: a run makes one model call per claim, and holding an HTTP
 * connection open for that is how you discover your platform's 60-second
 * function timeout in front of a customer.
 */
function ensureWorker(): void {
  if (consuming) return;
  consuming = true;
  queue().consume<{ applicationId: string }>("assess", async (job, progress) => {
    await assessApplication(job.payload.applicationId, progress);
    await meterRun(job.payload.applicationId);
  });
}

export async function startAssessment(applicationId: string): Promise<string> {
  // Reject before queueing. A request that can never succeed should come back as
  // an answer, not as a job the caller has to poll in order to learn it failed.
  const db = store();
  const application = (await db.applications()).find((a) => a.id === applicationId);
  if (!application) throw new Error(`Unknown application ${applicationId}`);
  if ((await db.evidence(application.candidateId)).length === 0) {
    throw new Error("This candidate has no evidence pack on file, so there is nothing to assess.");
  }

  ensureWorker();
  const job = await queue().enqueue("assess", { applicationId });
  await record("run_started", "reviewer", `Queued assessment for ${applicationId}`, {
    detail: { jobId: job.id, queue: queue().driver },
  });
  revalidatePath("/");
  return job.id;
}

export async function overrideVerdict(formData: FormData): Promise<void> {
  const applicationId = String(formData.get("applicationId"));
  const claimId = String(formData.get("claimId"));
  const next = String(formData.get("status")) as VerdictStatus;
  const rationale = String(formData.get("rationale") ?? "").trim();
  const reviewer = "Reviewer (demo)";

  const db = store();
  const assessment = await db.getAssessment(applicationId);
  if (!assessment) return;
  const verdict = assessment.verdicts.find((v) => v.claimId === claimId);
  if (!verdict || verdict.status === next) return;

  const before = verdict.status;
  verdict.status = next;
  verdict.overriddenBy = reviewer;
  verdict.rationale = rationale || `Overridden by ${reviewer}.`;
  await db.saveAssessment(assessment);

  await db.saveOverride({
    id: `ovr_${randomUUID().slice(0, 8)}`,
    at: new Date().toISOString(),
    reviewer,
    applicationId,
    targetType: "verdict",
    targetId: claimId,
    before,
    after: next,
    rationale: rationale || "(no rationale given)",
    // Every correction becomes a labelled example. A disagreement the system
    // never measures again is a disagreement it will repeat next quarter.
    promotedToEval: true,
  });

  await record("override_recorded", reviewer, `${claimId}: ${before} → ${next}`, {
    detail: { applicationId, rationale },
  });

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/corrections");
  revalidatePath("/audit");
}

export async function signOff(formData: FormData): Promise<void> {
  const applicationId = String(formData.get("applicationId"));
  const reviewer = String(formData.get("reviewer") ?? "").trim() || "Reviewer (demo)";
  await store().signOff(applicationId, reviewer);
  await record("decision_recorded", reviewer, `Adverse outcome accepted by a named human`, {
    detail: { applicationId },
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/audit");
}
