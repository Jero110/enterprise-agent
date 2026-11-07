import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnterpriseOrgTeam,
  EnvironmentId,
  ServerProviderSkill,
  ThreadId,
  ThreadKnowledgeScope,
} from "@t3tools/contracts";
import { BookOpenIcon, FileClockIcon, UserRoundIcon, UsersIcon } from "lucide-react";
import { memo, type ComponentType, type ReactNode } from "react";

import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { KnowledgeMap } from "../enterprise/KnowledgeMap";
import { ContextChanges } from "../enterprise/ContextChanges";
import { useState } from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Radio, RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function HeaderPopover(props: {
  readonly label: string;
  readonly icon: ComponentType<{ className?: string }>;
  readonly children: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<span className="flex shrink-0" />}>
          <PopoverTrigger
            render={
              <Toggle
                className="shrink-0 [-webkit-app-region:no-drag]"
                aria-label={props.label}
                variant="ghost"
                size="sm"
              />
            }
          >
            <Icon className="size-4" />
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipPopup side="bottom">{props.label}</TooltipPopup>
      </Tooltip>
      <PopoverPopup align="end" padding="none" width="md">
        {props.children}
      </PopoverPopup>
    </Popover>
  );
}

const ACCESS_LABEL = { member: "Your team", granted: "Access granted", none: null } as const;

function OrgTeam({ team }: { readonly team: EnterpriseOrgTeam }) {
  const label = ACCESS_LABEL[team.access];
  return (
    <section
      className={cn(
        "rounded-lg border p-3",
        team.access === "none" ? "border-border/60" : "border-primary/50 bg-primary/5",
      )}
      data-access={team.access}
    >
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</h3>
        {label ? <Badge variant="info">{label}</Badge> : null}
      </div>
      <ul className="mt-2 space-y-1">
        {team.members.map((member) => (
          <li
            className={cn(
              "flex items-center gap-2 text-xs",
              member.isMe ? "font-medium text-foreground" : "text-muted-foreground",
            )}
            key={`${member.displayName}:${member.role}`}
          >
            <span className="min-w-0 flex-1 truncate">
              {member.displayName}
              {member.isMe ? " (you)" : ""}
            </span>
            <span>{member.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function OrgPanel({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const teams = org.data?.teams ?? [];
  return (
    <div className="max-h-[70dvh] w-full space-y-2 overflow-y-auto bg-popover p-3">
      <h2 className="text-sm font-medium">Organization</h2>
      {org.error ? (
        <p className="text-xs text-muted-foreground">{org.error}</p>
      ) : teams.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {org.isPending ? "Loading organization…" : "No teams yet."}
        </p>
      ) : (
        teams.map((team) => <OrgTeam key={team.id} team={team} />)
      )}
    </div>
  );
}

function ContextPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const input = { threadId: props.threadId };
  const context = useEnvironmentQuery(
    enterpriseEnvironment.threadContext({ environmentId: props.environmentId, input }),
  );
  const canToggle = useAtomValue(
    enterpriseEnvironment.setThreadContext.permissionAtom(props.environmentId),
  );
  const setContext = useAtomCommand(enterpriseEnvironment.setThreadContext, {
    label: "set conversation knowledge",
    reportFailure: false,
  });
  const toggle = async (scope: ThreadKnowledgeScope, enabled: boolean) => {
    const result = await setContext({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, scope, enabled },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not change this conversation's knowledge",
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
    }
  };
  const cards = context.data?.cards ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <KnowledgeMap
        cards={cards}
        environmentId={props.environmentId}
        skills={props.skills}
        canToggle={canToggle}
        onToggle={(scope, enabled) => void toggle(scope, enabled)}
      />
    </div>
  );
}

function EnterpriseChangesDialog({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Context changes"
              className="[-webkit-app-region:no-drag]"
              onClick={() => setOpen(true)}
            />
          }
        >
          <FileClockIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Context changes</TooltipPopup>
      </Tooltip>
      <DialogPopup
        className="flex h-[min(840px,90dvh)] w-[min(1050px,94vw)] max-w-none flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <div className="shrink-0 border-b border-border/60 px-8 py-5">
          <DialogTitle>Context changes</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Pending proposals, file ingest and review history.
          </p>
        </div>
        {open && <ContextChanges environmentId={environmentId} />}
      </DialogPopup>
    </Dialog>
  );
}

function EnterpriseContextDialog(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Conversation context"
              className="[-webkit-app-region:no-drag]"
              onClick={() => setOpen(true)}
            />
          }
        >
          <BookOpenIcon className="size-4" />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Conversation context</TooltipPopup>
      </Tooltip>
      <DialogPopup
        className="flex h-[min(840px,90dvh)] w-[min(1050px,94vw)] max-w-none flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <div className="shrink-0 border-b border-border/60 px-8 py-5">
          <DialogTitle>Current context</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose which knowledge this conversation can use.
          </p>
        </div>
        {open && <ContextPanel {...props} />}
      </DialogPopup>
    </Dialog>
  );
}

export function EnterpriseShareControl({ threadId }: { readonly threadId: ThreadId }) {
  const { environmentId, identity } = useEnterpriseStatus();
  if (environmentId === null || identity === null) return null;
  return (
    <HeaderPopover icon={UsersIcon} label="Share with team">
      <SharePanel environmentId={environmentId} threadId={threadId} />
    </HeaderPopover>
  );
}

function SharePanel(props: { readonly environmentId: EnvironmentId; readonly threadId: ThreadId }) {
  const threads = useEnvironmentQuery(
    enterpriseEnvironment.teamThreads({ environmentId: props.environmentId, input: {} }),
  );
  const canPublish = useAtomValue(
    enterpriseEnvironment.publishTeamThread.permissionAtom(props.environmentId),
  );
  const publish = useAtomCommand(enterpriseEnvironment.publishTeamThread, {
    label: "share conversation with team",
    reportFailure: false,
  });
  const summary = threads.data?.find(
    (thread) => thread.threadId === props.threadId && thread.parentThreadId === null,
  );
  const change = async (status: "unpublished" | "read-only") => {
    const result = await publish({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, status },
    });
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not update sharing",
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
    }
  };
  return (
    <div className="w-full space-y-3 bg-popover p-3">
      <h2 className="text-sm font-medium">Share with your team</h2>
      <RadioGroup
        aria-label="Team sharing"
        disabled={!canPublish || summary === undefined}
        value={summary?.publicationStatus ?? "unpublished"}
        onValueChange={(value) => void change(value as "unpublished" | "read-only")}
      >
        <label className="flex items-start gap-2 text-sm">
          <Radio value="unpublished" />
          <span>
            Not shared
            <span className="block text-xs text-muted-foreground">
              Teammates see only the title, owner and status.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Radio value="read-only" />
          <span>
            Read-only
            <span className="block text-xs text-muted-foreground">
              Your team can read this conversation and its subagents. Stop sharing any time.
            </span>
          </span>
        </label>
      </RadioGroup>
      <div
        className="flex items-start gap-2 border-t border-border/60 pt-3 text-sm opacity-50"
        aria-disabled="true"
      >
        <span className="mt-1 size-4 shrink-0 rounded-full border border-current" />
        <span>
          All access
          <span className="block text-xs text-muted-foreground">
            Team collaboration · preview only, not available yet.
          </span>
        </span>
      </div>
      {summary === undefined ? (
        <p className="text-xs text-muted-foreground">
          {threads.isPending ? "Checking with the hub…" : "The hub has not seen this thread yet."}
        </p>
      ) : null}
    </div>
  );
}

/** Org chart, conversation context and team sharing: only for an IDE linked to an enterprise hub. */
export const EnterpriseHeaderControls = memo(function EnterpriseHeaderControls(props: {
  readonly threadId: ThreadId;
  readonly isServerThread: boolean;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const { environmentId, identity } = useEnterpriseStatus();
  if (environmentId === null || identity === null) return null;
  return (
    <>
      <HeaderPopover icon={UserRoundIcon} label="Organization">
        <OrgPanel environmentId={environmentId} />
      </HeaderPopover>
      <EnterpriseChangesDialog environmentId={environmentId} />
      {props.isServerThread ? (
        <>
          <EnterpriseContextDialog
            environmentId={environmentId}
            threadId={props.threadId}
            skills={props.skills}
          />
        </>
      ) : null}
    </>
  );
});
