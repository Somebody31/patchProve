# Patch prove

Copies a repo, asks DeepSeek for small text edits, applies them on the copy, and keeps a patch only if **your** test command passes. The original files stay as they are unless you pass `--write`.

```bash
cp .env.example .env   # set DEEPSEEK_API_KEY
bun test tests
bun run repair -- --repo fixtures/broken-math --test bun test --goal "make tests pass"
```

`--write` applies the winning edits to `--repo` after a pass.

No GitHub, no HTTP server. The loop is `src/repair.ts`.
