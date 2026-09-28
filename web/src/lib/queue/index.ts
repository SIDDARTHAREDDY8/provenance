import { MemoryQueue } from "./memory-queue";
import { RedisQueue } from "./redis-queue";
import type { JobQueue } from "./types";

export type { Job, JobQueue, JobState } from "./types";

/**
 * Pinned to globalThis rather than a module-level binding.
 *
 * Next bundles route handlers, server actions and pages separately, so a plain
 * module singleton can exist several times in one process — which shows up as a
 * job enqueued by a server action being invisible to the route that polls it.
 * With Redis the shared backend hides this; in-process it does not, which is
 * exactly the kind of bug that only appears in the cheap configuration.
 */
const KEY = Symbol.for("provenance.queue");
type Global = typeof globalThis & { [KEY]?: JobQueue };

export function queue(): JobQueue {
  const g = globalThis as Global;
  if (g[KEY]) return g[KEY];
  const url = process.env.REDIS_URL;
  g[KEY] = url && url.trim().length > 0 ? new RedisQueue(url) : new MemoryQueue();
  return g[KEY];
}
