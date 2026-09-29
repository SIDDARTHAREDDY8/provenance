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
  /**
   * Corroboration already computed for this candidate against this same
   * evidence pack. Claims and verdicts are properties of the person and their
   * evidence, not of the job they applied to, so a second application reuses
   * them and only re-scores. That is the difference between paying per
   * candidate and paying per application.
   */
  reuse?: ReusableCorroboration;
}

export interface ReusableCorroboration {
  claims: ResumeClaim[];
  verdicts: Verdict[];
  fabricated: CorroborateOutput["fabricated"];
  retrieval: CorroborateOutput["retrieval"];
  indexSize: number;
  embedder: string;
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
    let claims: ResumeClaim[];
    let corroboration: CorroborateOutput;
    let indexSize: number;
    let embedder: string;

    if (input.reuse) {
      runner.skip("extract", "Split the résumé into discrete claims",
        `reused ${input.reuse.claims.length} claims already extracted for this candidate`);
      runner.skip("corroborate", "Adjudicate each claim against retrieved evidence",
        `reused ${input.reuse.verdicts.length} verdicts — same candidate, same evidence pack, 0 model calls`);
      claims = input.reuse.claims;
      corroboration = {
        verdicts: input.reuse.verdicts,
        fabricated: input.reuse.fabricated,
        retrieval: input.reuse.retrieval,
      };
      indexSize = input.reuse.indexSize;
      embedder = input.reuse.embedder;
    } else {
      const embedderImpl = await selectEmbedderWithFallback();
      const index = await EvidenceIndex.build(input.docs, embedderImpl);
      indexSize = index.size;
      embedder = index.providerName;

      claims = await runner.step(extractClaims, {
        candidateId: input.application.candidateId,
        resume: input.resume,
        skills: input.skills,
      });

      corroboration = await runner.step(corroborate, { claims, docs: input.docs, index });
    }

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
      indexSize,
      embedder,
    };
  } catch (err) {
    runner.complete("failed");
    if (err instanceof RunFailed) throw err;
    throw err;
  }
}
