export type JobState = "queued" | "running" | "done" | "failed";

export interface Job<T = unknown> {
  id: string;
  type: string;
  payload: T;
  state: JobState;
  attempts: number;
  enqueuedAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  /** Free-form progress text the UI polls while the job runs. */
  progress?: string;
}

export interface JobQueue {
  readonly driver: string;
  enqueue<T>(type: string, payload: T): Promise<Job<T>>;
  get(id: string): Promise<Job | null>;
  /** Registers the handler for a job type and starts consuming. */
  consume<T>(type: string, handler: (job: Job<T>, progress: (text: string) => void) => Promise<void>): void;
}

/**
 * A failure that retrying cannot fix.
 *
 * Backoff is for the network being briefly unwell. Retrying a request that was
 * never valid burns the caller's money three times and puts three identical
 * failures in the log, which reads as a flaky system rather than a rejected
 * request.
 */
export class PermanentFailure extends Error {
  readonly permanent = true;
  constructor(message: string) {
    super(message);
    this.name = "PermanentFailure";
  }
}

export function isPermanent(err: unknown): boolean {
  return err instanceof PermanentFailure || (err as { permanent?: boolean })?.permanent === true;
}

/** Retries use exponential backoff; assessments are expensive to redo blindly. */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [0, 1_000, 4_000];
