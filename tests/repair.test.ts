import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Edit } from "../src/patch.ts";
import { parseEdits } from "../src/propose.ts";
import { repair, type ProposeFn } from "../src/repair.ts";

const fixture = path.join(import.meta.dir, "../fixtures/broken-math");
const addFile = path.join(fixture, "src/add.js");

const good: Edit = {
  path: "src/add.js",
  old: "return a - b;",
  new: "return a + b;",
};

function fake(editsSeq: Edit[][]): ProposeFn {
  let i = 0;
  return async () => {
    const edits = editsSeq[Math.min(i, editsSeq.length - 1)] ?? [];
    i += 1;
    return { rationale: "fake", edits };
  };
}

async function sourceStillBroken(): Promise<void> {
  const text = await readFile(addFile, "utf8");
  expect(text).toContain("return a - b;");
}

test("correct edit passes and leaves the fixture broken", async () => {
  const result = await repair({
    repoPath: fixture,
    testCommand: "bun test",
    goal: "make tests pass",
    propose: fake([[good]]),
  });
  expect(result.status).toBe("passed");
  expect(result.attempts.length).toBe(1);
  await sourceStillBroken();
});

test("bad then good edit passes on the second try", async () => {
  const bad: Edit = {
    path: "src/add.js",
    old: "return a - b;",
    new: "return a * b;",
  };
  const result = await repair({
    repoPath: fixture,
    testCommand: "bun test",
    goal: "make tests pass",
    propose: fake([[bad], [good]]),
  });
  expect(result.status).toBe("passed");
  expect(result.attempts.length).toBe(2);
  await sourceStillBroken();
});

test("always-bad edits fail after 3 tries", async () => {
  const bad: Edit = {
    path: "src/add.js",
    old: "nope",
    new: "x",
  };
  const result = await repair({
    repoPath: fixture,
    testCommand: "bun test",
    goal: "make tests pass",
    maxAttempts: 3,
    propose: fake([[bad]]),
  });
  expect(result.status).toBe("failed");
  expect(result.attempts.length).toBe(3);
  await sourceStillBroken();
});

test("already-green runs propose zero times", async () => {
  let calls = 0;
  const propose: ProposeFn = async () => {
    calls += 1;
    return { rationale: "", edits: [] };
  };
  const result = await repair({
    repoPath: fixture,
    testCommand: "true",
    goal: "make tests pass",
    propose,
  });
  expect(result.status).toBe("already_green");
  expect(calls).toBe(0);
  await sourceStillBroken();
});

test("propose gets the file named in the failing test", async () => {
  let paths: string[] = [];
  const propose: ProposeFn = async (input) => {
    paths = input.files.map((f) => f.path);
    return { rationale: "fake", edits: [good] };
  };
  await repair({
    repoPath: fixture,
    testCommand: "bun test",
    goal: "make tests pass",
    propose,
  });
  expect(paths.some((p) => p.endsWith("add.js"))).toBe(true);
});

test("parseEdits reads JSON wrapped in prose", () => {
  const got = parseEdits(
    'sure\n{"rationale":"fix add","edits":[{"path":"src/add.js","old":"a - b","new":"a + b"}]}\n',
  );
  expect(got.edits[0]?.path).toBe("src/add.js");
});

test("path escape is rejected and source is untouched", async () => {
  const result = await repair({
    repoPath: fixture,
    testCommand: "bun test",
    goal: "make tests pass",
    maxAttempts: 1,
    propose: fake([
      [{ path: "../secret", old: "a", new: "b" }],
    ]),
  });
  expect(result.status).toBe("failed");
  expect(result.attempts[0]?.applyOk).toBe(false);
  expect(result.attempts[0]?.error).toContain("escapes");
  await sourceStillBroken();
});
