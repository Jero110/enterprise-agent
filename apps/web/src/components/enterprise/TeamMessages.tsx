import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ServerProviderSkill, TeamMessage } from "@t3tools/contracts";
import { MailIcon, PackageIcon } from "lucide-react";
import { useState } from "react";

import { t } from "~/i18n";
import { cn } from "~/lib/utils";
import { enterpriseEnvironment, enterpriseFailureMessage } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { environmentServerConfigsAtom } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const NO_SKILL = "__none__";

function isPendingSkill(message: TeamMessage): boolean {
  return (
    !message.outgoing &&
    message.kind === "skill" &&
    (message.status === "unread" || message.status === "read")
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function useTeamMessages(environmentId: EnvironmentId) {
  const query = useEnvironmentQuery(
    enterpriseEnvironment.teamMessages({ environmentId, input: {} }),
  );
  return { query, messages: query.data ?? [] };
}

/** Skills a teammate could install: every SKILL.md any of this IDE's agents found, once each. */
function shareableSkills(skills: ReadonlyArray<ServerProviderSkill>) {
  const seen = new Set<string>();
  return skills.filter((skill) => {
    if (!skill.enabled || !/SKILL\.md$/i.test(skill.path) || seen.has(skill.name)) return false;
    seen.add(skill.name);
    return true;
  });
}

/** What the badge says depends on whose side you are on. */
function statusLabel(message: TeamMessage): string | null {
  if (message.status === "installed" || message.status === "declined")
    return t(message.status, undefined, "teamMessage");
  if (message.outgoing) return t(`sent-${message.status}`, undefined, "teamMessage");
  return message.kind === "skill" ? t("to-answer", undefined, "teamMessage") : null;
}

function MessageRow({
  message,
  onReply,
}: {
  readonly message: TeamMessage;
  readonly onReply: (recipientKey: string) => void;
}) {
  const label = statusLabel(message);
  return (
    <li
      className={cn(
        "space-y-1 rounded-lg border border-border/60 p-3",
        !message.outgoing && message.status === "unread" && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {message.outgoing
            ? t("To {name}", { name: message.toDisplayName })
            : t("From {name}", { name: message.fromDisplayName })}
        </span>
        {label !== null && message.skill === null ? (
          <Badge variant="outline" size="sm">
            {label}
          </Badge>
        ) : null}
        <span>{formatWhen(message.createdAt)}</span>
        {!message.outgoing ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="-my-1 -me-1.5"
            onClick={() => onReply(message.fromKey)}
          >
            {t("Reply")}
          </Button>
        ) : null}
      </div>
      {message.skill ? (
        <div className="flex items-center gap-1.5 text-xs">
          <PackageIcon aria-hidden className="size-3.5 text-primary" />
          <span className="font-medium">{message.skill.name}</span>
          {label !== null ? (
            <Badge variant="outline" size="sm">
              {label}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <p className="whitespace-pre-wrap text-sm">
        {message.note ?? <span className="text-muted-foreground italic">{t("No message")}</span>}
      </p>
    </li>
  );
}

function Compose(props: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
  readonly recipientKey: string | null;
  readonly onRecipientChange: (recipientKey: string | null) => void;
}) {
  const org = useEnvironmentQuery(
    enterpriseEnvironment.org({ environmentId: props.environmentId, input: {} }),
  );
  const canSend = useAtomValue(
    enterpriseEnvironment.sendTeamMessage.permissionAtom(props.environmentId),
  );
  const send = useAtomCommand(enterpriseEnvironment.sendTeamMessage, {
    label: "send team message",
    reportFailure: false,
  });
  const { recipientKey, onRecipientChange: setRecipientKey } = props;
  const [note, setNote] = useState("");
  const [skillPath, setSkillPath] = useState(NO_SKILL);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const people = new Map<string, string>();
  for (const team of org.data?.teams ?? [])
    for (const member of team.members)
      if (!member.isMe && member.memberKey !== undefined)
        people.set(member.memberKey, `${member.displayName} · ${team.name}`);
  const providers =
    useAtomValue(environmentServerConfigsAtom).get(props.environmentId)?.providers ?? [];
  // The active chat's agent may not be the one that has the skill, so offer every agent's.
  const skills = shareableSkills([
    ...props.skills,
    ...providers.flatMap((provider) => provider.skills),
  ]);
  const hasSkill = skillPath !== NO_SKILL;
  const ready = recipientKey !== null && (hasSkill || note.trim().length > 0) && !sending;
  const submit = async () => {
    if (!ready || recipientKey === null) return;
    setSending(true);
    setError(null);
    const result = await send({
      environmentId: props.environmentId,
      input: {
        recipientKey,
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        ...(hasSkill ? { skillPath } : {}),
      },
    });
    setSending(false);
    if (result._tag === "Success") {
      setNote("");
      setSkillPath(NO_SKILL);
      toastManager.add({ type: "success", title: t("Sent") });
    } else if (!isAtomCommandInterrupted(result)) {
      setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    }
  };
  return (
    <form
      className="space-y-2 rounded-lg border bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Select
        value={recipientKey}
        onValueChange={(value) => setRecipientKey(value)}
        items={[...people].map(([value, label]) => ({ value, label }))}
      >
        <SelectTrigger size="sm" aria-label={t("Send to")}>
          <SelectValue placeholder={t("Who do you want to write to?")} />
        </SelectTrigger>
        <SelectPopup>
          {[...people].map(([key, label]) => (
            <SelectItem key={key} value={key}>
              {label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Textarea
        aria-label={t("Message")}
        placeholder={hasSkill ? t("Why should they use it? (optional)") : t("Write a message")}
        value={note}
        maxLength={2_000}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <Select
          value={skillPath}
          onValueChange={(value) => setSkillPath(value ?? NO_SKILL)}
          items={[
            { value: NO_SKILL, label: t("No skill") },
            ...skills.map((skill) => ({ value: skill.path, label: skill.name })),
          ]}
        >
          <SelectTrigger size="sm" aria-label={t("Share a skill")} className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={NO_SKILL}>{t("No skill")}</SelectItem>
            {skills.map((skill) => (
              <SelectItem key={skill.path} value={skill.path}>
                {skill.displayName ?? skill.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button type="submit" size="sm" disabled={!ready || !canSend}>
          {sending ? t("Sending…") : hasSkill ? t("Send request") : t("Send")}
        </Button>
      </div>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** Direct messages and skill requests between colleagues, from the chat header. */
export function TeamMessagesButton(props: {
  readonly environmentId: EnvironmentId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const [open, setOpen] = useState(false);
  const [recipientKey, setRecipientKey] = useState<string | null>(null);
  const { query, messages } = useTeamMessages(props.environmentId);
  const markRead = useAtomCommand(enterpriseEnvironment.readTeamMessage, {
    label: "read team message",
    reportFailure: false,
  });
  const unread = messages.filter((message) => !message.outgoing && message.status === "unread");
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Opening the inbox reads plain messages; skill requests stay pending until answered.
    if (next)
      for (const message of unread)
        if (message.kind === "message")
          void markRead({ environmentId: props.environmentId, input: { id: message.id } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size={unread.length > 0 ? "sm" : "icon"}
              variant="ghost"
              aria-label={t("Messages")}
              className="shrink-0 [-webkit-app-region:no-drag]"
              onClick={() => onOpenChange(true)}
            />
          }
        >
          <MailIcon className="size-4" />
          {unread.length > 0 ? (
            <span className="rounded-full bg-primary px-1.5 text-2xs font-medium text-primary-foreground">
              {unread.length}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">{t("Messages")}</TooltipPopup>
      </Tooltip>
      <DialogPopup className="flex h-[min(760px,90dvh)] w-[min(640px,94vw)] max-w-none flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border/60 px-6 py-4">
          <DialogTitle>{t("Messages")}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              "Write to anyone in your company or send them a skill. Skills are only installed if they accept.",
            )}
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {open && (
            <Compose
              environmentId={props.environmentId}
              skills={props.skills}
              recipientKey={recipientKey}
              onRecipientChange={setRecipientKey}
            />
          )}
          {query.error !== null && query.data === null ? (
            <p className="text-sm text-muted-foreground">{t(query.error)}</p>
          ) : messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No messages yet.")}</p>
          ) : (
            <ul className="space-y-2">
              {messages.map((message) => (
                <MessageRow key={message.id} message={message} onReply={setRecipientKey} />
              ))}
            </ul>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function SharedSkillRow(props: {
  readonly environmentId: EnvironmentId;
  readonly message: TeamMessage;
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
            {t("Decline")}
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
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
