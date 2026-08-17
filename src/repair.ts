import path from "node:path";
import { applyEdits, type Edit } from "./patch.ts";
import {
  createSandbox,
  destroySandbox,
  resetSandbox,
} from "./sandbox.ts";
import { runTests } from "./testRunner.ts";

export type ProposeFn = (input: {
  goal: string;
  testOutput: string;
  files: Array<{ path: string; content: string }>;
  attempt: number;
}) => Promise<{ rationale: string; edits: Edit[] }>;

export type RepairResult = {
  status: "already_green" | "passed" | "failed" | "error";
  goal: string;
  repoPath: string;
  testCommand: string;
  maxAttempts: number;
  attempts: Array<{
    n: number;
    rationale: string;
    edits: Edit[];
    applyOk: boolean;
    testOk: boolean;
    output: string;
    error?: string;
  }>;
  winningEdits: Edit[];
  lastOutput: string;
  error?: string;
};

const SKIP = new Set(["node_modules", "dist"]);

async function listFiles(
  root: string,
): Promise<Array<{ path: string; content: string }>> {
  const out: Array<{ path: string; content: string }> = [];
  for await (const rel of new Bun.Glob("**/*.{js,ts,json}").scan({
    cwd: root,
    onlyFiles: true,
  })) {
    if (rel.split(path.sep).some((p) => SKIP.has(p))) continue;
    const text = await Bun.file(path.join(root, rel)).text();
    if (text.includes("\0")) continue;
    out.push({ path: rel, content: text.slice(0, 4000) });
    if (out.length >= 20) break;
  }
  return out;
}

export async function repair(options: {
  repoPath: string;
  testCommand: string;
  goal: string;
  maxAttempts?: number;
  propose: ProposeFn;
  timeoutMs?: number;
}): Promise<RepairResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  const base = {
    goal: options.goal,
    repoPath: path.resolve(options.repoPath),
    testCommand: options.testCommand,
    maxAttempts,
    attempts: [] as RepairResult["attempts"],
    winningEdits: [] as Edit[],
    lastOutput: "",
  };

  let sandbox;
  try {
    sandbox = await createSandbox(options.repoPath);
  } catch (err) {
    return {
      ...base,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    const first = await runTests({
      cwd: sandbox.path,
      command: options.testCommand,
      timeoutMs: options.timeoutMs,
    });
    base.lastOutput = first.output;
    if (first.ok) {
      return { ...base, status: "already_green" };
    }

    for (let n = 1; n <= maxAttempts; n++) {
      let rationale = "";
      let edits: Edit[] = [];
      try {
        const proposed = await options.propose({
          goal: options.goal,
          testOutput: base.lastOutput,
          files: await listFiles(sandbox.path),
          attempt: n,
        });
        rationale = proposed.rationale;
        edits = proposed.edits;
      } catch (err) {
        base.attempts.push({
          n,
          rationale,
          edits,
          applyOk: false,
          testOk: false,
          output: base.lastOutput,
          error: err instanceof Error ? err.message : String(err),
        });
        await resetSandbox(sandbox);
        continue;
      }

      const applied = await applyEdits(sandbox.path, edits);
      if (!applied.ok) {
        base.attempts.push({
          n,
          rationale,
          edits,
          applyOk: false,
          testOk: false,
          output: base.lastOutput,
          error: applied.error,
        });
        await resetSandbox(sandbox);
        continue;
      }

      const result = await runTests({
        cwd: sandbox.path,
        command: options.testCommand,
        timeoutMs: options.timeoutMs,
      });
      base.lastOutput = result.output;
      base.attempts.push({
        n,
        rationale,
        edits,
        applyOk: true,
        testOk: result.ok,
        output: result.output,
      });
      if (result.ok) {
        return { ...base, status: "passed", winningEdits: edits };
      }
      await resetSandbox(sandbox);
    }

    return { ...base, status: "failed" };
  } finally {
    await destroySandbox(sandbox);
  }
}
