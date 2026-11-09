import { EnvironmentId, RunId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { splitMinutes, summarizeHomeDay, TIME_SAVED_ESTIMATE } from "./TodayPanel.logic";

const environmentId = EnvironmentId.make("environment-1");
// Tuesday 15:00 local time; "today" starts at local midnight.
const NOW = new Date(2026, 10, 10, 15, 0, 0).getTime();
const MINUTE = 60_000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function thread(
  id: string,
  options: {
    readonly status?: "completed" | "running" | "failed" | "waiting";
    readonly startedAt?: number | null;
    readonly completedAt?: number | null;
    readonly noRun?: boolean;
    readonly approval?: boolean;
    readonly question?: boolean;
    readonly subagentRequest?: "approval" | "user_input";
    readonly archived?: boolean;
    readonly deleted?: boolean;
    readonly subagent?: boolean;
    readonly sideChat?: boolean;
  } = {},
) {
  const threadId = ThreadId.make(id);
  const status = options.status ?? "completed";
  const startedAt = options.startedAt === undefined ? NOW - 60 * MINUTE : options.startedAt;
  const completedAt =
    options.completedAt === undefined
      ? status === "completed" || status === "failed"
        ? (startedAt ?? NOW) + 5 * MINUTE
        : null
      : options.completedAt;
  return {
    environmentId,
    id: threadId,
    title: `Chat ${id}`,
    lineage: {
      parentThreadId: options.subagent || options.sideChat ? ThreadId.make("parent") : null,
      relationshipToParent: options.subagent ? ("subagent" as const) : null,
      rootThreadId: threadId,
      ...(options.sideChat ? { sideChat: true } : {}),
    },
    archivedAt: options.archived ? iso(NOW - MINUTE) : null,
    deletedAt: options.deleted ? iso(NOW - MINUTE) : null,
    latestRun: options.noRun
      ? null
      : {
          runId: RunId.make(`run-${id}`),
          status,
          requestedAt: null,
          startedAt: startedAt === null ? null : iso(startedAt),
          completedAt: completedAt === null ? null : iso(completedAt),
          assistantMessageId: null,
        },
    hasPendingApprovals: options.approval ?? false,
    hasPendingUserInput: options.question ?? false,
    pendingSubagentRequest: options.subagentRequest ?? null,
  };
}

describe("summarizeHomeDay", () => {
  it("is empty when no agent has finished anything", () => {
    expect(summarizeHomeDay([], NOW)).toEqual({
      weekMinutes: 0,
      weekTasks: 0,
      todayMinutes: 0,
      todayTasks: 0,
      chatsWorkedToday: 0,
      waitingOnYou: 0,
      recentChats: [],
    });
    expect(summarizeHomeDay([thread("draft", { noRun: true })], NOW).weekTasks).toBe(0);
  });

  it("counts each finished task as the agent's minutes times the multiplier", () => {
    // 5 agent minutes -> 15 estimated minutes.
    const summary = summarizeHomeDay([thread("a")], NOW);
    expect(summary.weekMinutes).toBe(5 * TIME_SAVED_ESTIMATE.multiplier);
    expect(summary.todayMinutes).toBe(5 * TIME_SAVED_ESTIMATE.multiplier);
    expect(summary.weekTasks).toBe(1);
    expect(summary.todayTasks).toBe(1);
  });

  it("keeps each task between the minimum and maximum", () => {
    const quick = thread("quick", { startedAt: NOW - 30 * MINUTE, completedAt: NOW - 29 * MINUTE });
    const long = thread("long", { startedAt: NOW - 120 * MINUTE, completedAt: NOW - 10 * MINUTE });
    const untimed = thread("untimed", { startedAt: null, completedAt: NOW - 5 * MINUTE });
    expect(summarizeHomeDay([quick], NOW).weekMinutes).toBe(TIME_SAVED_ESTIMATE.minMinutesPerTask);
    expect(summarizeHomeDay([long], NOW).weekMinutes).toBe(TIME_SAVED_ESTIMATE.maxMinutesPerTask);
    expect(summarizeHomeDay([untimed], NOW).weekMinutes).toBe(
      TIME_SAVED_ESTIMATE.minMinutesPerTask,
    );
  });

  it("separates today from the rest of the week and ignores older work", () => {
    const yesterday = new Date(2026, 10, 9, 18, 0, 0).getTime();
    const lastMonth = NOW - 30 * 24 * 60 * MINUTE;
    const summary = summarizeHomeDay(
      [
        thread("today"),
        thread("yesterday", { startedAt: yesterday }),
        thread("old", { startedAt: lastMonth }),
      ],
      NOW,
    );
    expect(summary.weekTasks).toBe(2);
    expect(summary.todayTasks).toBe(1);
    expect(summary.weekMinutes).toBe(30);
    expect(summary.todayMinutes).toBe(15);
    expect(summary.chatsWorkedToday).toBe(1);
    expect(summary.recentChats.map((chat) => chat.threadId)).toEqual(["today"]);
  });

  it("does not count failed, running, deleted, subagent or side-chat runs as saved time", () => {
    const summary = summarizeHomeDay(
      [
        thread("failed", { status: "failed" }),
        thread("running", { status: "running" }),
        thread("deleted", { deleted: true }),
        thread("subagent", { subagent: true }),
        thread("side", { sideChat: true }),
      ],
      NOW,
    );
    expect(summary.weekTasks).toBe(0);
    expect(summary.chatsWorkedToday).toBe(2);
    expect(summary.recentChats.map((chat) => [chat.threadId, chat.state])).toEqual([
      ["failed", "stopped"],
      ["running", "working"],
    ]);
  });

  it("counts archived chats' saved time but leaves them out of today's list", () => {
    const summary = summarizeHomeDay([thread("archived", { archived: true })], NOW);
    expect(summary.weekTasks).toBe(1);
    expect(summary.chatsWorkedToday).toBe(0);
    expect(summary.recentChats).toEqual([]);
  });

  it("counts a task finished during the current minute right away", () => {
    const summary = summarizeHomeDay(
      [thread("just-now", { startedAt: NOW - 2 * MINUTE, completedAt: NOW + 30_000 })],
      NOW,
    );
    expect(summary.todayTasks).toBe(1);
    expect(summary.weekTasks).toBe(1);
  });

  it("lists chats waiting on the user first, even from earlier days", () => {
    const earlier = NOW - 3 * 24 * 60 * MINUTE;
    const summary = summarizeHomeDay(
      [
        thread("newest", { startedAt: NOW - 10 * MINUTE }),
        thread("approval", { status: "waiting", startedAt: earlier, approval: true }),
        thread("question", { status: "waiting", question: true }),
        thread("child-needs-you", { subagentRequest: "approval" }),
        thread("older", { startedAt: NOW - 120 * MINUTE }),
      ],
      NOW,
    );
    expect(summary.waitingOnYou).toBe(3);
    expect(summary.recentChats).toHaveLength(3);
    expect(summary.recentChats.every((chat) => chat.state === "waiting")).toBe(true);
    expect(summary.recentChats.map((chat) => chat.threadId)).toEqual([
      "child-needs-you",
      "question",
      "approval",
    ]);
  });
});

describe("splitMinutes", () => {
  it("splits minutes into hours and minutes", () => {
    expect(splitMinutes(200)).toEqual({ hours: 3, minutes: 20 });
    expect(splitMinutes(45)).toEqual({ hours: 0, minutes: 45 });
    expect(splitMinutes(120)).toEqual({ hours: 2, minutes: 0 });
    expect(splitMinutes(-3)).toEqual({ hours: 0, minutes: 0 });
  });
});
