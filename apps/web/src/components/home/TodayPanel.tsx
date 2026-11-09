import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDaysIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { t, threadTitleForDisplay } from "~/i18n";
import { cn } from "~/lib/utils";
import { useOwnThreadShells } from "~/state/enterprise";
import { buildThreadRouteParams } from "~/threadRoutes";
import { HOME_CARD_CLASS_NAME } from "./homeCard";
import { summarizeHomeDay } from "./TodayPanel.logic";

type HomeDaySummary = ReturnType<typeof summarizeHomeDay>;
type HomeRecentChat = HomeDaySummary["recentChats"][number];

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? t(one) : t(many, { count });
}

/**
 * "Today's summary" on the empty draft screen: what the agents did today and what waits on you.
 * It takes no props and reads only the quiet thread list and the minute clock, so typing in
 * the composer never re-renders it.
 */
export function TodayPanel() {
  const threads = useOwnThreadShells();
  const nowMinute = useNowMinute();
  const summary = summarizeHomeDay(threads, Date.parse(`${nowMinute}:00.000Z`));
  return <DaySummaryCard summary={summary} />;
}

function DaySummaryCard({ summary }: { readonly summary: HomeDaySummary }) {
  const hasActivity = summary.chatsWorkedToday > 0 || summary.waitingOnYou > 0;
  return (
    <div className={HOME_CARD_CLASS_NAME} data-home-today-summary>
      <div className="flex items-center gap-2 font-medium text-foreground text-sm">
        <CalendarDaysIcon aria-hidden className="size-4 shrink-0 text-primary" />
        {t("Today's summary")}
      </div>
      {hasActivity ? (
        <>
          <p className="text-muted-foreground text-xs">
            {countLabel(
              summary.chatsWorkedToday,
              "1 chat with activity",
              "{count} chats with activity",
            )}
            <span className="mx-1">·</span>
            {countLabel(summary.todayTasks, "1 task finished", "{count} tasks finished")}
            {summary.waitingOnYou > 0 ? (
              <>
                <span className="mx-1">·</span>
                <span className="font-medium text-warning-foreground">
                  {countLabel(summary.waitingOnYou, "1 waiting on you", "{count} waiting on you")}
                </span>
              </>
            ) : null}
          </p>
          {summary.recentChats.length > 0 ? (
            <ul className="-mx-1.5 hidden flex-col [@media(min-height:50rem)]:flex">
              {summary.recentChats.map((chat) => (
                <RecentChatRow key={`${chat.environmentId}:${chat.threadId}`} chat={chat} />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-xs">
          {t("Nothing yet today. What your agents do will show up here.")}
        </p>
      )}
    </div>
  );
}

const CHAT_STATE_PRESENTATION = {
  waiting: {
    label: "Needs you",
    Icon: MessageCircleQuestionIcon,
    className: "text-warning-foreground",
  },
  working: { label: "Working", Icon: LoaderCircleIcon, className: "text-muted-foreground" },
  done: { label: "Done", Icon: CircleCheckIcon, className: "text-success-foreground" },
  stopped: { label: "Stopped", Icon: CircleAlertIcon, className: "text-muted-foreground" },
} as const;

function RecentChatRow({ chat }: { readonly chat: HomeRecentChat }) {
  const navigate = useNavigate();
  const presentation = CHAT_STATE_PRESENTATION[chat.state];
  const title = threadTitleForDisplay(chat.title);
  return (
    <li>
      <button
        type="button"
        aria-label={t("Open {title}", { title })}
        className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => {
          void navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(chat.environmentId, chat.threadId)),
          });
        }}
      >
        <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
        <span className={cn("flex shrink-0 items-center gap-1", presentation.className)}>
          <presentation.Icon
            aria-hidden
            className={cn(
              "size-3.5",
              chat.state === "working" && "animate-spin motion-reduce:animate-none",
            )}
          />
          {t(presentation.label, undefined, "home")}
        </span>
      </button>
    </li>
  );
}
