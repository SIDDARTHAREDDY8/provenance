import { randomUUID } from "node:crypto";
import { BACKOFF_MS, MAX_ATTEMPTS, isPermanent, type Job, type JobQueue } from "./types";

/**
 * In-process queue. The default, so the app runs with no Redis.
 *
 * It implements the same contract as the Redis driver — at-least-once delivery,
 * bounded retries with backoff, terminal failure recorded rather than thrown
 * away — so handlers written against it behave identically in production. What
 * it cannot do is survive a restart or spread across instances, which is
 * exactly why the Redis driver exists.
 */
export class MemoryQueue implements JobQueue {
  readonly driver = "memory";
  private jobs = new Map<string, Job>();
  private handlers = new Map<string, (job: Job, progress: (t: string) => void) => Promise<void>>();
  private pending: string[] = [];
  private draining = false;

  async enqueue<T>(type: string, payload: T): Promise<Job<T>> {
    const job: Job<T> = {
      id: `job_${randomUUID().slice(0, 8)}`,
      type,
      payload,
      state: "queued",
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job as Job);
    this.pending.push(job.id);
    queueMicrotask(() => void this.drain());
    return job;
  }

  async get(id: string): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }

  consume<T>(type: string, handler: (job: Job<T>, progress: (t: string) => void) => Promise<void>): void {
    this.handlers.set(type, handler as (job: Job, progress: (t: string) => void) => Promise<void>);
    queueMicrotask(() => void this.drain());
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const id = this.pending.shift();
        const job = id ? this.jobs.get(id) : undefined;
        if (!job) continue;
        const handler = this.handlers.get(job.type);
        if (!handler) {
          this.pending.push(job.id);
          break;
        }
        await this.run(job, handler);
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(job: Job, handler: (job: Job, progress: (t: string) => void) => Promise<void>): Promise<void> {
    job.attempts += 1;
    job.state = "running";
    job.startedAt = new Date().toISOString();
    try {
      await handler(job, (text) => {
        job.progress = text;
      });
      job.state = "done";
      job.finishedAt = new Date().toISOString();
    } catch (err) {
      job.error = err instanceof Error ? err.message : String(err);
      if (job.attempts < MAX_ATTEMPTS && !isPermanent(err)) {
        job.state = "queued";
        const delay = BACKOFF_MS[job.attempts] ?? 4_000;
        setTimeout(() => {
          this.pending.push(job.id);
          void this.drain();
        }, delay);
      } else {
        job.state = "failed";
        job.finishedAt = new Date().toISOString();
      }
    }
  }
}
