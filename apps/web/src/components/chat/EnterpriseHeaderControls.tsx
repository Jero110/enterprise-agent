import { Tabs } from "@base-ui/react/tabs";
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ModelSelection,
  ServerProviderSkill,
  ThreadId,
  ThreadKnowledgeScope,
} from "@t3tools/contracts";
import { BrainCircuitIcon, UsersRoundIcon, UsersIcon } from "lucide-react";
import { memo, useState, type ComponentType, type ReactNode } from "react";

import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { t } from "~/i18n";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { OrganizationView } from "../enterprise/OrganizationView";
import {
  ConnectedIngestTab,
  ConnectedSharingTab,
} from "../enterprise/EnterpriseContextIntegrations";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import { KnowledgeMap } from "../enterprise/KnowledgeMap";
import { ContextChanges } from "../enterprise/ContextChanges";
import { useDemoState } from "../enterprise/noraiDemo";
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
  const [busy, setBusy] = useState(false);
  const toggle = async (scope: ThreadKnowledgeScope, enabled: boolean, areaId?: string) => {
    setBusy(true);
    const result = await setContext({
      environmentId: props.environmentId,
      input: {
        threadId: props.threadId,
        scope,
        enabled,
        ...(areaId === undefined ? {} : { areaId }),
      },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: t("Could not change this conversation's knowledge"),
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
        canToggle={canToggle && !busy}
        onToggle={(scope, enabled, areaId) => void toggle(scope, enabled, areaId)}
      />
    </div>
  );
}

function EnterpriseContextDialog(props: {
  readonly modelSelection: ModelSelection;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("context");
  const { identity } = useEnterpriseStatus();
  // Proposals this user can approve; the header shows a labeled pill and opens on that tab.
  const inbox = useEnvironmentQuery(
    enterpriseEnvironment.proposalInbox({
      environmentId: props.environmentId,
      input: { countOnly: true },
    }),
  );
  const demo = useDemoState(props.environmentId);
  const demoPending = demo.active
    ? demo.state.proposals.filter((proposal) => proposal.status === "pending").length
    : 0;
  const pendingCount = (inbox.error ? 0 : (inbox.data?.pendingCount ?? 0)) + demoPending;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size={pendingCount > 0 ? "sm" : "icon"}
              variant="ghost"
              aria-label={t("Conversation context and changes")}
              aria-haspopup="dialog"
              aria-expanded={open}
              data-pressed={open ? "" : undefined}
              className="shrink-0 [-webkit-app-region:no-drag]"
              onClick={() => {
                setTab(pendingCount > 0 ? "changes" : "context");
                setOpen(true);
              }}
            />
          }
        >
          <BrainCircuitIcon className="size-4" />
          {pendingCount > 0 ? (
            <span className="whitespace-nowrap rounded-full bg-primary px-1.5 text-2xs font-medium text-primary-foreground">
              {t("To approve · {count}", { count: pendingCount })}
            </span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">{t("Conversation context and changes")}</TooltipPopup>
      </Tooltip>
      <DialogPopup
        className="flex h-[min(840px,90dvh)] w-[min(1050px,94vw)] max-w-none flex-col overflow-hidden"
        bottomStickOnMobile={false}
      >
        <div className="shrink-0 border-b border-border/60 px-8 py-5">
          <DialogTitle>{t("Conversation context")}</DialogTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Knowledge for this conversation, pending proposals and review history.")}
          </p>
        </div>
        <Tabs.Root
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="flex min-h-0 flex-1 flex-col"
        >
          <Tabs.List
            aria-label={t("Conversation knowledge")}
            className="flex shrink-0 gap-2 px-8 py-3"
          >
            <Tabs.Tab
              value="context"
              render={<Button size="sm" variant={tab === "context" ? "secondary" : "ghost"} />}
            >
              {t("Twin")}
            </Tabs.Tab>
            <Tabs.Tab
              value="changes"
              render={<Button size="sm" variant={tab === "changes" ? "secondary" : "ghost"} />}
            >
              {pendingCount > 0
                ? t("To approve ({count})", { count: pendingCount })
                : t("Changes", undefined, "knowledge")}
            </Tabs.Tab>
            {identity && (
              <Tabs.Tab
                value="ingest"
                render={<Button size="sm" variant={tab === "ingest" ? "secondary" : "ghost"} />}
              >
                {t("Ingest")}
              </Tabs.Tab>
            )}
            <Tabs.Tab
              value="sharing"
              render={<Button size="sm" variant={tab === "sharing" ? "secondary" : "ghost"} />}
            >
              {t("Sharing")}
            </Tabs.Tab>
          </Tabs.List>
          <Tabs.Panel value="context" className="flex min-h-0 flex-1 flex-col">
            {open && <ContextPanel {...props} />}
          </Tabs.Panel>
          <Tabs.Panel value="changes" className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {open && <ContextChanges environmentId={props.environmentId} />}
          </Tabs.Panel>
          {identity && (
            <Tabs.Panel value="ingest" className="flex min-h-0 flex-1 flex-col">
              {open && (
                <ConnectedIngestTab
                  environmentId={props.environmentId}
                  modelSelection={props.modelSelection}
                  onReview={() => setTab("changes")}
                  onOpenMap={() => setTab("context")}
                />
              )}
            </Tabs.Panel>
          )}
          <Tabs.Panel value="sharing" className="flex min-h-0 flex-1 flex-col">
            {open && <ConnectedSharingTab environmentId={props.environmentId} />}
          </Tabs.Panel>
        </Tabs.Root>
      </DialogPopup>
    </Dialog>
  );
}

export function EnterpriseShareControl({
  environmentId,
  threadId,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const { environmentId: queryEnvironmentId, identity } = useEnterpriseStatus();
  if (queryEnvironmentId === null || identity === null) return null;
  return (
    <HeaderPopover icon={UsersIcon} label={t("Share with team")}>
      <SharePanel
        environmentId={environmentId}
        queryEnvironmentId={queryEnvironmentId}
        threadId={threadId}
        ownerEmail={identity.email}
      />
    </HeaderPopover>
  );
}

function SharePanel(props: {
  readonly environmentId: EnvironmentId;
  readonly queryEnvironmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly ownerEmail: string;
}) {
  const threads = useEnvironmentQuery(
    enterpriseEnvironment.teamThreads({ environmentId: props.queryEnvironmentId, input: {} }),
  );
  const canPublish = useAtomValue(
    enterpriseEnvironment.publishTeamThread.permissionAtom(props.environmentId),
  );
  const publish = useAtomCommand(enterpriseEnvironment.publishTeamThread, {
    label: "share conversation with team",
    reportFailure: false,
  });
  const summary = threads.data?.find(
    (thread) =>
      thread.threadId === props.threadId &&
      thread.parentThreadId === null &&
      thread.ownerEmail === props.ownerEmail,
  );
  const change = async (status: "unpublished" | "read-only") => {
    const result = await publish({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, status },
    });
    if (result._tag === "Success") threads.refresh();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: t("Could not update sharing"),
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
    }
  };
  return (
    <div className="w-full space-y-3 bg-popover p-3">
      <h2 className="text-sm font-medium">{t("Share with your team")}</h2>
      <RadioGroup
        aria-label={t("Team sharing")}
        disabled={!canPublish}
        value={summary?.publicationStatus ?? "unpublished"}
        onValueChange={(value) => void change(value as "unpublished" | "read-only")}
      >
        <label className="flex items-start gap-2 text-sm">
          <Radio value="unpublished" />
          <span>
            {t("Not shared")}
            <span className="block text-xs text-muted-foreground">
              {t("Only you can see this conversation.")}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <Radio value="read-only" />
          <span>
            {t("Team readable")}
            <span className="block text-xs text-muted-foreground">
              {t("Your team can read this conversation and its subagents. Stop sharing any time.")}
            </span>
          </span>
        </label>
      </RadioGroup>
    </div>
  );
}

/** Org chart, conversation context and team sharing: only for an IDE linked to an enterprise hub. */
export const EnterpriseHeaderControls = memo(function EnterpriseHeaderControls(props: {
  readonly modelSelection: ModelSelection;
  readonly threadId: ThreadId;
  readonly skills: ReadonlyArray<ServerProviderSkill>;
}) {
  const { environmentId, identity } = useEnterpriseStatus();
  if (environmentId === null || identity === null) return null;
  return (
    <>
      <HeaderPopover icon={UsersRoundIcon} label={t("Organization")}>
        <OrganizationView environmentId={environmentId} />
      </HeaderPopover>
      <EnterpriseContextDialog
        key={`${environmentId}:${props.threadId}`}
        environmentId={environmentId}
        threadId={props.threadId}
        skills={props.skills}
        modelSelection={props.modelSelection}
      />
    </>
  );
});
