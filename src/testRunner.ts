export type TestRun = {
  ok: boolean;
  code: number | null;
  output: string;
};

export function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

/** Run the caller-supplied command in `cwd`. No shell. */
export async function runTests(options: {
  cwd: string;
  command: string;
  timeoutMs?: number;
}): Promise<TestRun> {
  const argv = splitCommand(options.command);
  if (argv.length === 0) {
    return { ok: false, code: null, output: "test command is empty" };
  }

  const timeoutMs = options.timeoutMs ?? 30_000;
  const proc = Bun.spawn(argv, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    let output = (stdout + stderr).trimEnd();
    if (timedOut) output += (output ? "\n" : "") + `timed out after ${timeoutMs}ms`;
    return { ok: code === 0 && !timedOut, code, output };
  } finally {
    clearTimeout(timer);
  }
}
