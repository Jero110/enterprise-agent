import type { ServerProviderSkill, TeamMessage } from "@t3tools/contracts";

/** One chat in the inbox: every message exchanged with one colleague. */
export interface TeamConversation {
  /** The other person's member key. */
  readonly key: string;
  readonly displayName: string;
  /** The newest message, for the preview line and the time. */
  readonly lastMessage: TeamMessage;
  /** Messages they sent that you have not opened yet. */
  readonly unreadCount: number;
}

function otherKey(message: TeamMessage): string {
  return message.outgoing ? message.toKey : message.fromKey;
}

function otherName(message: TeamMessage): string {
  return message.outgoing ? message.toDisplayName : message.fromDisplayName;
}

function createdMs(message: TeamMessage): number {
  const ms = Date.parse(message.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

/** Oldest first; same-instant messages keep a stable order by id. */
function compareOldestFirst(left: TeamMessage, right: TeamMessage): number {
  return createdMs(left) - createdMs(right) || left.id.localeCompare(right.id);
}

export function isUnreadIncoming(message: TeamMessage): boolean {
  return !message.outgoing && message.status === "unread";
}

/** A skill a colleague sent you that you have not installed or declined yet. */
export function isPendingSkill(message: TeamMessage): boolean {
  return (
    !message.outgoing &&
    message.kind === "skill" &&
    (message.status === "unread" || message.status === "read")
  );
}

/** What the mail badge counts: anything a colleague sent you that you have not opened. */
export function countUnreadIncoming(messages: ReadonlyArray<TeamMessage>): number {
  return messages.filter(isUnreadIncoming).length;
}

/** One row per colleague, newest conversation first. */
export function groupConversations(
  messages: ReadonlyArray<TeamMessage>,
): ReadonlyArray<TeamConversation> {
  const byKey = new Map<string, { last: TeamMessage; unread: number }>();
  for (const message of messages) {
    const key = otherKey(message);
    const entry = byKey.get(key);
    const unread = isUnreadIncoming(message) ? 1 : 0;
    if (entry === undefined) {
      byKey.set(key, { last: message, unread });
      continue;
    }
    entry.unread += unread;
    if (compareOldestFirst(entry.last, message) < 0) entry.last = message;
  }
  return [...byKey]
    .map(([key, entry]) => ({
      key,
      displayName: otherName(entry.last),
      lastMessage: entry.last,
      unreadCount: entry.unread,
    }))
    .toSorted((left, right) => compareOldestFirst(right.lastMessage, left.lastMessage));
}

/** The messages exchanged with one colleague, oldest first, the way a chat reads. */
export function conversationMessages(
  messages: ReadonlyArray<TeamMessage>,
  key: string,
): ReadonlyArray<TeamMessage> {
  return messages.filter((message) => otherKey(message) === key).toSorted(compareOldestFirst);
}

export type DayLabel =
  | { readonly kind: "today" }
  | { readonly kind: "yesterday" }
  | { readonly kind: "date"; readonly date: Date };

function startOfLocalDay(ms: number): number {
  const day = new Date(ms);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** "Today", "Yesterday" or the date, for the separators between days in a chat. */
export function dayLabel(iso: string, nowMs: number): DayLabel {
  const ms = Date.parse(iso);
  const date = new Date(Number.isFinite(ms) ? ms : 0);
  const day = startOfLocalDay(date.getTime());
  const today = startOfLocalDay(nowMs);
  if (day === today) return { kind: "today" };
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return { kind: "yesterday" };
  return { kind: "date", date };
}

/** A chat's messages split by local day, so each day gets one separator. */
export function groupByDay(
  messages: ReadonlyArray<TeamMessage>,
): ReadonlyArray<{ readonly dayKey: string; readonly messages: ReadonlyArray<TeamMessage> }> {
  const days: Array<{ dayKey: string; messages: TeamMessage[] }> = [];
  for (const message of messages) {
    const dayKey = String(startOfLocalDay(createdMs(message)));
    const current = days.at(-1);
    if (current !== undefined && current.dayKey === dayKey) current.messages.push(message);
    else days.push({ dayKey, messages: [message] });
  }
  return days;
}

/** Up to two initials for an avatar: "Ana López" -> "AL", "ana@x.com" -> "A". */
export function initials(name: string): string {
  const words = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter((word) => word.length > 0);
  const letters = words.length > 1 ? [words[0], words.at(-1)] : words.slice(0, 1);
  return letters.map((word) => (word ?? "").charAt(0).toLocaleUpperCase()).join("") || "?";
}

/** Skills a teammate could install: every SKILL.md any of this IDE's agents found, once each. */
export function shareableSkills(
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (!skill.enabled || !/SKILL\.md$/i.test(skill.path) || seen.has(skill.name)) return false;
    seen.add(skill.name);
    return true;
  });
}

/** Colleagues you can start a chat with, from the org chart: everyone but you, once each. */
export function rosterPeople(
  teams: ReadonlyArray<{
    readonly name: string;
    readonly members: ReadonlyArray<{
      readonly memberKey?: string;
      readonly displayName: string;
      readonly isMe: boolean;
    }>;
  }>,
): ReadonlyArray<{ readonly key: string; readonly displayName: string; readonly teams: string }> {
  const people = new Map<string, { displayName: string; teams: string[] }>();
  for (const team of teams)
    for (const member of team.members) {
      if (member.isMe || member.memberKey === undefined) continue;
      const entry = people.get(member.memberKey);
      if (entry === undefined)
        people.set(member.memberKey, { displayName: member.displayName, teams: [team.name] });
      else if (!entry.teams.includes(team.name)) entry.teams.push(team.name);
    }
  return [...people]
    .map(([key, entry]) => ({
      key,
      displayName: entry.displayName,
      teams: entry.teams.join(", "),
    }))
    .toSorted((left, right) => left.displayName.localeCompare(right.displayName));
}
