import { NextResponse } from "next/server";
import { queue } from "@/lib/queue";

export const dynamic = "force-dynamic";

/** Polled by the client while an assessment runs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await queue().get(id);
  if (!job) return NextResponse.json({ error: "unknown job" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    state: job.state,
    attempts: job.attempts,
    progress: job.progress ?? null,
    error: job.error ?? null,
  });
}
