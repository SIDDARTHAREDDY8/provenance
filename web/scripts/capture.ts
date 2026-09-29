/**
 * Capture real model output into data/fixtures/.
 *
 *   ANTHROPIC_API_KEY=sk-... npm run capture     # forced tool use, preferred
 *   LLM_PROVIDER=claude-code  npm run capture    # uses the Claude Code CLI login
 *
 * Writes each response verbatim, then runs the pipeline again from the captured
 * fixtures to prove the replay path reaches the same conclusions. Fixtures that
 * do not reproduce are not fixtures, they are decoration.
 */
import { AnthropicProvider } from "../src/lib/llm/anthropic";
import { ClaudeCodeProvider, RecordingProvider } from "../src/lib/llm";
import { FixtureProvider } from "../src/lib/llm/fixture";
import { runAssessment } from "../src/lib/agents/pipeline";
import { store } from "../src/lib/store";
import type { LlmProvider } from "../src/lib/llm";

const APPLICATION = process.argv[2] ?? "app_001";

function live(): LlmProvider {
  const key = process.env.ANTHROPIC_API_KEY;
  if (key && key.trim().length > 0) return new AnthropicProvider(key);
  if (process.env.LLM_PROVIDER === "claude-code") return new ClaudeCodeProvider();
  throw new Error(
    "No live provider. Set ANTHROPIC_API_KEY, or LLM_PROVIDER=claude-code after running `claude` and /login.",
  );
}

async function main(): Promise<void> {
  const db = store();
  const [applications, roles, skills] = await Promise.all([db.applications(), db.roles(), db.skills()]);
  const application = applications.find((a) => a.id === APPLICATION);
  if (!application) throw new Error(`Unknown application ${APPLICATION}`);
  const role = roles.find((r) => r.id === application.roleId);
  if (!role) throw new Error(`Unknown role ${application.roleId}`);

  const [resume, docs] = await Promise.all([
    db.resume(application.candidateId),
    db.evidence(application.candidateId),
  ]);

  const inner = live();
  console.log(`\nCapturing ${APPLICATION} with ${inner.name} (${inner.model})`);
  console.log(`${docs.length} evidence documents · this makes one model call per claim\n`);

  const started = Date.now();
  const captured = await runAssessment({
    application,
    role,
    resume,
    docs,
    skills,
    llm: new RecordingProvider(inner),
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`Captured ${captured.run.totalModelCalls} responses in ${seconds}s`);
  console.log(`  verdicts      ${summarise(captured)}`);
  console.log(`  citations     ${captured.verdicts.flatMap((v) => v.citations).length} kept, ${captured.fabricated.length} rejected`);
  console.log(`  claimed fit   ${Math.round(captured.match.claimedScore * 100)}%`);
  console.log(`  verified fit  ${Math.round(captured.match.verifiedScore * 100)}%`);
  console.log(`  decision      ${captured.decision.outcome}`);

  console.log(`\nReplaying from the captured fixtures…`);
  const replayed = await runAssessment({
    application,
    role,
    resume,
    docs,
    skills,
    llm: new FixtureProvider(),
  });

  const drift = replayed.verdicts.filter((v) => {
    const original = captured.verdicts.find((c) => c.claimId === v.claimId);
    return original?.status !== v.status;
  });

  if (drift.length > 0) {
    console.error(`\nFAIL — ${drift.length} verdict(s) differ on replay: ${drift.map((d) => d.claimId).join(", ")}\n`);
    process.exit(1);
  }
  console.log(`Replay matches on all ${replayed.verdicts.length} verdicts.\n`);
  console.log(`Fixtures written to data/fixtures/. Run \`npm run eval\` to score them.\n`);
}

function summarise(a: { verdicts: { status: string }[] }): string {
  const counts = a.verdicts.reduce<Record<string, number>>((acc, v) => {
    acc[v.status] = (acc[v.status] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([k, v]) => `${v} ${k.replace("_", " ")}`)
    .join(" · ");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
