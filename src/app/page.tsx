import { runExtraction } from "./actions";
import { Citations, Level, SectionHead, Tag } from "@/components/ui";
import { DEMO_PERSON } from "@/lib/constants";
import { exhibitNumbers } from "@/lib/exhibits";
import { repo } from "@/lib/repo";
import type { Skill } from "@/lib/types";

export const dynamic = "force-dynamic";

const REJECTION: Record<string, string> = {
  unknown_skill: "Off taxonomy",
  quote_not_found: "Fabricated quote",
  no_evidence: "No evidence",
  unknown_artifact: "Phantom citation",
};

export default async function EvidencePage() {
  const [profile, artifacts, skills, person] = await Promise.all([
    repo.profile(DEMO_PERSON),
    repo.artifactsFor(DEMO_PERSON),
    repo.skills(),
    repo.person(DEMO_PERSON),
  ]);

  const artifactsById = new Map(artifacts.map((a) => [a.id, a]));
  const skillsById = new Map<string, Skill>(skills.map((s) => [s.id, s]));
  const exhibits = exhibitNumbers(artifacts);

  return (
    <>
      <header>
        <p className="eyebrow">Skill profile · {person?.name}</p>
        <h1 className="title">Derived from the work, not the form.</h1>
        <p className="standfirst">
          {person?.name?.split(" ")[0]} has never filled in a skills questionnaire. This profile is
          built from {artifacts.length} artifacts she produced doing her job, and{" "}
          <strong>every claim below cites the sentence that proved it</strong>. Anything the pipeline
          could not trace to a real span in a real artifact was thrown away.
        </p>
      </header>

      {!profile ? (
        <div className="panel mt-lg" data-tone="note">
          <h3>No profile on file</h3>
          <p>
            Extraction reads the corpus in batches of six, checks every quoted span against its cited
            source, derives a confidence from the weight and independence of the evidence, and caps
            each level at what that evidence can actually carry.
          </p>
          <form action={runExtraction} className="mt-md">
            <button className="btn" data-variant="primary" type="submit">
              Run extraction on {artifacts.length} artifacts
            </button>
          </form>
        </div>
      ) : (
        <>
          {profile.rejected.length > 0 && (
            <div className="panel mt-lg" data-tone="reject">
              <h3>{profile.rejected.length} claims did not survive validation</h3>
              <p>
                Listed rather than silently dropped. The rejection rate is how you judge what the
                surviving claims are worth.
              </p>
              <table className="table mt-md">
                <tbody>
                  {profile.rejected.map((r, i) => (
                    <tr key={i}>
                      <td style={{ width: 140 }}>
                        <Tag tone="reject">{REJECTION[r.reason] ?? r.reason}</Tag>
                      </td>
                      <td style={{ width: 170 }}>
                        {skillsById.get(r.skillLabel)?.label ?? r.skillLabel}
                      </td>
                      <td className="small dim">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <SectionHead
            title="Claims"
            count={`${profile.rawClaimCount} raw → ${profile.claims.length} merged`}
          />
          <div>
            {profile.claims.map((claim) => {
              const skill = skillsById.get(claim.skillId);
              return (
                <article className="record" key={claim.skillId}>
                  <div className="record-head">
                    <span className="record-name">{skill?.label ?? claim.skillId}</span>
                    <Tag>{skill?.dimension}</Tag>
                    {claim.thin && <Tag tone="caution">Thin evidence</Tag>}
                    <span className="record-aside">
                      <span className="conf">conf {claim.confidence.toFixed(2)}</span>
                      <Level level={claim.level} thin={claim.thin} />
                    </span>
                  </div>
                  <Citations
                    evidence={claim.evidence}
                    artifactsById={artifactsById}
                    exhibits={exhibits}
                  />
                </article>
              );
            })}
          </div>

          <div className="panel mt-lg" data-tone="note">
            <h3>Absence is a finding</h3>
            <p>
              Stream processing and infrastructure-as-code are not on this list. The corpus contains
              an RFC in which {person?.name?.split(" ")[0]} discusses Kafka at length and states
              plainly that she has no production streaming experience — a tool scoring keyword
              proximity would have credited her for it. That single false positive is the difference
              between a career recommendation and a career derailment.
            </p>
          </div>

          <form action={runExtraction} className="mt-lg">
            <button className="btn" data-variant="quiet" type="submit">
              Re-run extraction →
            </button>
          </form>
        </>
      )}
    </>
  );
}
