import type { TeamThreadMessage } from "@t3tools/contracts";

const REQUEST_MAX_CHARS = 600;
const RESULT_MAX_CHARS = 1_500;

// A summary is for the outcome, not for watching the person: lines that only report effort go.
const EFFORT_LINE =
  /^\s*(?:[-*•]\s*)?(?:worked for|took\b|time spent|duration|elapsed|tokens?\b|tool calls?|questions? asked|trabaj[óo] (?:por|durante)|tard[óo]|tiempo (?:total|invertido|de trabajo)|duraci[óo]n|preguntas? (?:que )?hizo|llamadas? a herramientas)/i;

function clean(text: string, maxChars: number): string {
  const kept = text
    .split("\n")
    .filter((line) => !EFFORT_LINE.test(line))
    .join("\n")
    .trim();
  return kept.length > maxChars ? `${kept.slice(0, maxChars - 1).trimEnd()}…` : kept;
}

/**
 * What a "summary" share exposes: the first request and the latest answer, nothing in between.
 * Both carry the same timestamp so nobody can read off how long it took or how many turns it had.
 */
export function summarizeSharedThread(
  messages: ReadonlyArray<TeamThreadMessage>,
): ReadonlyArray<TeamThreadMessage> {
  const request = messages.find((message) => message.role === "user");
  const result = messages.findLast((message) => message.role === "assistant");
  const at = messages.at(-1)?.createdAt ?? "";
  const summary: TeamThreadMessage[] = [];
  if (request !== undefined)
    summary.push({ role: "user", text: clean(request.text, REQUEST_MAX_CHARS), createdAt: at });
  if (result !== undefined)
    summary.push({ role: "assistant", text: clean(result.text, RESULT_MAX_CHARS), createdAt: at });
  return summary;
}
