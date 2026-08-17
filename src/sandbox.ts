import { existsSync } from "node:fs";
import { cp, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type Sandbox = {
  path: string;
  sourcePath: string;
  mode: "worktree" | "copy";
};

function skip(from: string): boolean {
  return from.split(path.sep).some(
    (p) => p === "node_modules" || p === ".git" || p === "dist",
  );
}

async function git(args: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error("git " + args.join(" ") + " failed: " + err.trim());
  }
}

async function linkNodeModules(source: string, dest: string): Promise<void> {
  const from = path.join(source, "node_modules");
  const to = path.join(dest, "node_modules");
  if (!existsSync(from) || existsSync(to)) return;
  await symlink(from, to, "dir").catch(() => {});
}

export async function createSandbox(repoPath: string): Promise<Sandbox> {
  const sourcePath = path.resolve(repoPath);
  const tmp = path.join(tmpdir(), "patch-prove-" + crypto.randomUUID());

  if (existsSync(path.join(sourcePath, ".git"))) {
    await git(["worktree", "add", "--detach", tmp], sourcePath);
    await linkNodeModules(sourcePath, tmp);
    return { path: tmp, sourcePath, mode: "worktree" };
  }

  await cp(sourcePath, tmp, { recursive: true, filter: (from) => !skip(from) });
  await linkNodeModules(sourcePath, tmp);
  return { path: tmp, sourcePath, mode: "copy" };
}

export async function resetSandbox(sandbox: Sandbox): Promise<void> {
  if (sandbox.mode === "worktree") {
    await git(["checkout", "--", "."], sandbox.path);
    await git(["clean", "-fd"], sandbox.path);
    return;
  }
  for (const name of await readdir(sandbox.path)) {
    if (name === "node_modules") continue;
    await rm(path.join(sandbox.path, name), { recursive: true, force: true });
  }
  await cp(sandbox.sourcePath, sandbox.path, {
    recursive: true,
    filter: (from) => !skip(from),
  });
}

export async function destroySandbox(sandbox: Sandbox): Promise<void> {
  if (sandbox.mode === "worktree") {
    try {
      await git(
        ["worktree", "remove", "--force", sandbox.path],
        sandbox.sourcePath,
      );
      return;
    } catch {
      // fall through
    }
  }
  await rm(sandbox.path, { recursive: true, force: true });
}
