import { randomUUID } from "node:crypto";
import type Redis from "ioredis";
import { BACKOFF_MS, MAX_ATTEMPTS, type Job, type JobQueue } from "./types";

const READY = "prov:jobs:ready";
const INFLIGHT = "prov:jobs:inflight";
const RECORD = (id: string) => `prov:job:${id}`;

/**
 * Redis driver, used when REDIS_URL is set.
 *
 * Delivery is at-least-once via a reliable-queue pattern: the worker atomically
 * moves an id from the ready list to an in-flight list, and only removes it
 * after the handler returns. A worker that dies mid-job leaves the id in flight
 * where a sweeper can recover it, rather than losing an assessment silently —
 * which, for a decision about a person, is the failure mode that matters.
 */
export class RedisQueue implements JobQueue {
  readonly driver = "redis";
  private client: Redis | null = null;
  private worker: Redis | null = null;
  private handlers = new Map<string, (job: Job, progress: (t: string) => void) => Promise<void>>();
  private consuming = false;

  constructor(private readonly url: string) {}

  private async conn(): Promise<Redis> {
    if (this.client) return this.client;
    const { default: IORedis } = await import("ioredis");
    this.client = new IORedis(this.url, { maxRetriesPerRequest: 2 });
    return this.client;
  }

  async enqueue<T>(type: string, payload: T): Promise<Job<T>> {
    const job: Job<T> = {
      id: `job_${randomUUID().slice(0, 8)}`,
      type,
      payload,
      state: "queued",
      attempts: 0,
      enqueuedAt: new Date().toISOString(),
    };
    const redis = await this.conn();
    await redis.set(RECORD(job.id), JSON.stringify(job), "EX", 86_400);
    await redis.lpush(READY, job.id);
    return job;
  }

  async get(id: string): Promise<Job | null> {
    const redis = await this.conn();
    const raw = await redis.get(RECORD(id));
    return raw ? (JSON.parse(raw) as Job) : null;
  }

  consume<T>(type: string, handler: (job: Job<T>, progress: (t: string) => void) => Promise<void>): void {
    this.handlers.set(type, handler as (job: Job, progress: (t: string) => void) => Promise<void>);
    if (!this.consuming) {
      this.consuming = true;
      void this.loop();
    }
  }

  private async save(job: Job): Promise<void> {
    const redis = await this.conn();
    await redis.set(RECORD(job.id), JSON.stringify(job), "EX", 86_400);
  }

  private async loop(): Promise<void> {
    const { default: IORedis } = await import("ioredis");
    this.worker = new IORedis(this.url, { maxRetriesPerRequest: null });
    const redis = await this.conn();

    for (;;) {
      let id: string | null = null;
      try {
        id = await this.worker.brpoplpush(READY, INFLIGHT, 5);
      } catch {
        await new Promise((r) => setTimeout(r, 1_000));
        continue;
      }
      if (!id) continue;

      const raw = await redis.get(RECORD(id));
      if (!raw) {
        await redis.lrem(INFLIGHT, 1, id);
        continue;
      }

      const job = JSON.parse(raw) as Job;
      const handler = this.handlers.get(job.type);
      if (!handler) {
        await redis.lrem(INFLIGHT, 1, id);
        await redis.lpush(READY, id);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      job.attempts += 1;
      job.state = "running";
      job.startedAt = new Date().toISOString();
      await this.save(job);

      try {
        await handler(job, async (text: string) => {
          job.progress = text;
          await this.save(job);
        });
        job.state = "done";
        job.finishedAt = new Date().toISOString();
        await this.save(job);
        await redis.lrem(INFLIGHT, 1, id);
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        await redis.lrem(INFLIGHT, 1, id);
        if (job.attempts < MAX_ATTEMPTS) {
          job.state = "queued";
          await this.save(job);
          const delay = BACKOFF_MS[job.attempts] ?? 4_000;
          setTimeout(() => void redis.lpush(READY, id), delay);
        } else {
          job.state = "failed";
          job.finishedAt = new Date().toISOString();
          await this.save(job);
        }
      }
    }
  }
}
