import { SectionHead, Tag } from "@/components/ui";
import { DEMO_PERSON } from "@/lib/constants";
import { record } from "@/lib/audit";
import { K_ANONYMITY_THRESHOLD, aggregateSkills } from "@/lib/privacy/aggregate";
import { repo } from "@/lib/repo";
import type { SkillProfile } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Redaction is drawn, not described. There is nothing underneath the bar. */
function Redacted({ width }: { width: "sm" | "md" | "lg" }) {
  return (
    <span className="redacted" data-w={width} aria-label="withheld">
      &nbsp;
    </span>
  );
}

export default async function OrgPage() {
  const [people, skills, peers, own] = await Promise.all([
    repo.people(),
    repo.skills(),
    repo.peerProfiles(),
    repo.profile(DEMO_PERSON),
  ]);

  const profiles: Record<string, SkillProfile> = { ...peers };
  if (own) profiles[DEMO_PERSON] = own;

  const aggregates = aggregateSkills({ people, profiles, skills });
  const withheld = aggregates.filter((a) => a.suppressed);

  await record(
    "aggregate_served",
    "org dashboard",
    `Served ${aggregates.length - withheld.length} aggregates, withheld ${withheld.length} below k=${K_ANONYMITY_THRESHOLD}`,
    { detail: { withheld: withheld.map((h) => h.skillId) } },
  );

  return (
    <>
      <header>
        <p className="eyebrow">Employer view · Engineering</p>
        <h1 className="title">Counts, never people.</h1>
        <p className="standfirst">
          The employer pays and the employee supplies the data, so the boundary between them is a
          product constraint rather than a compliance checkbox.{" "}
          <strong>
            A bucket is reported only where at least {K_ANONYMITY_THRESHOLD} people are in it
          </strong>
          , and opted-out skills are excluded from the count rather than counted and hidden. Both
          rules live in the aggregation layer, not the UI — a rule enforced in the UI leaks through
          the API on the first integration.
        </p>
      </header>

      <SectionHead
        title="Skill register"
        count={`${Object.keys(profiles).length} profiles · ${withheld.length} of ${aggregates.length} withheld`}
      />

      <table className="table">
        <thead>
          <tr>
            <th>Skill</th>
            <th className="num">Strong</th>
            <th className="num">Developing</th>
            <th className="num">Thin</th>
            <th className="num">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {aggregates.map((agg) => {
            if (agg.suppressed) {
              return (
                <tr className="withheld" key={agg.skillId}>
                  <td>
                    {agg.label}
                    {agg.optedOut > 0 && (
                      <>
                        {" "}
                        <Tag tone="caution">{agg.optedOut} opted out</Tag>
                      </>
                    )}
                  </td>
                  <td className="num">
                    <Redacted width="sm" />
                  </td>
                  <td className="num">
                    <Redacted width="sm" />
                  </td>
                  <td className="num">
                    <Redacted width="sm" />
                  </td>
                  <td className="num">
                    <Redacted width="md" />
                  </td>
                </tr>
              );
            }
            const held =
              (agg.counts?.strong ?? 0) + (agg.counts?.developing ?? 0) + (agg.counts?.thin ?? 0);
            return (
              <tr key={agg.skillId}>
                <td>{agg.label}</td>
                <td className="num">{agg.counts?.strong}</td>
                <td className="num">{agg.counts?.developing}</td>
                <td className="num">{agg.counts?.thin}</td>
                <td className="num dim">
                  {held}/{agg.population}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="provenance mt-md">
        Withheld rows fall below the k={K_ANONYMITY_THRESHOLD} reporting threshold. No count is
        rendered client-side and none is sent over the wire.
      </p>

      <div className="panel mt-lg" data-tone="caution">
        <h3>This is the commercial argument, not the compliance one</h3>
        <p>
          Stream processing is withheld here — only a handful of people have it, which is exactly the
          number a VP would most like to see. Showing it would tell those engineers that the tool
          reports on them individually, and the next thing they do is stop writing anything legible.
        </p>
        <p>
          The data quality the employer is paying for depends on the employee trusting the boundary.
          Sell the boundary, and the corpus keeps getting richer. Quietly resolve it in the
          employer&rsquo;s favour, and the product slowly starves.
        </p>
      </div>
    </>
  );
}
