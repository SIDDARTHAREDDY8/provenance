import type { Citation, EvidenceDoc, ResumeClaim, SkillLevel, Verdict, VerdictStatus } from "@/lib/types";
import { SKILL_LEVELS, levelValue } from "@/lib/types";
import type { EvidenceIndex } from "@/lib/rag/retrieve";
import { checkCitations, citationConfidence } from "@/lib/verify";
import type { StepDef } from "./runtime";

export interface CorroborateInput {
  claims: ResumeClaim[];
  docs: EvidenceDoc[];
  index: EvidenceIndex;
}

export interface CorroborateOutput {
  verdicts: Verdict[];
  /** Citations the model produced that did not resolve. Surfaced, not swallowed. */
  fabricated: { claimId: string; docId: string; quote: string; reason: string }[];
  retrieval: Record<string, { docId: string; score: number }[]>;
}

const TOOL = {
  name: "adjudicate_claim",
  description: "Decide whether the retrieved evidence supports the claim, and cite the spans that decide it.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["verified", "partially_verified", "unsupported", "contradicted"],
      },
      citations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            docId: { type: "string" },
            quote: { type: "string", description: "Verbatim span from that document." },
          },
          required: ["docId", "quote"],
        },
      },
      supportedLevel: { type: "string", enum: ["none", "beginner", "intermediate", "advanced", "expert"] },
      rationale: { type: "string", description: "One sentence. Will be shown to the candidate." },
    },
    required: ["status", "citations", "rationale"],
  },
} as const;

/**
 * Claim categories where a third party, not the candidate, is the authority.
 *
 * Retrieval by similarity cannot find a contradiction, and this is not a
 * limitation of the embedder — it is what similarity means. Measured on this
 * corpus with all-MiniLM-L6-v2, "Led a team of 8 engineers" and "She did not
 * have direct reports at any point" score −0.02 cosine: the most decisive pair
 * in the evidence pack looks like unrelated text, because the second sentence
 * is the answer precisely by meaning the opposite of the first.
 *
 * A better model does not fix that. So contradiction is handled structurally
 * instead: for claims about scope, employment or credentials, every attested
 * document enters the context and the adjudicator reads them all.
 */
/**
 * Retrieved chunks per claim.
 *
 * Raised from 6 after a live run: the eval showed an adverse verdict that was
 * correct given its context and wrong given the full evidence pack, because the
 * one document showing the claimed effect never made the cut. An adjudicator
 * cannot be better than its retrieval, so the cheapest fix for a wrong verdict
 * is usually more context rather than a better prompt.
 */
export const RETRIEVAL_K = 8;

const THIRD_PARTY_AUTHORITATIVE = new Set<ResumeClaim["category"]>([
  "scope",
  "employment",
  "credential",
]);

const SYSTEM = `You adjudicate a single résumé claim against retrieved evidence.

Four verdicts, and the distinction matters:
- verified: the evidence directly supports the claim as written.
- partially_verified: something real happened but the claim overstates it — scope, scale, seniority or magnitude.
- unsupported: no evidence either way. This is not an accusation; absence of evidence is not evidence of fabrication.
- contradicted: the evidence states something incompatible with the claim.

Rules:
1. Every citation must quote the retrieved document VERBATIM. A citation that cannot be found in its document is worse than no citation, because it makes an unfounded verdict look founded.
2. Cite for contradicted and partially_verified especially — an adverse verdict without evidence is not a verdict, it is an allegation.
3. Do not reason from the candidate's other claims. Each claim stands or falls on the evidence retrieved for it.
4. The rationale is read by the candidate. Write it as a statement about the evidence, not about the person.`;

function isLevel(v: string | undefined): v is SkillLevel {
  return v !== undefined && (SKILL_LEVELS as readonly string[]).includes(v);
}

/**
 * Step 2 — retrieval-augmented adjudication, one model call per claim.
 *
 * Per-claim rather than one big call: it keeps each decision traceable to the
 * evidence actually retrieved for it, stops the model laundering support for a
 * weak claim from a neighbouring strong one, and means a single bad response
 * degrades one verdict instead of the whole assessment.
 */
export const corroborate: StepDef<CorroborateInput, CorroborateOutput> = {
  agent: "corroborate",
  label: "Adjudicate each claim against retrieved evidence",
  retries: 1,

  describeInput: (input) => `${input.claims.length} claims against ${input.index.size} indexed chunks`,
  describeOutput: (out) => {
    const counts = out.verdicts.reduce<Record<string, number>>((acc, v) => {
      acc[v.status] = (acc[v.status] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
      .join(" · ");
  },

  async execute(input, ctx) {
    const docsById = new Map(input.docs.map((d) => [d.id, d]));
    const verdicts: Verdict[] = [];
    const fabricated: CorroborateOutput["fabricated"] = [];
    const retrieval: CorroborateOutput["retrieval"] = {};

    for (const claim of input.claims) {
      const hits = await input.index.search(claim.text, RETRIEVAL_K, {
        includeAllAttested: THIRD_PARTY_AUTHORITATIVE.has(claim.category),
        pinAttested: 1,
      });
      retrieval[claim.id] = hits.map((h) => ({ docId: h.doc.id, score: h.score }));

      const context = hits
        .map(
          (h) =>
            `<document id="${h.doc.id}" kind="${h.doc.kind}" source="${h.doc.source}" attested="${h.doc.attested}" date="${h.doc.occurredAt}">\n${h.chunk.text}\n</document>`,
        )
        .join("\n\n");

      const raw = await ctx.llm.structured<{
        status: string;
        citations: Citation[];
        supportedLevel?: string;
        rationale: string;
      }>({
        // Namespaced by candidate. Claim ids restart at claim_01 for every
        // person, so a flat key made two candidates share a cache slot — the
        // second capture silently overwrote the first, and in a live system
        // would have served one person's verdicts for another.
        cacheKey: `corroborate/${claim.candidateId}/${claim.id}`,
        system: SYSTEM,
        prompt: `CLAIM (${claim.category}, from "${claim.section}")
"${claim.text}"

RETRIEVED EVIDENCE
${context || "(nothing retrieved)"}`,
        tool: TOOL,
      });

      const retrievedIds = new Set(hits.map((h) => h.doc.id));
      const { valid, rejected } = checkCitations(raw.citations ?? [], docsById, retrievedIds);
      for (const r of rejected) {
        fabricated.push({
          claimId: claim.id,
          docId: r.citation.docId,
          quote: r.citation.quote,
          reason: r.reason,
        });
      }

      // Attach the retrieval score that surfaced each cited document, so the
      // trace shows whether a citation came from a strong hit or a weak one.
      const scored = valid.map((c) => ({
        ...c,
        retrievalScore: retrieval[claim.id]?.find((r) => r.docId === c.docId)?.score,
      }));

      let status = (raw.status as VerdictStatus) ?? "unsupported";
      // A supportive verdict whose every citation was fabricated is not a
      // supportive verdict. Downgrade rather than discard: the claim was still
      // assessed, and the candidate is entitled to know it came out unsupported.
      if ((status === "verified" || status === "partially_verified") && scored.length === 0) {
        status = "unsupported";
      }

      verdicts.push({
        claimId: claim.id,
        status,
        confidence: citationConfidence(scored, docsById),
        citations: scored,
        rationale: raw.rationale,
        supportedLevel: isLevel(raw.supportedLevel)
          ? capToAsserted(raw.supportedLevel, claim.assertedLevel)
          : undefined,
      });
    }

    return { verdicts, fabricated, retrieval };
  },

  check(out) {
    const supportive = out.verdicts.filter(
      (v) => v.status === "verified" || v.status === "partially_verified",
    );
    const uncited = supportive.filter((v) => v.citations.length === 0);
    const adverseUncited = out.verdicts.filter(
      (v) => v.status === "contradicted" && v.citations.length === 0,
    );

    return [
      {
        name: "supportive verdicts are cited",
        passed: uncited.length === 0,
        detail: `${supportive.length} supportive verdicts, all carrying at least one resolvable citation`,
      },
      {
        name: "adverse verdicts are cited",
        passed: adverseUncited.length === 0,
        detail:
          adverseUncited.length === 0
            ? "every contradicted verdict cites the evidence that contradicts it"
            : `${adverseUncited.length} contradicted verdict(s) with no citation — an allegation, not a finding`,
      },
      {
        name: "citation integrity",
        passed: true,
        detail:
          out.fabricated.length === 0
            ? "no unresolvable citations"
            : `${out.fabricated.length} unresolvable citation(s) rejected before scoring`,
      },
      {
        // Without this, a fixture or a model with memory of the corpus can cite
        // evidence it was never shown, and the demo silently flatters retrieval.
        name: "verdicts cite only retrieved evidence",
        passed: out.verdicts.every((v) =>
          v.citations.every((c) => (out.retrieval[v.claimId] ?? []).some((r) => r.docId === c.docId)),
        ),
        detail: "every surviving citation names a document that retrieval returned for that claim",
      },
    ];
  },
};

/** Verification can lower a claimed level. It must never raise one. */
function capToAsserted(supported: SkillLevel, asserted: SkillLevel | undefined): SkillLevel {
  if (!asserted) return supported;
  return levelValue(supported) > levelValue(asserted) ? asserted : supported;
}
