"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startAssessment } from "@/app/actions";

type Phase = "idle" | "queued" | "running" | "done" | "failed";

/**
 * Starts a queued assessment and polls it.
 *
 * The button does not wait for the work — it waits for a job id, then reports
 * what the worker is doing. That distinction is the whole reason the queue
 * exists, so the UI should make it visible rather than hide it behind a spinner.
 */
export function RunAssessment({
  applicationId,
  label = "Run assessment",
  variant = "primary",
}: {
  applicationId: string;
  label?: string;
  variant?: "primary" | "default";
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState<string>("");
  const [pending, startTransition] = useTransition();

  async function run() {
    setPhase("queued");
    setDetail("Waiting for a worker");
    const jobId = await startAssessment(applicationId);

    const deadline = Date.now() + 60_000;
    for (;;) {
      await new Promise((r) => setTimeout(r, 350));
      const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!res.ok) break;
      const job = (await res.json()) as {
        state: Phase | "queued" | "running" | "done" | "failed";
        progress: string | null;
        error: string | null;
        attempts: number;
      };

      if (job.progress) setDetail(job.progress);
      if (job.state === "running") setPhase("running");

      if (job.state === "done") {
        setPhase("done");
        setDetail("Complete");
        startTransition(() => router.refresh());
        return;
      }
      if (job.state === "failed") {
        setPhase("failed");
        setDetail(job.error ?? "Run failed");
        return;
      }
      if (Date.now() > deadline) {
        setPhase("failed");
        setDetail("Timed out waiting for the worker");
        return;
      }
    }
  }

  const busy = phase === "queued" || phase === "running" || pending;

  return (
    <span className="inline-flex items-center gap-2.5">
      <button
        type="button"
        className="btn"
        data-variant={variant === "primary" ? "primary" : undefined}
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? "Running…" : label}
      </button>
      {phase !== "idle" && (
        <span className="font-mono text-[11px] text-ink-3">
          {phase === "failed" ? <span className="text-crimson">{detail}</span> : detail}
        </span>
      )}
    </span>
  );
}
