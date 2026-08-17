import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type Edit = {
  path: string;
  old: string;
  new: string;
};

export type ApplyResult = { ok: true } | { ok: false; error: string };

export function resolveSafePath(root: string, relative: string): string {
  if (!relative.trim()) throw new Error("path is empty");
  if (path.isAbsolute(relative)) {
    throw new Error("path must be relative: " + relative);
  }
  const cleaned = path.normalize(relative);
  if (cleaned === ".." || cleaned.startsWith(".." + path.sep)) {
    throw new Error("path escapes sandbox: " + relative);
  }
  const rootResolved = path.resolve(root);
  const resolved = path.resolve(rootResolved, cleaned);
  const prefix = rootResolved.endsWith(path.sep)
    ? rootResolved
    : rootResolved + path.sep;
  if (resolved !== rootResolved && !resolved.startsWith(prefix)) {
    throw new Error("path escapes sandbox: " + relative);
  }
  return resolved;
}

/** Apply edits under `root`. One failure restores files this call already changed. */
export async function applyEdits(
  root: string,
  edits: Edit[],
): Promise<ApplyResult> {
  if (edits.length === 0) return { ok: false, error: "no edits" };

  const originals = new Map<string, string>();
  try {
    for (const edit of edits) {
      const abs = resolveSafePath(root, edit.path);
      if (!(await Bun.file(abs).exists())) {
        throw new Error("file not found: " + edit.path);
      }
      const text = await readFile(abs, "utf8");
      if (text.includes("\0")) throw new Error("refusing binary file: " + edit.path);
      if (!originals.has(abs)) originals.set(abs, text);
      if (!edit.old) throw new Error("old text is empty: " + edit.path);
      const hits = text.split(edit.old).length - 1;
      if (hits === 0) throw new Error("old text not found in " + edit.path);
      if (hits > 1) {
        throw new Error("old text matches " + hits + " times in " + edit.path);
      }
      await writeFile(abs, text.replace(edit.old, edit.new), "utf8");
    }
    return { ok: true };
  } catch (err) {
    for (const [abs, text] of originals) {
      await writeFile(abs, text, "utf8");
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
