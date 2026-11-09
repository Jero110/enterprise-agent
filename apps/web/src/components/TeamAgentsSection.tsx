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

import { t } from "~/i18n";
import ChatMarkdown from "./ChatMarkdown";
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

  // Polls refresh every 10 s; keep the last list (a failure keeps its previous success) instead of
  // flashing "Loading" or an error while a refresh is in flight.
  // Subagent chats belong to their parent conversation; list top-level chats only.
  const summaries = (summariesQuery.data ?? []).filter(
    (summary) => summary.parentThreadId === null,
  );
  const team = rosterQuery.data?.teams.find((team) => team.id === identity?.teamId);
  const groups = groupTeamThreads(summaries, team?.members ?? [], identity?.email ?? null);
  const hasSummaries = summariesQuery.data !== null;
  const error = hasSummaries ? null : (summariesQuery.error ?? rosterQuery.error);
  const loading =
    !hasSummaries && (summariesQuery.isPending || rosterQuery.isPending || enterpriseStatusPending);
  return (
    <div className="border-t border-sidebar-border px-2 py-2">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-sidebar-muted-foreground">
        <UsersIcon className="size-3.5" aria-hidden />
        <span className="flex-1">{t("CoWork Agents")}</span>
        <Button
          aria-label={t("Reload CoWork Agents")}
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
        <p className="px-2 py-2 text-xs text-sidebar-muted-foreground">{t(error)}</p>
      ) : loading ? (
        <p className="px-2 py-2 text-xs text-sidebar-muted-foreground">
          {t("Loading team threads…")}
        </p>
      ) : groups.length === 0 ? (
        <p className="px-2 py-2 text-xs text-sidebar-muted-foreground">
          {t("No shared conversations yet.")}
        </p>
      ) : null}
      {groups.map((owner) => (
        <Collapsible key={owner.key} className="mt-1">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-sidebar-muted-foreground hover:bg-sidebar-row-hover">
            <ChevronRightIcon
              className="size-3 shrink-0 transition-transform group-data-[panel-open]:rotate-90"
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">
              {owner.displayName}
              {owner.isMe ? ` ${t("(you)")}` : ""}
            </span>
            <span>
              {owner.threads.length === 1
                ? t("1 shared")
                : t("{count} shared", { count: owner.threads.length })}
            </span>
          </CollapsibleTrigger>
          <CollapsiblePanel animate={false}>
            {owner.threads.map((summary) => (
              <button
                className="flex w-full items-center gap-2 rounded-md py-1.5 pl-7 pr-2 text-left text-sm hover:bg-sidebar-row-hover"
                key={summary.threadId}
                onClick={() => {
                  setSelected(summary);
                  setOpen(true);
                }}
                type="button"
              >
                <span className="min-w-0 flex-1 truncate">{summary.title}</span>
                <span className="text-2xs text-sidebar-muted-foreground">
                  {t(summary.status, undefined, "teamThread")}
                </span>
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
          // Keep `selected` so the dialog key stays stable and it fades out like any other close.
          setOpen(false);
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
      setContinueError(t("Could not open the continuation thread."));
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
        title: t("Could not stop sharing"),
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
  // The boss reads the agent's latest answer first; the full transcript stays one click away.
  const lastAssistantMessage =
    snapshot === null
      ? undefined
      : [...snapshot.messages].reverse().find((message) => message.role === "assistant");
  const summaryOnly = props.summary?.publicationStatus === "summary";
  const isOwn = props.ownEmail !== null && props.summary?.ownerEmail === props.ownEmail;
  const request = snapshot?.messages.find((message) => message.role === "user");
  const roleLabel = (role: "user" | "assistant" | "system") =>
    role === "user"
      ? (props.summary?.ownerDisplayName ?? t("User", undefined, "teamThread"))
      : role === "assistant"
        ? t("Assistant", undefined, "teamThread")
        : t("System", undefined, "teamThread");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{props.summary?.title ?? t("Team thread")}</DialogTitle>
          <DialogDescription>
            {isOwn
              ? t("Your conversation, shared with your team.")
              : t(
                  summaryOnly
                    ? "Summary shared by {name}. The full chat is not shared."
                    : "Read-only transcript from {name}.",
                  { name: props.summary?.ownerDisplayName ?? "" },
                )}
          </DialogDescription>
          {isOwn ? (
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={!canPublish || publishing}
                onClick={() => void stopSharing()}
              >
                {publishing ? t("Stopping sharing…") : t("Stop sharing")}
              </Button>
            </div>
          ) : null}
        </DialogHeader>
        <DialogPanel>
          {query.error !== null ? (
            <p className="text-sm text-muted-foreground">{t(query.error)}</p>
          ) : snapshot === null || query.isPending ? (
            <p className="text-sm text-muted-foreground">{t("Loading transcript…")}</p>
          ) : summaryOnly ? (
            <section className="space-y-3 rounded-lg border bg-card p-4">
              {request ? (
                <div>
                  <h3 className="mb-1 text-sm font-medium">{t("What was asked")}</h3>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {request.text}
                  </p>
                </div>
              ) : null}
              <div>
                <h3 className="mb-1 text-sm font-medium">{t("Result", undefined, "teamThread")}</h3>
                {lastAssistantMessage ? (
                  <ChatMarkdown text={lastAssistantMessage.text} cwd={undefined} />
                ) : (
                  <p className="text-sm">{t("The assistant has not replied yet.")}</p>
                )}
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-lg border bg-card p-4">
                <h3 className="mb-2 text-sm font-medium">
                  {t("Summary", undefined, "teamThread")}
                </h3>
                {lastAssistantMessage ? (
                  <ChatMarkdown text={lastAssistantMessage.text} cwd={undefined} />
                ) : (
                  <p className="text-sm">{t("The assistant has not replied yet.")}</p>
                )}
              </section>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {t("See full conversation")}
                </summary>
                <div className="mt-3 space-y-3">
                  {snapshot.messages.map((message) => (
                    <article
                      className="rounded-md border border-border/60 p-3"
                      key={`${message.createdAt}-${message.role}-${message.text.slice(0, 24)}`}
                    >
                      <div className="mb-1 text-xs font-medium text-muted-foreground">
                        {roleLabel(message.role)}
                      </div>
                      {message.role === "user" ? (
                        <p className="whitespace-pre-wrap text-sm">{message.text}</p>
                      ) : (
                        <ChatMarkdown text={message.text} cwd={undefined} />
                      )}
                    </article>
                  ))}
                </div>
              </details>
            </>
          )}
          {isOwn ? null : (
            <div className="space-y-2">
              <Button
                size="sm"
                disabled={!canContinue || snapshot === null || continuing}
                onClick={() => void continueInMyThread()}
              >
                {continuing
                  ? t("Starting…", undefined, "teamThread")
                  : t("Take to my chat to summarize")}
              </Button>
              {continueError !== null ? (
                <p role="alert" className="text-sm text-destructive">
                  {continueError}
                </p>
              ) : null}
            </div>
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
