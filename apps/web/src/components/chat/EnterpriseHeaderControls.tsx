import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { dedupeProviderSkillsByName } from "@t3tools/client-runtime/providerSkills";
import type {
  EnterpriseOrgTeam,
  EnvironmentId,
  ServerProviderSkill,
  ThreadContextCard,
  ThreadId,
  ThreadKnowledgeScope,
} from "@t3tools/contracts";
import {
  BookOpenIcon,
  GlobeIcon,
  LayersIcon,
  NetworkIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
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
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
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

const CARD_COPY = {
  general: { title: "General vault", hint: "Shared with everyone", icon: GlobeIcon },
  area: { title: "Area vault", hint: "Your team and approved areas", icon: LayersIcon },
} as const;

function ContextCard(props: {
  readonly card: ThreadContextCard;
  readonly canToggle: boolean;
  readonly onToggle: (scope: ThreadKnowledgeScope, enabled: boolean) => void;
}) {
  const { card } = props;
  const copy = CARD_COPY[card.scope];
  const Icon = copy.icon;
  const loaded = card.documents.filter((document) => document.loaded);
  return (
    <section className="rounded-lg border border-border/60 p-3" data-scope={card.scope}>
      <div className="flex items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">
            {card.enabled
              ? `${copy.hint} · ${loaded.length} of ${card.documents.length} loaded`
              : "Off for this conversation"}
          </p>
        </div>
        <Switch
          aria-label={`${copy.title} for this conversation`}
          checked={card.enabled}
          disabled={!props.canToggle}
          onCheckedChange={(checked) => props.onToggle(card.scope, checked)}
        />
      </div>
      {card.enabled && loaded.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nothing loaded yet.</p>
      ) : null}
      <ul className={cn("mt-2 space-y-1", !card.enabled && "opacity-50")}>
        {card.documents.map((document) => (
          <li className="flex items-center gap-2 text-xs" key={document.path}>
            <span className="min-w-0 flex-1 truncate">{document.title}</span>
            <Badge variant={document.loaded && card.enabled ? "success" : "outline"}>
              {document.loaded && card.enabled ? "loaded" : "available"}
            </Badge>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The person's own skills and the tools wired to this IDE; read-only, nothing here is hub knowledge. */
function IndividualCard({ skills }: { readonly skills: ReadonlyArray<ServerProviderSkill> }) {
  const enabled = dedupeProviderSkillsByName(skills.filter((skill) => skill.enabled));
  if (enabled.length === 0) return null;
  return (
    <section className="rounded-lg border border-border/60 p-3" data-scope="individual">
      <div className="flex items-center gap-2">
        <UserIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">Individual</h3>
          <p className="text-xs text-muted-foreground">Your skills and connected tools</p>
        </div>
      </div>
      <ul className="mt-2 space-y-1">
        <li className="flex items-center gap-2 text-xs">
          <span className="min-w-0 flex-1 truncate">Enterprise hub knowledge tools</span>
          <Badge variant="success">connected</Badge>
        </li>
        {enabled.map((skill) => (
          <li className="flex items-center gap-2 text-xs" key={skill.name}>
            <span className="min-w-0 flex-1 truncate">{skill.displayName ?? skill.name}</span>
            <Badge variant="outline">skill</Badge>
          </li>
        ))}
      </ul>
    </section>
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
    <div className="max-h-[70dvh] w-full space-y-2 overflow-y-auto bg-popover p-3">
      <h2 className="text-sm font-medium">Context</h2>
      <p className="text-xs text-muted-foreground">
        What enterprise knowledge this conversation can use. Agents look documents up on demand.
      </p>
      {context.error ? (
        <p className="text-xs text-muted-foreground">{context.error}</p>
      ) : cards.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {context.isPending ? "Loading context…" : "No knowledge available."}
        </p>
      ) : (
        cards.map((card) => (
          <ContextCard
            canToggle={canToggle}
            card={card}
            key={card.scope}
            onToggle={(scope, enabled) => void toggle(scope, enabled)}
          />
        ))
      )}
      <IndividualCard skills={props.skills} />
    </div>
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
      <HeaderPopover icon={NetworkIcon} label="Organization">
        <OrgPanel environmentId={environmentId} />
      </HeaderPopover>
      {props.isServerThread ? (
        <>
          <HeaderPopover icon={BookOpenIcon} label="Conversation context">
            <ContextPanel
              environmentId={environmentId}
              threadId={props.threadId}
              skills={props.skills}
            />
          </HeaderPopover>
          <HeaderPopover icon={UsersIcon} label="Share with team">
            <SharePanel environmentId={environmentId} threadId={props.threadId} />
          </HeaderPopover>
        </>
      ) : null}
    </>
  );
});
