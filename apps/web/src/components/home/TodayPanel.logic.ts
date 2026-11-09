import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { isListedThreadLineage } from "@t3tools/contracts";

/**
 * The time-saved estimate, in one place so the info popover can quote the same numbers.
 * Each task an agent finished counts as `multiplier` times the minutes the agent worked on it,
 * kept between `minMinutesPerTask` and `maxMinutesPerTask` so a one-line answer never counts as
 * nothing and a long run never inflates the total.
 */
export const TIME_SAVED_ESTIMATE = {
  multiplier: 3,
  minMinutesPerTask: 5,
  maxMinutesPerTask: 30,
  windowDays: 7,
} as const;

const RECENT_CHAT_LIMIT = 3;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

type HomeThread = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "lineage"
  | "archivedAt"
  | "deletedAt"
  | "latestRun"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
>;

type HomeChatState = "waiting" | "working" | "done" | "stopped";

interface HomeRecentChat {
  readonly environmentId: EnvironmentThreadShell["environmentId"];
  readonly threadId: EnvironmentThreadShell["id"];
  readonly title: string;
  readonly state: HomeChatState;
}

interface HomeDaySummary {
  /** Estimated minutes of manual work saved over the last `windowDays` days. */
  readonly weekMinutes: number;
  readonly weekTasks: number;
  readonly todayMinutes: number;
  /** Tasks the agents finished since local midnight. */
  readonly todayTasks: number;
  /** Chats an agent worked on since local midnight, including ones still working. */
  readonly chatsWorkedToday: number;
  /** Chats waiting on the user: an approval, a question or a permission request. */
  readonly waitingOnYou: number;
  /** Chats that need the user first, then today's most recent ones. */
  readonly recentChats: ReadonlyArray<HomeRecentChat>;
}

const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

function parseMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function startOfLocalDay(nowMs: number): number {
  const day = new Date(nowMs);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function estimateTaskMinutes(startedAtMs: number | null, completedAtMs: number): number {
  const agentMinutes =
    startedAtMs === null ? 0 : Math.max(0, (completedAtMs - startedAtMs) / MINUTE_MS);
  const estimate = Math.round(agentMinutes * TIME_SAVED_ESTIMATE.multiplier);
  return Math.min(
    TIME_SAVED_ESTIMATE.maxMinutesPerTask,
    Math.max(TIME_SAVED_ESTIMATE.minMinutesPerTask, estimate),
  );
}

function chatState(thread: HomeThread): HomeChatState | null {
  if (
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput ||
    (thread.pendingSubagentRequest ?? null) !== null
  ) {
    return "waiting";
  }
  const run = thread.latestRun;
  if (run === null) return null;
  if (run.completedAt === null && ACTIVE_RUN_STATUSES.has(run.status)) return "working";
  return run.status === "completed" ? "done" : "stopped";
}

/**
 * What the agents did for the user, from the thread list the sidebar already holds. The list
 * carries only each chat's latest agent run, so a chat counts at most once: the estimate errs low.
 * Subagent and side chats are left out, because their work is part of the chat that started them.
 */
export function summarizeHomeDay(
  threads: ReadonlyArray<HomeThread>,
  nowMs: number,
): HomeDaySummary {
  const todayStartMs = startOfLocalDay(nowMs);
  const windowStartMs = nowMs - TIME_SAVED_ESTIMATE.windowDays * DAY_MS;
  let weekMinutes = 0;
  let weekTasks = 0;
  let todayMinutes = 0;
  let todayTasks = 0;
  let chatsWorkedToday = 0;
  let waitingOnYou = 0;
  const recent: Array<HomeRecentChat & { readonly sortMs: number }> = [];

  for (const thread of threads) {
    if (thread.deletedAt !== null || !isListedThreadLineage(thread.lineage)) continue;
    const run = thread.latestRun;
    const completedAtMs = parseMs(run?.completedAt);
    const startedAtMs = parseMs(run?.startedAt) ?? parseMs(run?.requestedAt);

    if (
      run?.status === "completed" &&
      completedAtMs !== null &&
      completedAtMs >= windowStartMs &&
      completedAtMs <= nowMs
    ) {
      const minutes = estimateTaskMinutes(startedAtMs, completedAtMs);
      weekMinutes += minutes;
      weekTasks += 1;
      if (completedAtMs >= todayStartMs) {
        todayMinutes += minutes;
        todayTasks += 1;
      }
    }

    if (thread.archivedAt !== null) continue;
    const state = chatState(thread);
    if (state === null) continue;
    const activityMs = completedAtMs ?? startedAtMs;
    const workedToday = state === "working" || (activityMs !== null && activityMs >= todayStartMs);
    if (workedToday) chatsWorkedToday += 1;
    if (state === "waiting") waitingOnYou += 1;
    if (workedToday || state === "waiting") {
      recent.push({
        environmentId: thread.environmentId,
        threadId: thread.id,
        title: thread.title,
        state,
        sortMs: activityMs ?? 0,
      });
    }
  }

  recent.sort(
    (left, right) =>
      Number(right.state === "waiting") - Number(left.state === "waiting") ||
      right.sortMs - left.sortMs,
  );

  return {
    weekMinutes,
    weekTasks,
    todayMinutes,
    todayTasks,
    chatsWorkedToday,
    waitingOnYou,
    recentChats: recent.slice(0, RECENT_CHAT_LIMIT).map((chat) => ({
      environmentId: chat.environmentId,
      threadId: chat.threadId,
      title: chat.title,
      state: chat.state,
    })),
  };
}

/** Whole hours and the leftover minutes, for labels like "3 h 20 min". */
export function splitMinutes(totalMinutes: number): { hours: number; minutes: number } {
  const rounded = Math.max(0, Math.round(totalMinutes));
  return { hours: Math.floor(rounded / 60), minutes: rounded % 60 };
}
