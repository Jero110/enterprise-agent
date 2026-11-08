import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { groupTeamThreads } from "@t3tools/client-runtime/state/enterprise";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { TeamThreadSummary } from "@t3tools/contracts";
import { ChevronRightIcon, RefreshCwIcon, UsersIcon } from "lucide-react";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { useState } from "react";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { environmentServerConfigsAtom } from "../state/server";
import { enterpriseEnvironment, enterpriseFailureMessage } from "../state/enterprise";
import { buildThreadRouteParams } from "../threadRoutes";
import { useEnterpriseStatus } from "../state/enterprise";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";
import { toastManager } from "./ui/toast";

export function TeamAgentsSection() {
  const environmentId = usePrimaryEnvironmentId();
  const { identity, isPending: enterpriseStatusPending } = useEnterpriseStatus();
  const summariesQuery = useEnvironmentQuery(
    environmentId === null ? null : enterpriseEnvironment.teamThreads({ environmentId, input: {} }),
  );
  const rosterQuery = useEnvironmentQuery(
    environmentId === null ? null : enterpriseEnvironment.org({ environmentId, input: {} }),
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TeamThreadSummary | null>(null);

  if (environmentId === null || (identity === null && !enterpriseStatusPending)) {
    return null;
  }

  const summaries = summariesQuery.isSuccess ? (summariesQuery.data ?? []) : [];
  const team = rosterQuery.data?.teams.find((team) => team.id === identity?.teamId);
  const groups = groupTeamThreads(summaries, team?.members ?? [], identity?.email ?? null);
  const error = summariesQuery.error ?? rosterQuery.error;
  return (
    <div className="border-b border-sidebar-border px-2 py-2">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground">
        <UsersIcon className="size-3.5" aria-hidden />
        <span className="flex-1">CoWork Agents</span>
        <Button
          aria-label="Reload CoWork Agents"
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => {
            summariesQuery.refresh();
            rosterQuery.refresh();
          }}
        >
          <RefreshCwIcon className="size-3" aria-hidden />
        </Button>
      </div>
      {error !== null ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">{error}</p>
      ) : summariesQuery.isPending || rosterQuery.isPending || enterpriseStatusPending ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">Loading team threads…</p>
      ) : groups.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">No shared conversations yet.</p>
      ) : null}
      {groups.map((owner) => (
        <Collapsible key={owner.key} className="mt-1">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-2xs text-muted-foreground hover:bg-accent">
            <ChevronRightIcon
              className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">
              {owner.displayName}
              {owner.isMe ? " (you)" : ""}
            </span>
            <span>{owner.threads.length} shared</span>
          </CollapsibleTrigger>
          <CollapsiblePanel animate={false}>
            {owner.threads.map((summary) => (
              <button
                className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-left text-sm hover:bg-accent"
                key={summary.threadId}
                onClick={() => {
                  setSelected(summary);
                  setOpen(true);
                }}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{summary.title}</span>
                <span className="text-3xs text-muted-foreground">{summary.status}</span>
              </button>
            ))}
          </CollapsiblePanel>
        </Collapsible>
      ))}
      <TeamThreadReadOnlyDialog
        key={`${selected?.ownerEmail}:${selected?.threadId}`}
        environmentId={environmentId}
        open={open}
        onOpenChange={setOpen}
        summary={selected}
        ownEmail={identity?.email ?? null}
        onUnpublish={() => {
          setOpen(false);
          setSelected(null);
          summariesQuery.refresh();
        }}
      />
    </div>
  );
}

function TeamThreadReadOnlyDialog(props: {
  readonly environmentId: ReturnType<typeof usePrimaryEnvironmentId>;
  readonly summary: TeamThreadSummary | null;
  readonly ownEmail: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onUnpublish: () => void;
}) {
  const canPublish = useAtomValue(
    enterpriseEnvironment.publishTeamThread.permissionAtom(props.environmentId),
  );
  const publish = useAtomCommand(enterpriseEnvironment.publishTeamThread, {
    label: "stop sharing team conversation",
    reportFailure: false,
  });
  const [publishing, setPublishing] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const navigate = useNavigate();
  const canContinue = useAtomValue(
    enterpriseEnvironment.continueTeamThread.permissionAtom(props.environmentId),
  );
  const continueThread = useAtomCommand(enterpriseEnvironment.continueTeamThread, {
    reportFailure: false,
  });
  const continueInMyThread = async () => {
    if (props.environmentId === null || props.summary === null || continuing) return;
    setContinuing(true);
    setContinueError(null);
    const serverConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(props.environmentId);
    const modelSelection = resolveProjectDefaultProviderModelSelection(
      serverConfig?.providers ?? [],
      serverConfig?.settings ?? DEFAULT_SERVER_SETTINGS,
      null,
    );
    try {
      const result = await continueThread({
        environmentId: props.environmentId,
        input: {
          ownerEmail: props.summary.ownerEmail,
          threadId: props.summary.threadId,
          ...(modelSelection === null ? {} : { modelSelection }),
        },
      });
      if (result._tag === "Failure") {
        setContinueError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
      } else {
        props.onOpenChange(false);
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(props.environmentId, result.value.threadId),
          ),
        });
      }
    } catch {
      setContinueError("Could not open the continuation thread.");
    }
    setContinuing(false);
  };
  const stopSharing = async () => {
    if (props.environmentId === null || props.summary === null || !canPublish) return;
    setPublishing(true);
    const result = await publish({
      environmentId: props.environmentId,
      input: { threadId: props.summary.threadId, status: "unpublished" },
    });
    setPublishing(false);
    if (result._tag === "Success") props.onUnpublish();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: "Could not stop sharing",
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
    }
  };
  const query = useEnvironmentQuery(
    props.environmentId === null || props.summary === null || !props.open
      ? null
      : enterpriseEnvironment.teamThread({
          environmentId: props.environmentId,
          input: { ownerEmail: props.summary.ownerEmail, threadId: props.summary.threadId },
        }),
  );
  // Failed queries retain their previous success; only show the current authorized result.
  const snapshot = query.isSuccess && !query.isPending ? query.data : null;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.summary?.title ?? "Team thread"}</DialogTitle>
          <DialogDescription>
            Read-only transcript from {props.summary?.ownerDisplayName}.
          </DialogDescription>
          {props.summary?.ownerEmail === props.ownEmail && props.ownEmail !== null ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={!canPublish || publishing}
                onClick={() => void stopSharing()}
              >
                {publishing ? "Stopping sharing…" : "Stop sharing"}
              </Button>
            </div>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          <div className="mb-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Copy this published transcript as text into a new chat. It does not transfer files or
              provider session state.
            </p>
            <Button
              size="sm"
              disabled={!canContinue || snapshot === null || continuing}
              onClick={() => void continueInMyThread()}
            >
              {continuing ? "Starting…" : "Continue in my thread"}
            </Button>
            {continueError !== null ? (
              <p role="alert" className="text-sm text-destructive">
                {continueError}
              </p>
            ) : null}
          </div>
          <ScrollArea className="max-h-[60dvh]">
            {query.error !== null ? (
              <p className="p-4 text-sm text-muted-foreground">
                {query.error ?? "This transcript is no longer available."}
              </p>
            ) : snapshot === null || query.isPending ? (
              <p className="p-4 text-sm text-muted-foreground">Loading transcript…</p>
            ) : (
              <div className="space-y-3 p-1">
                {snapshot.messages.map((message) => (
                  <article
                    className="rounded-md border border-border/60 p-3"
                    key={`${message.createdAt}-${message.role}-${message.text.slice(0, 24)}`}
                  >
                    <div className="mb-1 text-xs font-medium uppercase text-muted-foreground">
                      {message.role}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                  </article>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
