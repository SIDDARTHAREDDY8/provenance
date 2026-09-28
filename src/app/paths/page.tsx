import Link from "next/link";
import { Level, SectionHead, Tag } from "@/components/ui";
import { DEMO_PERSON } from "@/lib/constants";
import { matchAll } from "@/lib/graph/match";
import { repo } from "@/lib/repo";
import type { Skill } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PathsPage() {
  const [profile, roles, skills] = await Promise.all([
    repo.profile(DEMO_PERSON),
    repo.roles(),
    repo.skills(),
  ]);

  if (!profile) {
    return (
      <>
        <header>
          <p className="eyebrow">Role fit</p>
          <h1 className="title">Nothing to score yet.</h1>
        </header>
        <div className="panel mt-lg" data-tone="caution">
          <h3>No profile on file</h3>
          <p>
            This page is derived from extracted evidence, not from job titles.{" "}
            <Link href="/">Run extraction</Link> first.
          </p>
        </div>
      </>
    );
  }

  const skillsById = new Map<string, Skill>(skills.map((s) => [s.id, s]));
  const rolesById = new Map(roles.map((r) => [r.id, r]));
  const matches = matchAll({ claims: profile.claims, roles });

  return (
    <>
      <header>
        <p className="eyebrow">Role fit</p>
        <h1 className="title">Four roles, scored against the evidence.</h1>
        <p className="standfirst">
          Partial credit for being one level short — that is genuinely closer than never having
          touched a skill, and a binary pass/fail hides exactly what this product exists to surface.{" "}
          <strong>Thin-evidence skills do not count toward a requirement.</strong> For a promotion
          decision, &ldquo;we think maybe&rdquo; should not read as &ldquo;meets the bar&rdquo;.
        </p>
      </header>

      <SectionHead title="Assessed roles" count={`${matches.length} evaluated`} />
      <div>
        {matches.map((match) => {
          const role = rolesById.get(match.roleId);
          if (!role) return null;
          const pct = Math.round(match.score * 100);
          return (
            <section className="role" key={match.roleId}>
              <div className="role-head">
                <div>
                  <h3 className="role-title">{role.title}</h3>
                  <p className="role-sub">
                    {role.track === "management" ? "Management track" : "IC track"} · Level{" "}
                    {role.level}
                  </p>
                </div>
                <div className="score">
                  <b>{pct}%</b>
                  <span>
                    {match.gaps.length === 0
                      ? "all requirements met"
                      : `${match.gaps.length} gap${match.gaps.length === 1 ? "" : "s"} · stretch ${match.stretch}`}
                  </span>
                </div>
              </div>

              <div className="bar">
                <i style={{ width: `${pct}%` }} />
              </div>

              <div className="split">
                <div>
                  <p className="rail-label">Evidenced</p>
                  <div className="chips">
                    {match.met.length === 0 && <span className="small dim">Nothing yet</span>}
                    {match.met.map((m) => (
                      <span className="chip" key={m.skillId}>
                        {skillsById.get(m.skillId)?.label ?? m.skillId}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="rail-label">Missing</p>
                  {match.gaps.length === 0 ? (
                    <span className="small dim">Nothing</span>
                  ) : (
                    <table className="table">
                      <tbody>
                        {match.gaps.map((gap) => (
                          <tr key={gap.skillId}>
                            <td>
                              {skillsById.get(gap.skillId)?.label ?? gap.skillId}
                              {gap.unevidenced ? (
                                <>
                                  {" "}
                                  <Tag tone="reject">No evidence</Tag>
                                </>
                              ) : (
                                profile.claims.find((c) => c.skillId === gap.skillId)?.thin && (
                                  <>
                                    {" "}
                                    <Tag tone="caution">Thin, discounted</Tag>
                                  </>
                                )
                              )}
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <Level level={gap.current} /> <span className="dim">→</span>{" "}
                              <Level level={gap.required} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {match.gaps.length > 0 && (
                <p className="mt-md" style={{ margin: "18px 0 0" }}>
                  <Link
                    className="btn"
                    data-variant="quiet"
                    href={{ pathname: "/mentor", query: { role: role.id } }}
                  >
                    How would she close these? →
                  </Link>
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="panel mt-lg" data-tone="note">
        <h3>Read the bottom of the list</h3>
        <p>
          The management role scores low because the corpus holds almost no leadership evidence — one
          mention of reviewing a colleague&rsquo;s pull requests, and nothing about hiring or
          performance. That is a real finding about a real gap, and it is the answer a product built
          on self-assessment can never give, because nobody rates themselves 31% at anything.
        </p>
      </div>
    </>
  );
}
