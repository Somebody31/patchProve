import type { Edit } from "./patch.ts";

/** First {...} in messy model text. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function parseEdits(text: string): {
  rationale: string;
  edits: Edit[];
} {
  const obj = parseJsonObject(text);
  if (!obj) throw new Error("model did not return JSON");
  const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
  if (!Array.isArray(obj.edits)) throw new Error("model JSON missing edits[]");
  const edits: Edit[] = [];
  for (const item of obj.edits) {
    if (!item || typeof item !== "object") throw new Error("bad edit");
    const rec = item as Record<string, unknown>;
    if (
      typeof rec.path !== "string" ||
      typeof rec.old !== "string" ||
      typeof rec.new !== "string"
    ) {
      throw new Error("edit needs path, old, new");
    }
    edits.push({ path: rec.path, old: rec.old, new: rec.new });
  }
  return { rationale, edits };
}
