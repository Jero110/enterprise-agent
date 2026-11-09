import type { ServerProviderSkill, TeamMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  conversationMessages,
  countUnreadIncoming,
  dayLabel,
  groupByDay,
  groupConversations,
  initials,
  isPendingRequest,
  isPendingSkill,
  rosterPeople,
  shareableSkills,
} from "./teamChats.logic";

const ME = "me-key";
// Tuesday 15:00 local time.
const NOW = new Date(2026, 10, 10, 15, 0, 0).getTime();
const MINUTE = 60_000;

let nextId = 0;
function message(
  other: { readonly key: string; readonly name: string },
  options: {
    readonly outgoing?: boolean;
    readonly at?: number;
    readonly status?: TeamMessage["status"];
    readonly skill?: string;
    readonly task?: string;
    readonly note?: string | null;
  } = {},
): TeamMessage {
  nextId += 1;
  const outgoing = options.outgoing ?? false;
  return {
    id: `m${String(nextId).padStart(3, "0")}`,
    kind: options.skill !== undefined ? "skill" : options.task !== undefined ? "task" : "message",
    outgoing,
    fromKey: outgoing ? ME : other.key,
    fromDisplayName: outgoing ? "Me" : other.name,
    toKey: outgoing ? other.key : ME,
    toDisplayName: outgoing ? other.name : "Me",
    note: options.note === undefined ? "hola" : options.note,
    skill:
      options.skill === undefined
        ? null
        : { name: options.skill, description: "does things", content: "# Skill" },
    task:
      options.task === undefined
        ? null
        : { title: options.task, description: "", priority: null, dueDate: null },
    viaAgent: false,
    status: options.status ?? "read",
    createdAt: new Date(options.at ?? NOW).toISOString(),
  } as TeamMessage;
}

const ana = { key: "ana-key", name: "Ana López" };
const beto = { key: "beto-key", name: "Beto" };

describe("groupConversations", () => {
  it("makes one chat per colleague, newest first, whichever side wrote last", () => {
    const messages = [
      message(ana, { at: NOW - 30 * MINUTE }),
      message(beto, { at: NOW - 10 * MINUTE, outgoing: true, note: "¿listo?" }),
      message(ana, { at: NOW - 60 * MINUTE, outgoing: true }),
      message(beto, { at: NOW - 20 * MINUTE }),
    ];
    const conversations = groupConversations(messages);
    expect(conversations.map((chat) => chat.key)).toEqual(["beto-key", "ana-key"]);
    expect(conversations[0]?.displayName).toBe("Beto");
    expect(conversations[0]?.lastMessage.note).toBe("¿listo?");
    expect(conversations[1]?.displayName).toBe("Ana López");
  });

  it("counts only the unread messages they sent you", () => {
    const conversations = groupConversations([
      message(ana, { status: "unread", at: NOW - 3 * MINUTE }),
      message(ana, { status: "unread", at: NOW - 2 * MINUTE, skill: "pdf-tools" }),
      message(ana, { status: "read", at: NOW - 4 * MINUTE }),
      // An outgoing message the colleague has not read does not count for you.
      message(ana, { status: "unread", outgoing: true, at: NOW - MINUTE }),
    ]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.unreadCount).toBe(2);
  });

  it("is empty without messages", () => {
    expect(groupConversations([])).toEqual([]);
  });
});

describe("conversationMessages", () => {
  it("returns one colleague's messages oldest first", () => {
    const first = message(ana, { at: NOW - 20 * MINUTE });
    const second = message(ana, { at: NOW - 10 * MINUTE, outgoing: true });
    const other = message(beto, { at: NOW - 15 * MINUTE });
    // The server lists newest first.
    expect(conversationMessages([second, other, first], "ana-key")).toEqual([first, second]);
  });
});

describe("unread and pending", () => {
  it("counts unread incoming messages of any kind", () => {
    expect(
      countUnreadIncoming([
        message(ana, { status: "unread" }),
        message(beto, { status: "unread", skill: "deploy" }),
        message(beto, { status: "read" }),
        message(ana, { status: "unread", outgoing: true }),
      ]),
    ).toBe(2);
  });

  it("treats a received skill as pending until it is installed or declined", () => {
    expect(isPendingSkill(message(ana, { skill: "x", status: "unread" }))).toBe(true);
    expect(isPendingSkill(message(ana, { skill: "x", status: "read" }))).toBe(true);
    expect(isPendingSkill(message(ana, { skill: "x", status: "installed" }))).toBe(false);
    expect(isPendingSkill(message(ana, { skill: "x", outgoing: true }))).toBe(false);
    expect(isPendingSkill(message(ana))).toBe(false);
    expect(isPendingSkill(message(ana, { task: "Promo", status: "unread" }))).toBe(false);
  });

  it("treats any received skill or card as a pending request until answered", () => {
    expect(isPendingRequest(message(ana, { task: "Promo", status: "unread" }))).toBe(true);
    expect(isPendingRequest(message(ana, { task: "Promo", status: "read" }))).toBe(true);
    expect(isPendingRequest(message(ana, { task: "Promo", status: "accepted" }))).toBe(false);
    expect(isPendingRequest(message(ana, { task: "Promo", status: "declined" }))).toBe(false);
    expect(isPendingRequest(message(ana, { skill: "x", status: "read" }))).toBe(true);
    expect(isPendingRequest(message(ana, { task: "Promo", outgoing: true }))).toBe(false);
    expect(isPendingRequest(message(ana))).toBe(false);
  });

  it("groups card messages into the sender's chat", () => {
    const conversations = groupConversations([
      message(ana, { at: NOW - 5 * MINUTE }),
      message(ana, { task: "Promo de octubre", status: "unread", at: NOW - MINUTE }),
    ]);
    expect(conversations).toHaveLength(1);
    expect(conversations[0]?.lastMessage.task?.title).toBe("Promo de octubre");
    expect(conversations[0]?.unreadCount).toBe(1);
  });
});

describe("days", () => {
  it("labels today, yesterday and older dates", () => {
    expect(dayLabel(new Date(NOW - 60 * MINUTE).toISOString(), NOW)).toEqual({ kind: "today" });
    const yesterday = new Date(2026, 10, 9, 23, 30).toISOString();
    expect(dayLabel(yesterday, NOW)).toEqual({ kind: "yesterday" });
    const older = dayLabel(new Date(2026, 10, 1, 9, 0).toISOString(), NOW);
    expect(older.kind).toBe("date");
  });

  it("groups consecutive messages by local day", () => {
    const days = groupByDay([
      message(ana, { at: new Date(2026, 10, 9, 10, 0).getTime() }),
      message(ana, { at: new Date(2026, 10, 9, 18, 0).getTime() }),
      message(ana, { at: new Date(2026, 10, 10, 9, 0).getTime() }),
    ]);
    expect(days.map((day) => day.messages.length)).toEqual([2, 1]);
  });
});

describe("initials", () => {
  it("takes the first and last word", () => {
    expect(initials("Ana López")).toBe("AL");
    expect(initials("María José de la Cruz")).toBe("MC");
    expect(initials("beto")).toBe("B");
    expect(initials("ana.lopez@empresa.com")).toBe("AL");
    expect(initials("  ")).toBe("?");
  });
});

describe("shareableSkills", () => {
  it("keeps enabled SKILL.md skills once each", () => {
    const skills = [
      { name: "pdf", path: "/a/pdf/SKILL.md", enabled: true },
      { name: "pdf", path: "/b/pdf/SKILL.md", enabled: true },
      { name: "off", path: "/a/off/SKILL.md", enabled: false },
      { name: "cmd", path: "/a/commands/cmd.md", enabled: true },
    ] as ReadonlyArray<ServerProviderSkill>;
    expect(shareableSkills(skills).map((entry) => entry.path)).toEqual(["/a/pdf/SKILL.md"]);
  });
});

describe("rosterPeople", () => {
  it("lists everyone but you once, with all their teams", () => {
    const people = rosterPeople([
      {
        name: "Ventas",
        members: [
          { memberKey: "beto-key", displayName: "Beto", isMe: false },
          { memberKey: ME, displayName: "Me", isMe: true },
        ],
      },
      {
        name: "Marketing",
        members: [
          { memberKey: "beto-key", displayName: "Beto", isMe: false },
          { memberKey: "ana-key", displayName: "Ana López", isMe: false },
          { displayName: "Sin llave", isMe: false },
        ],
      },
    ]);
    expect(people).toEqual([
      { key: "ana-key", displayName: "Ana López", teams: "Marketing" },
      { key: "beto-key", displayName: "Beto", teams: "Ventas, Marketing" },
    ]);
  });
});
