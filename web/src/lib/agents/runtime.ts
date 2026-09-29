import { randomUUID } from "node:crypto";
import type { AgentRun, StepCheck, TraceStep } from "@/lib/types";
import type { LlmProvider } from "@/lib/llm";

/**
 * A small agent runtime.
 *
 * Steps are declared, not called: each one names itself, runs, and reports the
 * checks it ran on its own output. That is what makes the trace worth reading —
 * a log of function calls tells you what happened, a log of steps with their own
 * quality gates tells you whether to believe the result.
 *
 * Retries are here rather than in each agent because a transient model failure
 * is a runtime concern, and because a step that silently half-succeeded is the
 * hardest kind of bug to find in a multi-step pipeline.
 */

export interface StepContext {
  llm: LlmProvider;
  run: AgentRun;
}

export interface StepDef<Input, Output> {
  agent: string;
  label: string;
  retries?: number;
  execute: (input: Input, ctx: StepContext) => Promise<Output>;
  /** Gates run on the step's own output. A failed required check fails the step. */
  check?: (output: Output, input: Input) => StepCheck[];
  /** How the step's input and output appear in the trace. */
  describeInput?: (input: Input) => string;
  describeOutput?: (output: Output) => string;
}

export class RunFailed extends Error {
  constructor(
    message: string,
    readonly step: string,
  ) {
    super(message);
    this.name = "RunFailed";
  }
}

export class Runner {
  readonly run: AgentRun;

  constructor(
    applicationId: string,
    private readonly llm: LlmProvider,
  ) {
    this.run = {
      id: `run_${randomUUID().slice(0, 8)}`,
      applicationId,
      status: "running",
      startedAt: new Date().toISOString(),
      steps: [],
      provider: llm.name,
      model: llm.model,
      totalModelCalls: 0,
    };
  }

  async step<I, O>(def: StepDef<I, O>, input: I): Promise<O> {
    const trace: TraceStep = {
      id: `step_${this.run.steps.length + 1}`,
      agent: def.agent,
      label: def.label,
      status: "running",
      attempts: 0,
      startedAt: new Date().toISOString(),
      modelCalls: 0,
      checks: [],
      input: def.describeInput?.(input),
    };
    this.run.steps.push(trace);

    const maxAttempts = (def.retries ?? 1) + 1;
    const callsBefore = this.llm.calls;
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      trace.attempts = attempt;
      try {
        const output = await def.execute(input, { llm: this.llm, run: this.run });
        const checks = def.check?.(output, input) ?? [];
        trace.checks = checks;

        if (checks.some((c) => !c.passed)) {
          // A failed gate is a failed attempt: retry rather than emit output the
          // step itself has judged unsound.
          lastError = new Error(checks.filter((c) => !c.passed).map((c) => c.detail).join("; "));
          if (attempt < maxAttempts) continue;
          trace.status = "failed";
          trace.error = String(lastError);
          this.finishTrace(trace, started, callsBefore);
          throw new RunFailed(`${def.agent} failed its own checks`, def.agent);
        }

        trace.status = "ok";
        trace.output = def.describeOutput?.(output);
        this.finishTrace(trace, started, callsBefore);
        return output;
      } catch (err) {
        lastError = err;
        if (err instanceof RunFailed) throw err;
        if (attempt < maxAttempts) continue;
        trace.status = "failed";
        trace.error = err instanceof Error ? err.message : String(err);
        this.finishTrace(trace, started, callsBefore);
        throw new RunFailed(trace.error, def.agent);
      }
    }

    throw new RunFailed(String(lastError), def.agent);
  }

  private finishTrace(trace: TraceStep, started: number, callsBefore: number): void {
    trace.finishedAt = new Date().toISOString();
    trace.latencyMs = Date.now() - started;
    trace.modelCalls = this.llm.calls - callsBefore;
    this.run.totalModelCalls = this.llm.calls;
  }

  /**
   * Record a step that was deliberately not run.
   *
   * A skipped step belongs in the trace as loudly as an executed one: "this
   * cost nothing because the work already existed" is a claim a reader should
   * be able to check, not take on faith.
   */
  skip(agent: string, label: string, reason: string): void {
    this.run.steps.push({
      id: `step_${this.run.steps.length + 1}`,
      agent,
      label,
      status: "skipped",
      attempts: 0,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      latencyMs: 0,
      modelCalls: 0,
      checks: [{ name: "reused prior result", passed: true, detail: reason }],
      output: reason,
    });
  }

  complete(status: "complete" | "failed"): AgentRun {
    this.run.status = status;
    this.run.finishedAt = new Date().toISOString();
    return this.run;
  }
}
