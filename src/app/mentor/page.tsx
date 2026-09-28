import Link from "next/link";
import { takeAction } from "../actions";
import { Level, SectionHead, Tag } from "@/components/ui";
import { DEMO_PERSON } from "@/lib/constants";
import { matchRole } from "@/lib/graph/match";
import { planActions } from "@/lib/mentor/plan";
import { repo } from "@/lib/repo";
import type { MentorAction, Skill } from "@/lib/types";

export const dynamic = "force-dynamic";

const KIND: Record<MentorAction["kind"], string> = {
  request_work: "Do the work",
  request_mentor: "Learn from someone",
  close_evidence_gap: "Make it legible",
  flag_interest: "Signal intent",
};

export default async function MentorPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role: roleParam } = await searchParams;
  const [profile, roles, skills, openings, people, taken] = await Promise.all([
    repo.profile(DEMO_PERSON),
    repo.roles(),
    repo.skills(),
    repo.openings(),
    repo.people(),
    repo.takenActions(DEMO_PERSON),
  ]);

  if (!profile) {
    return (
      <>
        <header>
          <p className="eyebrow">Action queue</p>
          <h1 className="title">Nothing to recommend yet.</h1>
        </header>
        <div className="panel mt-lg" data-tone="caution">
          <h3>No profile on file</h3>
          <p>
            <Link href="/">Run extraction</Link> first — actions are generated from measured gaps.
          </p>
        </div>
      </>
    );
  }

  const skillsById = new Map<string, Skill>(skills.map((s) => [s.id, s]));
  const openingsById = new Map(openings.map((o) => [o.id, o]));
  const role = roles.find((r) => r.id === roleParam) ?? roles[1] ?? roles[0];
  if (!role) return <h1 className="title">No roles configured</h1>;

  const match = matchRole(role, profile.claims);
  const actions = planActions({ match, role, openings, people, claims: profile.claims });
  const takenIds = new Set(taken.map((a) => a.id));

  return (
    <>
      <header>
        <p className="eyebrow">Action queue</p>
        <h1 className="title">Not advice. Requests against real objects.</h1>
        <p className="standfirst">
          Every item is bound to something that exists in the company — an open ticket, a
          requisition, a named colleague with a pairing slot — and carries the measured gap that
          produced it. <strong>If nothing in the system would close a gap, nothing is offered for
          it.</strong> That restraint is the design.
        </p>
      </header>

      <div className="row mt-lg">
        <span className="rail-label" style={{ margin: 0 }}>
          Target
        </span>
        <div className="segmented">
          {roles.map((r) => (
            <Link
              key={r.id}
              href={{ pathname: "/mentor", query: { role: r.id } }}
              data-active={r.id === role.id}
            >
              {r.title}
            </Link>
          ))}
        </div>
      </div>

      <SectionHead
        title={role.title}
        count={`${Math.round(match.score * 100)}% fit · ${match.gaps.length} gaps · ${actions.length} actions`}
      />

      <div className="queue">
        {actions.length === 0 && (
          <div className="panel" data-tone="note">
            <h3>Nothing to offer</h3>
            <p>
              Either there are no gaps, or nothing currently open would close them. The honest answer
              is to say so rather than generate a learning plan nobody can act on.
            </p>
          </div>
        )}

        {actions.map((action, i) => {
          const opening =
            action.boundTo.type === "opening" ? openingsById.get(action.boundTo.id) : undefined;
          const done = takenIds.has(action.id);
          return (
            <article className="item" key={action.id} data-done={done}>
              <span className="rank">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <Tag tone={action.kind === "close_evidence_gap" ? "caution" : "info"}>
                  {KIND[action.kind]}
                </Tag>
                <p className="item-title">{action.label}</p>
                <div className="rationale">
                  <span>
                    Because <strong>
                      {skillsById.get(action.because.skillId)?.label ?? action.because.skillId}
                    </strong>{" "}
                    is
                  </span>
                  <Level level={action.because.fromLevel} />
                  <span>and this role needs</span>
                  <Level level={action.because.toLevel} />
                  {opening && (
                    <>
                      <code>{opening.id}</code>
                      <span className="dim">
                        {opening.team} · opens{" "}
                        {new Date(opening.availableFrom).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                        })}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                {done ? (
                  <Tag tone="good">Requested</Tag>
                ) : (
                  <form action={takeAction.bind(null, JSON.stringify(action))}>
                    <button className="btn" type="submit">
                      Request
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <div className="panel mt-lg" data-tone="note">
        <h3>What is deliberately missing</h3>
        <p>
          A chat box. A mentor that answers questions is easy to build and easy to abandon — the
          advice is unactionable, so it stops being opened after a fortnight. Every item above ends
          in a request against a real ticket, requisition or person, which is the only version of
          this that changes what happens to someone&rsquo;s career.
        </p>
      </div>
    </>
  );
}
