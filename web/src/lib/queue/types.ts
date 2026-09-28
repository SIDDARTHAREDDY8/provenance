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

/** Retries use exponential backoff; assessments are expensive to redo blindly. */
export const MAX_ATTEMPTS = 3;
export const BACKOFF_MS = [0, 1_000, 4_000];
