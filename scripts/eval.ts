/**
 * Extraction eval.
 *
 * Three things get measured, because they fail independently:
 *   1. Detection  — did we find the skills a human found?
 *   2. Calibration — when we found one, did we get the level right?
 *   3. Grounding  — did we invent anything, and did the validator stop it?
 *
 * Grounding is the one that matters for trust. A profile that misses a skill is
 * incomplete; a profile that invents one is evidence the whole thing is guesswork.
 * Run: npm run eval
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Artifact, Skill, SkillLevel } from "../src/lib/types";
import { levelValue } from "../src/lib/types";
import { extractProfile } from "../src/lib/extract/pipeline";
import { selectProvider } from "../src/lib/llm";

interface Gold {
  personId: string;
  expected: Record<string, SkillLevel>;
  mustNotClaim: string[];
  note: string;
}

const ROOT = process.cwd();
const read = async <T,>(p: string): Promise<T> =>
  JSON.parse(await readFile(path.join(ROOT, p), "utf8")) as T;

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function row(label: string, value: string, note = ""): void {
  console.log(`  ${label.padEnd(30)} ${value.padEnd(12)} ${note}`);
}

async function main(): Promise<void> {
  const [artifacts, skills, gold] = await Promise.all([
    read<Artifact[]>("data/artifacts.json"),
    read<Skill[]>("data/skills.json"),
    read<Gold>("data/gold/extraction.json"),
  ]);

  const provider = selectProvider();
  const corpus = artifacts.filter((a) => a.personId === gold.personId);
  // Fixed clock: confidence decays with age, so a wall-clock date would make the
  // thin/not-thin boundary drift and the suite flake months from now.
  const now = new Date("2026-09-28T00:00:00Z");

  console.log(`\nExtraction eval — provider=${provider.name} model=${provider.model}`);
  console.log(`Corpus: ${corpus.length} artifacts · taxonomy: ${skills.length} skills\n`);

  const profile = await extractProfile(gold.personId, corpus, skills, { provider, now });

  const found = new Set(profile.claims.map((c) => c.skillId));
  const expected = new Set(Object.keys(gold.expected));

  const truePositives = [...found].filter((s) => expected.has(s));
  const falsePositives = [...found].filter((s) => !expected.has(s));
  const falseNegatives = [...expected].filter((s) => !found.has(s));

  const precision = found.size === 0 ? 0 : truePositives.length / found.size;
  const recall = expected.size === 0 ? 0 : truePositives.length / expected.size;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  let exact = 0;
  let within1 = 0;
  const levelMisses: string[] = [];
  for (const skillId of truePositives) {
    const claim = profile.claims.find((c) => c.skillId === skillId);
    const want = gold.expected[skillId];
    if (!claim || !want) continue;
    const delta = Math.abs(levelValue(claim.level) - levelValue(want));
    if (delta === 0) exact += 1;
    else levelMisses.push(`${skillId}: got ${claim.level}, expected ${want}`);
    if (delta <= 1) within1 += 1;
  }

  const forbidden = gold.mustNotClaim.filter((s) => found.has(s));
  const byReason = profile.rejected.reduce<Record<string, number>>((acc, r) => {
    acc[r.reason] = (acc[r.reason] ?? 0) + 1;
    return acc;
  }, {});
  const rawClaims = profile.rawClaimCount;

  console.log("Detection");
  row("precision", pct(precision), `${truePositives.length}/${found.size} claimed skills correct`);
  row("recall", pct(recall), `${truePositives.length}/${expected.size} gold skills found`);
  row("f1", pct(f1));
  if (falsePositives.length) row("false positives", String(falsePositives.length), falsePositives.join(", "));
  if (falseNegatives.length) row("missed", String(falseNegatives.length), falseNegatives.join(", "));

  console.log("\nCalibration");
  row("exact level match", pct(truePositives.length ? exact / truePositives.length : 0), `${exact}/${truePositives.length}`);
  row("within one level", pct(truePositives.length ? within1 / truePositives.length : 0), `${within1}/${truePositives.length}`);
  for (const miss of levelMisses) row("", "", miss);

  console.log("\nGrounding");
  row("raw claims from model", String(rawClaims), `merged into ${profile.claims.length} skills`);
  row("rejected by validator", String(profile.rejected.length), Object.entries(byReason).map(([k, v]) => `${k}=${v}`).join(" "));
  row("ungrounded survivors", String(forbidden.length), forbidden.length ? forbidden.join(", ") : "none");
  for (const r of profile.rejected) console.log(`      ✗ ${r.skillLabel} [${r.reason}] ${r.detail.slice(0, 96)}`);

  // Thresholds. Grounding is a hard gate; detection has headroom because the
  // taxonomy will keep growing and a slightly conservative extractor is fine.
  const failures: string[] = [];
  if (forbidden.length > 0) failures.push(`${forbidden.length} ungrounded claim(s) reached the profile`);
  if (recall < 0.85) failures.push(`recall ${pct(recall)} below 85%`);
  if (precision < 0.9) failures.push(`precision ${pct(precision)} below 90%`);
  if (truePositives.length && within1 / truePositives.length < 0.95) failures.push("level calibration below 95% within-one");

  console.log("");
  if (failures.length) {
    console.error(`FAIL\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  console.log("PASS — all gates met\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
