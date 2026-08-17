import { applyEdits } from "./patch.ts";
import { proposeWithLlm } from "./llm.ts";
import { repair } from "./repair.ts";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  if (!next || next.startsWith("--")) return undefined;
  return next;
}

function testCommand(): string | undefined {
  const i = process.argv.indexOf("--test");
  if (i === -1) return undefined;
  const parts: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    const a = process.argv[j];
    if (a.startsWith("--")) break;
    parts.push(a);
  }
  return parts.length ? parts.join(" ") : undefined;
}

const repo = arg("--repo");
const test = testCommand();
const goal = arg("--goal") ?? "make tests pass";
const write = process.argv.includes("--write");
const maxRaw = arg("--max-attempts");
const maxAttempts = maxRaw ? Number(maxRaw) : 3;

if (!repo || !test) {
  console.error(
    "usage: bun run repair -- --repo <path> --test <cmd> [--goal text] [--write]",
  );
  process.exit(2);
}

if (!process.env.DEEPSEEK_API_KEY) {
  console.error("set DEEPSEEK_API_KEY in .env");
  process.exit(2);
}

const result = await repair({
  repoPath: repo,
  testCommand: test,
  goal,
  maxAttempts,
  propose: proposeWithLlm,
});

console.log("status: " + result.status);
if (result.error) console.log("error: " + result.error);
for (const a of result.attempts) {
  const mark = a.testOk ? "pass" : a.applyOk ? "tests-failed" : "apply-failed";
  console.log("attempt " + a.n + " " + mark);
  if (a.rationale) console.log("  " + a.rationale);
  if (a.error) console.log("  " + a.error);
  for (const e of a.edits) {
    console.log("  " + e.path);
    console.log("  - " + e.old);
    console.log("  + " + e.new);
  }
}
if (result.lastOutput) {
  console.log("\nlast test output:\n" + result.lastOutput);
}

if (write) {
  if (result.status !== "passed") {
    console.error("not writing: status is " + result.status);
    process.exit(1);
  }
  const applied = await applyEdits(repo, result.winningEdits);
  if (!applied.ok) {
    console.error("write failed: " + applied.error);
    process.exit(1);
  }
  console.log("wrote edits to " + repo);
}

if (result.status === "error" || result.status === "failed") process.exit(1);
