"use server";

import { revalidatePath } from "next/cache";
import { record } from "@/lib/audit";
import { extractProfile } from "@/lib/extract/pipeline";
import { selectProvider } from "@/lib/llm";
import { repo } from "@/lib/repo";
import type { MentorAction } from "@/lib/types";
import { DEMO_PERSON } from "@/lib/constants";

export async function runExtraction(): Promise<void> {
  const [artifacts, skills] = await Promise.all([repo.artifactsFor(DEMO_PERSON), repo.skills()]);
  const provider = selectProvider();
  const profile = await extractProfile(DEMO_PERSON, artifacts, skills, { provider });
  await repo.saveProfile(profile);

  await record("extraction_run", "system", `Extracted ${profile.claims.length} skills from ${artifacts.length} artifacts`, {
    subjectPersonId: DEMO_PERSON,
    detail: {
      provider: profile.provider,
      model: profile.model,
      rawClaims: profile.rawClaimCount,
      accepted: profile.claims.length,
      rejected: profile.rejected.length,
    },
  });
  for (const r of profile.rejected) {
    await record("claim_rejected", "validator", `Rejected "${r.skillLabel}" — ${r.reason}`, {
      subjectPersonId: DEMO_PERSON,
      detail: { reason: r.reason, detail: r.detail },
    });
  }

  revalidatePath("/");
  revalidatePath("/paths");
  revalidatePath("/mentor");
  revalidatePath("/org");
  revalidatePath("/audit");
}

export async function takeAction(serialised: string): Promise<void> {
  const action = JSON.parse(serialised) as MentorAction;
  await repo.takeAction(DEMO_PERSON, action);
  await record("action_taken", "Maya Reyes", action.label, {
    subjectPersonId: DEMO_PERSON,
    detail: { kind: action.kind, boundTo: action.boundTo, because: action.because },
  });
  revalidatePath("/mentor");
  revalidatePath("/audit");
}
