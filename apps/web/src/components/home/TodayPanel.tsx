import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  HourglassIcon,
  InfoIcon,
  LoaderCircleIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { t, threadTitleForDisplay } from "~/i18n";
import { cn } from "~/lib/utils";
import { useOwnThreadShells } from "~/state/enterprise";
import { buildThreadRouteParams } from "~/threadRoutes";
import { composerFloatingLayerProps } from "../chat/composerEventScope";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { splitMinutes, summarizeHomeDay, TIME_SAVED_ESTIMATE } from "./TodayPanel.logic";

type HomeDaySummary = ReturnType<typeof summarizeHomeDay>;
type HomeRecentChat = HomeDaySummary["recentChats"][number];

const CARD_CLASS_NAME =
  "flex min-w-0 flex-col gap-1.5 rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-left shadow-xs";

function formatSavedTime(totalMinutes: number): string {
  const { hours, minutes } = splitMinutes(totalMinutes);
  if (hours === 0) return t("{minutes} min", { minutes });
  if (minutes === 0) return t("{hours} h", { hours });
  return t("{hours} h {minutes} min", { hours, minutes });
}

function countLabel(count: number, one: string, many: string): string {
  return count === 1 ? t(one) : t(many, { count });
}

/**
 * "Your day" on the empty draft screen: time the agents saved and what happened today.
 * It takes no props and reads only the quiet thread list and the minute clock, so typing in
 * the composer never re-renders it. Short windows hide it, and the chat list below a taller cut,
 * so it never pushes the centered composer off screen.
 */
export function TodayPanel() {
  const threads = useOwnThreadShells();
  const nowMinute = useNowMinute();
  const summary = summarizeHomeDay(threads, Date.parse(`${nowMinute}:00.000Z`));

  return (
    <section
      aria-label={t("Your day")}
      className="hidden gap-2 sm:grid-cols-2 [@media(min-height:44rem)]:grid"
      data-home-today-panel
    >
      <TimeSavedCard summary={summary} />
      <DaySummaryCard summary={summary} />
    </section>
  );
}

function TimeSavedCard({ summary }: { readonly summary: HomeDaySummary }) {
  if (summary.weekTasks === 0) {
    return (
      <div className={CARD_CLASS_NAME}>
        <div className="flex items-center gap-2 font-medium text-foreground text-sm">
          <HourglassIcon aria-hidden className="size-4 shrink-0 text-primary" />
          {t("Your time saved will show up here")}
        </div>
        <p className="text-muted-foreground text-xs">
          {t("Ask an agent for something and Norai will keep count.")}
        </p>
      </div>
    );
  }
  return (
    <div className={CARD_CLASS_NAME}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5 text-foreground text-sm">
          <HourglassIcon aria-hidden className="size-4 shrink-0 self-center text-primary" />
          <span>
            {t("Norai saved you")}{" "}
            <strong className="font-semibold text-base text-primary tabular-nums">
              {formatSavedTime(summary.weekMinutes)}
            </strong>
          </span>
        </div>
        <EstimateInfo />
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">
        {t("in the last {days} days", { days: TIME_SAVED_ESTIMATE.windowDays })}
        <span className="mx-1">·</span>
        {summary.todayTasks === 0
          ? t("today: nothing yet")
          : t("today: {time}", { time: formatSavedTime(summary.todayMinutes) })}
      </p>
    </div>
  );
}

function EstimateInfo() {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={t("How is this estimated?")}
            className="-my-1 -me-1.5 flex-none"
          />
        }
      >
        <InfoIcon />
      </PopoverTrigger>
      <PopoverPopup
        {...composerFloatingLayerProps}
        tooltipStyle
        side="top"
        width="sm"
        className="whitespace-normal text-left"
      >
        <div className="flex flex-col gap-1.5 text-xs">
          <div className="font-medium">{t("How we estimate this")}</div>
          <p>
            {t(
              "Each task an agent finishes counts as {multiplier} times the time the agent worked on it, between {min} and {max} min per task.",
              {
                multiplier: TIME_SAVED_ESTIMATE.multiplier,
                min: TIME_SAVED_ESTIMATE.minMinutesPerTask,
                max: TIME_SAVED_ESTIMATE.maxMinutesPerTask,
              },
            )}
          </p>
          <p className="text-muted-foreground">
            {t(
              "We only count the latest task of each chat from the last {days} days, so you probably saved more.",
              { days: TIME_SAVED_ESTIMATE.windowDays },
            )}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function DaySummaryCard({ summary }: { readonly summary: HomeDaySummary }) {
  const hasActivity = summary.chatsWorkedToday > 0 || summary.waitingOnYou > 0;
  return (
    // Narrow windows keep only the time card, so the panel stays one row tall.
    <div className={cn(CARD_CLASS_NAME, "hidden sm:flex")}>
      <div className="font-medium text-foreground text-sm">{t("Today's summary")}</div>
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
