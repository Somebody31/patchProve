import { parseEdits } from "./propose.ts";
import type { ProposeFn } from "./repair.ts";

export async function completeChat(options: {
  system: string;
  user: string;
}): Promise<string> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is missing (set it in .env)");

  const baseUrl =
    process.env.DEEPSEEK_BASE_URL?.replace(/\/$/, "") ||
    "https://api.deepseek.com";
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: options.system.trim() },
        { role: "user", content: options.user },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    throw new Error(
      "DeepSeek API error " + res.status + ": " + (await res.text()).slice(0, 500),
    );
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("DeepSeek API returned empty content");
  }
  return text;
}

export const proposeWithLlm: ProposeFn = async (input) => {
  const fileBlock = input.files
    .map((f) => "### " + f.path + "\n" + f.content)
    .join("\n\n");
  const raw = await completeChat({
    system: `You fix a failing repo with the smallest search-and-replace edits.
Return ONLY JSON:
{"rationale":"one sentence","edits":[{"path":"relative/file","old":"exact text","new":"replacement"}]}
Rules: existing files only, old must match once, do not change tests unless the goal says to, do not invent a test command.`,
    user:
      "Goal: " +
      input.goal +
      "\nAttempt: " +
      input.attempt +
      "\n\nTest output:\n" +
      input.testOutput +
      "\n\nFiles:\n" +
      fileBlock,
  });
  return parseEdits(raw);
};
