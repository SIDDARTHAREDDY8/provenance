import { readFile } from "node:fs/promises";
import path from "node:path";
import { SectionHead, Tag } from "@/components/ui";
import { record } from "@/lib/audit";
import { FOUR_FIFTHS, K_ANONYMITY_THRESHOLD, adverseImpact, type CohortRow } from "@/lib/compliance/adverse-impact";

export const dynamic = "force-dynamic";

function Redacted({ w }: { w: number }) {
  return (
    <span className="redacted" style={{ width: w, height: 11 }} aria-label="withheld">
      &nbsp;
    </span>
  );
}

export default async function CompliancePage() {
  const cohort = JSON.parse(
    await readFile(path.join(process.cwd(), "data", "cohort.json"), "utf8"),
  ) as CohortRow[];

  const rates = adverseImpact(cohort);
  const withheld = rates.filter((r) => r.suppressed).length;
  const flagged = rates.filter((r) => r.flagged);

  await record(
    "aggregate_served",
    "compliance dashboard",
    `Served ${rates.length - withheld} group rates, withheld ${withheld} below k=${K_ANONYMITY_THRESHOLD}`,
    { detail: { flagged: flagged.map((f) => f.group) } },
  );

  return (
    <>
      <header>
        <p className="eyebrow">Adverse-impact monitor</p>
        <h1 className="title mt-2.5 max-w-[20ch]">A screen nobody measures is a screen nobody can defend.</h1>
        <p className="standfirst mt-3">
          Selection rates by voluntarily disclosed group, against the four-fifths rule.{" "}
          <strong>A flagged ratio means look, not stop.</strong> Groups below{" "}
          {K_ANONYMITY_THRESHOLD} people are withheld — reporting them would identify individuals,
          and the reference rate is computed over reportable groups only so a suppressed rate cannot
          leak through the ratio.
        </p>
      </header>

      {flagged.length > 0 && (
        <div className="panel mt-6" data-tone="caution">
          <h3>
            {flagged.length} group{flagged.length === 1 ? "" : "s"} below the four-fifths threshold
          </h3>
          <p>
            {flagged.map((f) => f.group).join(", ")} {flagged.length === 1 ? "is" : "are"} selecting
            at under {Math.round(FOUR_FIFTHS * 100)}% of the strongest group&rsquo;s rate. That is
            the 1978 enforcement threshold for examining a screen — it is a smoke alarm, and the next
            step is a human looking at which requirement is driving it.
          </p>
        </div>
      )}

      <SectionHead
        title="Selection rates"
        count={`${cohort.length} decisions · ${withheld} group(s) withheld · k=${K_ANONYMITY_THRESHOLD}`}
      />

      <table className="tbl">
        <thead>
          <tr>
            <th>Group</th>
            <th className="num">Decisions</th>
            <th className="num">Selection rate</th>
            <th className="num">Impact ratio</th>
            <th>Four-fifths</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.group}>
              <td className={r.suppressed ? "text-ink-3 italic" : ""}>{r.group}</td>
              <td className="num text-ink-3">{r.n}</td>
              <td className="num">{r.rate === null ? <Redacted w={44} /> : `${Math.round(r.rate * 100)}%`}</td>
              <td className="num">
                {r.impactRatio === null ? <Redacted w={38} /> : r.impactRatio.toFixed(2)}
              </td>
              <td>
                {r.suppressed ? (
                  <span className="text-[12px] text-ink-3">withheld — group too small to report</span>
                ) : r.flagged ? (
                  <Tag tone="reject">Below threshold</Tag>
                ) : (
                  <Tag tone="good">Within threshold</Tag>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-7 grid gap-3 md:grid-cols-2">
        <div className="panel" data-tone="note">
          <h3>Why this is in the product and not a quarterly report</h3>
          <p>
            <strong>Mobley v. Workday</strong> is an argument about whether the vendor of a screening
            tool is answerable for its outcomes. Building the monitor into the runtime is cheaper
            than the discovery process that follows from not having it, and it is the only way a
            customer can answer the question in the quarter it is asked rather than the one after.
          </p>
        </div>
        <div className="panel">
          <h3>What this page does not have</h3>
          <p>
            Any route to an individual. Group membership is aggregate-only and never joined to a
            decision record, the suppression is enforced in{" "}
            <code className="font-mono text-[11px]">adverse-impact.ts</code> rather than in this
            markup, and the cohort here is seeded so the monitor has a population to measure.
          </p>
        </div>
      </div>
    </>
  );
}
