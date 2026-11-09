import type { ServerProviderSkill } from "@t3tools/contracts";

/** "/skill" typed as a command: at the start or after a space, followed by a space or the end. */
const SKILL_COMMAND = /(^|\s)\/skills?(?=\s|$)/i;
/** "skill", "skills", "habilidad", "habilidades" as whole words, in either language. */
const SKILL_WORD = /(^|[^\p{L}\p{N}])(skills?|habilidad(es)?)(?![\p{L}\p{N}])/iu;

/** Words that say "I want to send something" rather than which skill, so they never rank. */
const IGNORED_WORDS = new Set([
  "skill",
  "skills",
  "habilidad",
  "habilidades",
  "mandar",
  "mando",
  "mandarte",
  "mandarle",
  "manda",
  "enviar",
  "envio",
  "enviarte",
  "enviarle",
  "envia",
  "compartir",
  "comparto",
  "compartirte",
  "compartirle",
  "comparte",
  "send",
  "share",
  "sharing",
  "the",
  "you",
  "your",
  "that",
  "this",
  "for",
  "with",
  "una",
  "uno",
  "unas",
  "los",
  "las",
  "del",
  "para",
  "por",
  "con",
  "que",
  "esta",
  "este",
  "esa",
  "ese",
  "quiero",
  "puedo",
  "tengo",
  "tienes",
  "sobre",
]);

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

function words(text: string): ReadonlyArray<string> {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !IGNORED_WORDS.has(word));
}

/** Whether the message being typed is about sending a skill, so the composer can offer yours. */
export function mentionsSkill(text: string): boolean {
  return SKILL_COMMAND.test(text) || SKILL_WORD.test(normalize(text));
}

/** The note that goes with an attached skill: the typed text without the "/skill" command. */
export function noteWithoutSkillCommand(text: string): string {
  return text
    .replace(new RegExp(SKILL_COMMAND.source, "gi"), "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function skillScore(skill: ServerProviderSkill, queryWords: ReadonlyArray<string>): number {
  if (queryWords.length === 0) return 0;
  const name = normalize(`${skill.name} ${skill.displayName ?? ""}`);
  const description = normalize(`${skill.shortDescription ?? ""} ${skill.description ?? ""}`);
  let score = 0;
  for (const word of queryWords) {
    if (name.includes(word)) score += 3;
    else if (description.includes(word)) score += 1;
  }
  return score;
}

/**
 * Your skills in the order to offer them for a message: the ones whose name or description share
 * words with what you typed first, the rest after in their usual order.
 */
export function rankSkillsForMessage(
  skills: ReadonlyArray<ServerProviderSkill>,
  text: string,
): ReadonlyArray<ServerProviderSkill> {
  const queryWords = words(text);
  return skills
    .map((skill, index) => ({ skill, index, score: skillScore(skill, queryWords) }))
    .toSorted((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.skill);
}
