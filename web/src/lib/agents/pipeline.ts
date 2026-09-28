import type {
  AgentRun,
  Application,
  Decision,
  EvidenceDoc,
  MatchResult,
  ResumeClaim,
  Role,
  Skill,
  Verdict,
} from "@/lib/types";
import { selectProvider, type LlmProvider } from "@/lib/llm";
import { selectEmbedderWithFallback } from "@/lib/rag/embed";
import { EvidenceIndex } from "@/lib/rag/retrieve";
import { Runner, RunFailed } from "./runtime";
import { extractClaims } from "./extract-claims";
import { corroborate, type CorroborateOutput } from "./corroborate";
import { scoreMatch } from "./score-match";
import { adjudicate } from "./adjudicate";

export interface AssessmentInput {
  application: Application;
  role: Role;
  resume: string;
  docs: EvidenceDoc[];
  skills: Skill[];
  llm?: LlmProvider;
}

export interface Assessment {
  run: AgentRun;
  claims: ResumeClaim[];
  verdicts: Verdict[];
  match: MatchResult;
  decision: Decision;
  fabricated: CorroborateOutput["fabricated"];
  retrieval: CorroborateOutput["retrieval"];
  indexSize: number;
  embedder: string;
}

/**
 * The orchestration: index → extract → corroborate → score → adjudicate.
 *
 * Sequential because each step genuinely depends on the last, and because a
 * partially-completed assessment of a person is worse than a slow one. The two
 * model-backed steps sit at the front; everything that decides an outcome is
 * deterministic code behind them.
 */
export async function runAssessment(input: AssessmentInput): Promise<Assessment> {
  const llm = input.llm ?? selectProvider();
  const runner = new Runner(input.application.id, llm);

  try {
    const embedder = await selectEmbedderWithFallback();
    const index = await EvidenceIndex.build(input.docs, embedder);

    const claims = await runner.step(extractClaims, {
      candidateId: input.application.candidateId,
      resume: input.resume,
      skills: input.skills,
    });

    const corroboration = await runner.step(corroborate, {
      claims,
      docs: input.docs,
      index,
    });

    const match = await runner.step(scoreMatch, {
      candidateId: input.application.candidateId,
      role: input.role,
      claims,
      verdicts: corroboration.verdicts,
    });

    const decision = await runner.step(adjudicate, {
      applicationId: input.application.id,
      role: input.role,
      match,
      verdicts: corroboration.verdicts,
      claims,
      skills: input.skills,
    });

    return {
      run: runner.complete("complete"),
      claims,
      verdicts: corroboration.verdicts,
      match,
      decision,
      fabricated: corroboration.fabricated,
      retrieval: corroboration.retrieval,
      indexSize: index.size,
      embedder: index.providerName,
    };
  } catch (err) {
    runner.complete("failed");
    if (err instanceof RunFailed) throw err;
    throw err;
  }
}
