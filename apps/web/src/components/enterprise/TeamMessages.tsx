import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  type ServerProviderSkill,
  TEAM_MESSAGE_NOTE_MAX_CHARS,
  type TeamMessage,
} from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  MailIcon,
  MessagesSquareIcon,
  PackageIcon,
  PlusIcon,
  SendHorizontalIcon,
  SquarePenIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useNowMinute } from "~/hooks/useNowMinute";
import { getLocale, t } from "~/i18n";
import { cn } from "~/lib/utils";
import { enterpriseEnvironment, enterpriseFailureMessage } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { environmentServerConfigsAtom } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  mentionsSkill,
  noteWithoutSkillCommand,
  rankSkillsForMessage,
} from "./skillSuggestion.logic";
import {
  conversationMessages,
  countUnreadIncoming,
  dayLabel,
  groupByDay,
  groupConversations,
  initials,
  isPendingSkill,
  isUnreadIncoming,
  rosterPeople,
  shareableSkills,
  type TeamConversation,
} from "./teamChats.logic";

/** How many of your skills the suggestion strip offers at once. */
const SKILL_SUGGESTION_LIMIT = 6;

interface ChatPeer {
  readonly key: string;
  readonly displayName: string;
}

type InboxView =
  | { readonly kind: "list" }
  | { readonly kind: "new" }
  | { readonly kind: "chat"; readonly peer: ChatPeer };

function dateLocale(): string {
  return getLocale() === "es" ? "es-MX" : "en-US";
}

function parseDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(iso: string): string {
  return parseDate(iso)?.toLocaleTimeString(dateLocale(), { timeStyle: "short" }) ?? "";
}

/** The time on a chat row: the hour today, "Yesterday", the weekday this week, or the date. */
function formatListTime(iso: string, nowMs: number): string {
  const date = parseDate(iso);
  if (date === null) return "";
  const label = dayLabel(iso, nowMs);
  if (label.kind === "today") return formatClock(iso);
  if (label.kind === "yesterday") return t("Yesterday", undefined, "teamChat");
  const sixDaysMs = 6 * 86_400_000;
  if (nowMs - date.getTime() < sixDaysMs)
    return date.toLocaleDateString(dateLocale(), { weekday: "long" });
  return date.toLocaleDateString(dateLocale(), { dateStyle: "short" });
}

function formatDaySeparator(iso: string, nowMs: number): string {
  const label = dayLabel(iso, nowMs);
  if (label.kind === "today") return t("Today", undefined, "teamChat");
  if (label.kind === "yesterday") return t("Yesterday", undefined, "teamChat");
  const sameYear = label.date.getFullYear() === new Date(nowMs).getFullYear();
  return label.date.toLocaleDateString(dateLocale(), {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function previewText(message: TeamMessage): string {
  if (message.skill !== null)
    return message.outgoing
      ? t("You sent the skill «{name}»", { name: message.skill.name })
      : t("Sent you the skill «{name}»", { name: message.skill.name });
  const note = (message.note ?? "").replace(/\s+/g, " ").trim();
  return message.outgoing ? t("You: {text}", { text: note }) : note;
}

/** What the status badge on a skill card says depends on whose side you are on. */
function skillStatusLabel(message: TeamMessage): string {
  if (message.status === "installed" || message.status === "declined")
    return t(message.status, undefined, "teamMessage");
  if (message.outgoing) return t(`sent-${message.status}`, undefined, "teamMessage");
  return t("to-answer", undefined, "teamMessage");
}

function useTeamMessages(environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(
    enterpriseEnvironment.teamMessages({ environmentId, input: {} }),
  );
  return { query, messages: query.data ?? [] };
}

/** Every SKILL.md this IDE's agents found: the active chat's agent may not be the one that has it. */
function useShareableSkills(
  environmentId: EnvironmentId,
  skills: ReadonlyArray<ServerProviderSkill>,
): ReadonlyArray<ServerProviderSkill> {
  const providers = useAtomValue(environmentServerConfigsAtom).get(environmentId)?.providers;
  return shareableSkills([...skills, ...(providers ?? []).flatMap((provider) => provider.skills)]);
}

/** The current minute as epoch ms; re-renders once a minute so relative times stay right. */
function useNowMs(): number {
  return Date.parse(`${useNowMinute()}:00.000Z`);
}

function Avatar({ name, className }: { readonly name: string; readonly className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/12 font-medium text-primary text-sm",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

function PanelHeader({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-3">
      {children}
    </div>
  );
}

function CloseInboxButton({ onClose }: { readonly onClose: () => void }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={t("Close")}
      className="shrink-0"
      onClick={onClose}
    >
      <XIcon />
    </Button>
  );
}

function BackButton({ onBack }: { readonly onBack: () => void }) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={t("Back")}
      className="-ms-1 shrink-0"
      onClick={onBack}
    >
      <ArrowLeftIcon />
    </Button>
  );
}

/** Your chats with colleagues, from the mail button in the chat header, docked on the right. */
export function TeamMessagesButton(props: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<InboxView>({ kind: "list" });
  const { query, messages } = useTeamMessages(props.environmentId);
  const unread = countUnreadIncoming(messages);
  const close = () => setOpen(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size={unread > 0 ? "sm" : "icon-sm"}
              variant="ghost"
              aria-label={t("Messages")}
              aria-expanded={open}
              data-pressed={open ? "" : undefined}
              className="shrink-0 [-webkit-app-region:no-drag]"
              onClick={() => setOpen((current) => !current)}
            />
          }
        >
          <MailIcon className="size-4" />
          {unread > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-2xs font-medium text-primary-foreground">
              {unread}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">{t("Messages")}</TooltipPopup>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen} modal={false} disablePointerDismissal>
        <SheetPopup side="right" variant="docked" showCloseButton={false}>
          {view.kind === "chat" ? (
            <ConversationView
              key={view.peer.key}
              environmentId={props.environmentId}
              skills={props.skills}
              peer={view.peer}
              messages={messages}
              onBack={() => setView({ kind: "list" })}
              onClose={close}
            />
          ) : view.kind === "new" ? (
            <NewChatView
              environmentId={props.environmentId}
              onBack={() => setView({ kind: "list" })}
              onClose={close}
              onPick={(peer) => setView({ kind: "chat", peer })}
            />
          ) : (
            <ConversationListView
              loading={query.data === null && query.error === null}
              error={query.data === null ? query.error : null}
              messages={messages}
              onNewChat={() => setView({ kind: "new" })}
              onOpenChat={(peer) => setView({ kind: "chat", peer })}
              onClose={close}
            />
          )}
        </SheetPopup>
      </Sheet>
    </>
  );
}

function ConversationListView(props: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly messages: ReadonlyArray<TeamMessage>;
  readonly onNewChat: () => void;
  readonly onOpenChat: (peer: ChatPeer) => void;
  readonly onClose: () => void;
}) {
  const conversations = groupConversations(props.messages);
  const now = useNowMs();
  return (
    <>
      <PanelHeader>
        <div className="min-w-0 flex-1 ps-1">
          <SheetTitle size="sm">{t("Messages")}</SheetTitle>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={props.onNewChat}>
          <SquarePenIcon />
          {t("New chat")}
        </Button>
        <CloseInboxButton onClose={props.onClose} />
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {props.error !== null ? (
          <p className="px-3 py-4 text-muted-foreground text-sm">{t(props.error)}</p>
        ) : props.loading ? (
          <p className="px-3 py-4 text-muted-foreground text-sm">{t("Loading…")}</p>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-muted">
              <MessagesSquareIcon aria-hidden className="size-5 text-muted-foreground" />
            </span>
            <div className="space-y-1">
              <p className="font-medium text-sm">{t("No chats yet")}</p>
              <p className="text-muted-foreground text-xs">
                {t("Write to anyone in your company. Your conversations will show up here.")}
              </p>
            </div>
            <Button type="button" size="sm" onClick={props.onNewChat}>
              <SquarePenIcon />
              {t("New chat")}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col">
            {conversations.map((conversation) => (
              <ConversationRow
                key={conversation.key}
                conversation={conversation}
                nowMs={now}
                onOpen={() =>
                  props.onOpenChat({
                    key: conversation.key,
                    displayName: conversation.displayName,
                  })
                }
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ConversationRow(props: {
  readonly conversation: TeamConversation;
  readonly nowMs: number;
  readonly onOpen: () => void;
}) {
  const { conversation } = props;
  const hasUnread = conversation.unreadCount > 0;
  return (
    <li>
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={props.onOpen}
      >
        <Avatar name={conversation.displayName} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">
              {conversation.displayName}
            </span>
            <span
              className={cn(
                "shrink-0 text-2xs tabular-nums",
                hasUnread ? "font-medium text-primary" : "text-muted-foreground",
              )}
            >
              {formatListTime(conversation.lastMessage.createdAt, props.nowMs)}
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-xs",
                hasUnread ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {conversation.lastMessage.skill !== null ? (
                <PackageIcon aria-hidden className="me-1 inline size-3 align-[-0.1em]" />
              ) : null}
              {previewText(conversation.lastMessage)}
            </span>
            {hasUnread ? (
              <span
                className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-primary px-1 font-medium text-2xs text-primary-foreground tabular-nums"
                aria-label={t("{count} unread", { count: conversation.unreadCount })}
              >
                {conversation.unreadCount}
              </span>
            ) : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function NewChatView(props: {
  readonly environmentId: EnvironmentId;
  readonly onBack: () => void;
  readonly onClose: () => void;
  readonly onPick: (peer: ChatPeer) => void;
}) {
  const org = useEnvironmentQuery(
    enterpriseEnvironment.org({ environmentId: props.environmentId, input: {} }),
  );
  const [search, setSearch] = useState("");
  const people = rosterPeople(org.data?.teams ?? []);
  const needle = search.trim().toLocaleLowerCase();
  const shown =
    needle.length === 0
      ? people
      : people.filter((person) =>
          `${person.displayName} ${person.teams}`.toLocaleLowerCase().includes(needle),
        );
  return (
    <>
      <PanelHeader>
        <BackButton onBack={props.onBack} />
        <div className="min-w-0 flex-1">
          <SheetTitle size="sm">{t("New chat")}</SheetTitle>
        </div>
        <CloseInboxButton onClose={props.onClose} />
      </PanelHeader>
      <div className="shrink-0 px-3 pt-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("Search colleagues")}
          aria-label={t("Search colleagues")}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {org.data === null ? (
          <p className="px-3 py-4 text-muted-foreground text-sm">
            {org.error !== null ? t(org.error) : t("Loading…")}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-3 py-4 text-muted-foreground text-sm">
            {people.length === 0 ? t("No colleagues yet") : t("Nobody matches that search.")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {shown.map((person) => (
              <li key={person.key}>
                <button
                  type="button"
                  className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => props.onPick({ key: person.key, displayName: person.displayName })}
                >
                  <Avatar name={person.displayName} className="size-9" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-sm">{person.displayName}</span>
                    <span className="truncate text-muted-foreground text-xs">{person.teams}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function scrollParentToBottom(node: HTMLDivElement | null): void {
  const scroller = node?.parentElement;
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
}

function ConversationView(props: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly peer: ChatPeer;
  readonly messages: ReadonlyArray<TeamMessage>;
  readonly onBack: () => void;
  readonly onClose: () => void;
}) {
  const thread = conversationMessages(props.messages, props.peer.key);
  const days = groupByDay(thread);
  const now = useNowMs();
  const markRead = useAtomCommand(enterpriseEnvironment.readTeamMessage, {
    label: "read team message",
    reportFailure: false,
  });
  // Each message is marked read once; the 10 s poll would otherwise ask again until it lands.
  const markedRef = useRef(new Set<string>());
  const { environmentId } = props;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the hub this open chat's new messages were read
  useEffect(() => {
    for (const message of thread) {
      if (!isUnreadIncoming(message) || markedRef.current.has(message.id)) continue;
      markedRef.current.add(message.id);
      void markRead({ environmentId, input: { id: message.id } });
    }
  }, [thread, markRead, environmentId, markedRef]);
  const latest = thread.at(-1);
  // The newest message carries the name the hub knows today.
  const name =
    latest === undefined
      ? props.peer.displayName
      : latest.outgoing
        ? latest.toDisplayName
        : latest.fromDisplayName;
  return (
    <>
      <PanelHeader>
        <BackButton onBack={props.onBack} />
        <Avatar name={name} className="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <SheetTitle size="sm">{name}</SheetTitle>
        </div>
        <CloseInboxButton onClose={props.onClose} />
      </PanelHeader>
      <div
        className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto bg-muted/30 px-3 py-3"
        role="log"
        aria-label={t("Conversation with {name}", { name })}
      >
        {thread.length === 0 ? (
          <p className="mx-auto mt-10 max-w-64 text-center text-muted-foreground text-xs">
            {t("Say hi to {name}. You can also send them one of your skills.", { name })}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {days.map((day) => (
              <section key={day.dayKey} className="flex flex-col gap-1.5">
                <div className="sticky top-0 z-1 flex justify-center py-1">
                  <span className="rounded-full bg-background/90 px-2.5 py-0.5 text-2xs text-muted-foreground shadow-xs ring-1 ring-border/60">
                    {formatDaySeparator(day.messages[0]?.createdAt ?? "", now)}
                  </span>
                </div>
                {day.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    environmentId={props.environmentId}
                    message={message}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
        {/* Keyed on the newest message: it remounts, and scrolls the chat down, when the chat
            opens or a message arrives, but not when a poll only changes a status. */}
        <div key={latest?.id ?? "empty"} ref={scrollParentToBottom} aria-hidden />
      </div>
      <ChatComposer
        environmentId={props.environmentId}
        skills={props.skills}
        recipientKey={props.peer.key}
      />
    </>
  );
}

function MessageBubble(props: {
  readonly environmentId: EnvironmentId;
  readonly message: TeamMessage;
}) {
  const { message } = props;
  const mine = message.outgoing;
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      {message.skill !== null ? (
        <SkillCard environmentId={props.environmentId} message={message} />
      ) : (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed",
            mine
              ? "rounded-br-md bg-primary text-primary-foreground"
              : "rounded-bl-md bg-background text-foreground ring-1 ring-border/60",
          )}
        >
          {message.note}
        </div>
      )}
      <span className="mt-0.5 px-1 text-2xs text-muted-foreground tabular-nums">
        {formatClock(message.createdAt)}
        {mine && message.skill === null && message.status === "read" ? (
          <>
            <span className="mx-1">·</span>
            {t("sent-read", undefined, "teamMessage")}
          </>
        ) : null}
      </span>
    </div>
  );
}

function SkillCard(props: {
  readonly environmentId: EnvironmentId;
  readonly message: TeamMessage;
}) {
  const { message } = props;
  const skill = message.skill;
  if (skill === null) return null;
  const pending = isPendingSkill(message);
  return (
    <div
      className={cn(
        "w-[85%] max-w-80 space-y-2 rounded-2xl border bg-card p-3 text-card-foreground shadow-xs",
        message.outgoing ? "rounded-br-md border-primary/30" : "rounded-bl-md border-border/70",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <PackageIcon aria-hidden className="size-4 text-primary" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 truncate font-medium text-sm">{skill.name}</span>
            <Badge variant="outline" size="sm">
              {t("Skill")}
            </Badge>
          </div>
          {skill.description ? (
            <p className="line-clamp-3 text-muted-foreground text-xs">{skill.description}</p>
          ) : null}
        </div>
      </div>
      {message.note ? (
        <p className="whitespace-pre-wrap break-words text-sm">{message.note}</p>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">
          {t("See what the skill tells the agent")}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-2xs">
          {skill.content}
        </pre>
      </details>
      {pending ? (
        <SkillDecision
          environmentId={props.environmentId}
          message={message}
          declineLabel={t("No, thanks")}
        />
      ) : (
        <Badge
          variant={message.status === "installed" ? "success" : "outline"}
          size="sm"
          className="w-fit"
        >
          {skillStatusLabel(message)}
        </Badge>
      )}
    </div>
  );
}

function ChatComposer(props: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly recipientKey: string;
}) {
  const canSend = useAtomValue(
    enterpriseEnvironment.sendTeamMessage.permissionAtom(props.environmentId),
  );
  const send = useAtomCommand(enterpriseEnvironment.sendTeamMessage, {
    label: "send team message",
    reportFailure: false,
  });
  const skills = useShareableSkills(props.environmentId, props.skills);
  const [text, setText] = useState("");
  const [attached, setAttached] = useState<ServerProviderSkill | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- focuses the DOM textarea when a chat opens
  useEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
  }, []);

  const talksAboutSkill = mentionsSkill(text);
  const showSkills = attached === null && (pickerOpen || (talksAboutSkill && !suggestionDismissed));
  const suggestions = showSkills
    ? rankSkillsForMessage(skills, text).slice(0, SKILL_SUGGESTION_LIMIT)
    : [];
  const note = text.trim();
  const ready = canSend && !sending && (attached !== null || note.length > 0);

  const attach = (skill: ServerProviderSkill) => {
    setAttached(skill);
    setText((current) => noteWithoutSkillCommand(current));
    setPickerOpen(false);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const submit = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    const result = await send({
      environmentId: props.environmentId,
      input: {
        recipientKey: props.recipientKey,
        ...(note.length > 0 ? { note } : {}),
        ...(attached !== null ? { skillPath: attached.path } : {}),
      },
    });
    setSending(false);
    if (result._tag === "Success") {
      setText("");
      setAttached(null);
      setSuggestionDismissed(false);
      textareaRef.current?.focus({ preventScroll: true });
    } else if (!isAtomCommandInterrupted(result)) {
      setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  return (
    <form
      className="shrink-0 space-y-2 border-t border-border/60 bg-background p-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {error !== null ? (
        <p role="alert" className="px-1 text-destructive text-xs">
          {error}
        </p>
      ) : null}
      {showSkills ? (
        <div className="space-y-1.5 rounded-xl border border-border/70 bg-muted/40 p-2">
          <div className="flex items-center gap-2 px-0.5">
            <span className="min-w-0 flex-1 font-medium text-muted-foreground text-xs">
              {t("Send a skill? Your skills:")}
            </span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost-muted"
              aria-label={t("Hide skills")}
              className="-my-1"
              onClick={() => {
                setPickerOpen(false);
                setSuggestionDismissed(true);
              }}
            >
              <XIcon />
            </Button>
          </div>
          {suggestions.length === 0 ? (
            <p className="px-0.5 text-muted-foreground text-xs">
              {t("You have no skills to share yet.")}
            </p>
          ) : (
            <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
              {suggestions.map((skill) => (
                <button
                  key={skill.path}
                  type="button"
                  className="flex max-w-full min-w-0 flex-col rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:max-w-44"
                  onClick={() => attach(skill)}
                >
                  <span className="truncate font-medium text-xs">
                    {skill.displayName ?? skill.name}
                  </span>
                  {(skill.shortDescription ?? skill.description) ? (
                    <span className="truncate text-2xs text-muted-foreground">
                      {skill.shortDescription ?? skill.description}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {attached !== null ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5">
          <PackageIcon aria-hidden className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-xs">
            {t("Skill attached: {name}", { name: attached.displayName ?? attached.name })}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label={t("Remove skill")}
            className="-my-1"
            onClick={() => setAttached(null)}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}
      <div className="flex items-end gap-1.5">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("Attach a skill")}
          aria-pressed={pickerOpen}
          className="shrink-0"
          disabled={attached !== null}
          onClick={() => {
            setPickerOpen((current) => !current);
            setSuggestionDismissed(false);
          }}
        >
          <PlusIcon />
        </Button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          maxLength={TEAM_MESSAGE_NOTE_MAX_CHARS}
          aria-label={t("Message")}
          placeholder={
            attached !== null ? t("Why should they use it? (optional)") : t("Write a message")
          }
          className="field-sizing-content max-h-32 min-h-9 min-w-0 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2 text-sm leading-5 outline-none transition-shadow placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/24"
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (!mentionsSkill(next)) setSuggestionDismissed(false);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void submit();
          }}
        />
        <Button
          type="submit"
          size="icon"
          aria-label={sending ? t("Sending…") : t("Send")}
          className="shrink-0"
          disabled={!ready}
        >
          <SendHorizontalIcon />
        </Button>
      </div>
    </form>
  );
}

/** Install / Decline for a skill a colleague sent you. */
function SkillDecision(props: {
  readonly environmentId: EnvironmentId;
  readonly message: TeamMessage;
  readonly declineLabel?: string;
  readonly className?: string;
}) {
  const decide = useAtomCommand(enterpriseEnvironment.decideTeamMessage, {
    label: "answer skill request",
    reportFailure: false,
  });
  const canDecide = useAtomValue(
    enterpriseEnvironment.decideTeamMessage.permissionAtom(props.environmentId),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skill = props.message.skill;
  if (skill === null) return null;
  const answer = async (decision: "installed" | "declined") => {
    setBusy(true);
    setError(null);
    const result = await decide({
      environmentId: props.environmentId,
      input: { id: props.message.id, decision },
    });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title:
          decision === "installed"
            ? t("Installed {name}", { name: skill.name })
            : t("Declined {name}", { name: skill.name }),
      });
    } else if (!isAtomCommandInterrupted(result)) {
      setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    }
  };
  return (
    <div className={cn("space-y-2", props.className)}>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || !canDecide} onClick={() => void answer("installed")}>
          {busy ? t("Installing…") : t("Install")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !canDecide}
          onClick={() => void answer("declined")}
        >
          {props.declineLabel ?? t("Decline")}
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function formatWhen(iso: string): string {
  return (
    parseDate(iso)?.toLocaleString(dateLocale(), { dateStyle: "short", timeStyle: "short" }) ?? ""
  );
}

function SharedSkillRow(props: {
  readonly environmentId: EnvironmentId;
  readonly message: TeamMessage;
}) {
  const skill = props.message.skill;
  if (skill === null) return null;
  const pending = isPendingSkill(props.message);
  return (
    <li className="space-y-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-start gap-2">
        <PackageIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{skill.name}</span>
            <Badge variant="outline" size="sm">
              {t("Skill")}
            </Badge>
            {!pending ? (
              <Badge variant="outline" size="sm">
                {t(props.message.status, undefined, "teamMessage")}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {props.message.outgoing
              ? t("You shared it with {name}", { name: props.message.toDisplayName })
              : t("{name} shared it with you", { name: props.message.fromDisplayName })}
            {" · "}
            {formatWhen(props.message.createdAt)}
          </p>
          {skill.description ? (
            <p className="mt-1 text-xs text-muted-foreground">{skill.description}</p>
          ) : null}
        </div>
      </div>
      <p className="whitespace-pre-wrap text-sm">
        {props.message.note ?? (
          <span className="text-muted-foreground italic">{t("No message")}</span>
        )}
      </p>
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          {t("See what the skill tells the agent")}
        </summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
          {skill.content}
        </pre>
      </details>
      {pending ? (
        <SkillDecision environmentId={props.environmentId} message={props.message} />
      ) : null}
    </li>
  );
}

export function usePendingSharedCount(environmentId: EnvironmentId): number {
  return useTeamMessages(environmentId).messages.filter(isPendingSkill).length;
}

/** The "Sharing" tab: skills colleagues shared with you, with their note, and what you shared. */
export function SharingPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { query, messages } = useTeamMessages(environmentId);
  const skills = messages.filter((message) => message.kind === "skill");
  const received = skills.filter((message) => !message.outgoing);
  const sent = skills.filter((message) => message.outgoing);
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <p className="text-xs text-muted-foreground">
        {t(
          "Skills your colleagues shared with you. Read what a skill tells the agent before installing it; nothing is installed unless you accept.",
        )}
      </p>
      {query.error !== null && query.data === null ? (
        <p className="text-sm text-muted-foreground">{t(query.error)}</p>
      ) : null}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">{t("Shared with you")}</h3>
        {received.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nothing shared with you yet.")}</p>
        ) : (
          <ul className="space-y-2">
            {received.map((message) => (
              <SharedSkillRow key={message.id} environmentId={environmentId} message={message} />
            ))}
          </ul>
        )}
      </section>
      {sent.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("You shared")}</h3>
          <ul className="space-y-2">
            {sent.map((message) => (
              <SharedSkillRow key={message.id} environmentId={environmentId} message={message} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
