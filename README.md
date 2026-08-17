# Patch prove

Local tool that tries to fix a repo whose tests are failing.

It copies the repo, asks the model for small text edits, applies them to the copy, and runs **your** test command. You only see a patch if those tests pass. Your real files stay untouched unless you apply the patch yourself.

GitHub Actions still runs later, on a real commit. This only tries to get you to something that would pass.

**Stack:** Bun · TypeScript · Hono · DeepSeek V4 Flash

## Plan

Build in this order. Do not skip ahead to GitHub or a dashboard.

### 1. Fixture and test runner

A tiny broken repo in `fixtures/broken-math` (`add` subtracts; a test expects `2 + 3 = 5`).

A function that runs a command you pass in (for example `bun test`), with a timeout, and returns exit code plus output. The model never chooses this command.

### 2. Safe edits

Apply `{ path, old, new }` on a folder.

- Path stays inside that folder (no `..`, no absolute paths).
- `old` must match exactly once.
- No new files, no deletes, no binaries.
- If one edit fails, none of them stay.

### 3. Sandbox

Copy the repo to a temp folder (git worktree if it is a git repo). Reset it to the original files after a failed try. Delete it when the run ends. Symlink `node_modules` if the source has one.

### 4. The loop, with a fake model

```
copy → run tests
  already green → stop
  else → ask for edits → apply → run tests
           fail and tries left → reset, try again
           fail and no tries left → give up
           pass → remember the edits, stop
```

Default: 3 tries. Write tests that inject a fake model (no API key):

- Correct edit → passed; fixture on disk still broken.
- Bad edit, then a good one → passed on the second try.
- Always bad → failed after 3 tries.
- Tests already pass → no model call.
- Path `../secret` → rejected.

This step is done when those tests pass.

### 5. Real model

Same loop, DeepSeek instead of the fake. JSON search-and-replace only. Manual check on `broken-math`. Not a merge gate.

### 6. CLI

```bash
bun run repair -- --repo fixtures/broken-math --test "bun test" --goal "make tests pass"
```

Prints the result. A later flag can write the winning patch onto the real repo.

### 7. Local server (optional)

Hono on one port: start a run, poll for the result, apply if you want. Jobs in memory. A simple page is enough.

## Not in this version

No GitHub app, no opening PRs, no auto-merge, no database, no queue. Those can call the same loop later. They are not the first build.

## Status

CLI + loop work. `bun test tests` is the gate. No GitHub / HTTP yet.

```bash
bun test tests
bun run repair -- --repo fixtures/broken-math --test bun test --goal "make tests pass"
```
