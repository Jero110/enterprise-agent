import type { TeamThreadSummary } from "@t3tools/contracts";
import { RefreshCwIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

import { enterpriseEnvironment } from "../state/enterprise";
import { useEnterpriseStatus } from "../state/enterprise";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { ScrollArea } from "./ui/scroll-area";

function groupByOwner(summaries: readonly TeamThreadSummary[]) {
  const groups = new Map<string, TeamThreadSummary[]>();
  for (const summary of summaries) {
    const owner = `${summary.ownerEmail}:${summary.ownerDisplayName}`;
    const threads = groups.get(owner);
    if (threads === undefined) groups.set(owner, [summary]);
    else threads.push(summary);
  }
  return groups;
}

export function TeamAgentsSection() {
  const environmentId = usePrimaryEnvironmentId();
  const { identity, isPending: enterpriseStatusPending } = useEnterpriseStatus();
  const summariesQuery = useEnvironmentQuery(
    environmentId === null ? null : enterpriseEnvironment.teamThreads({ environmentId, input: {} }),
  );
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<TeamThreadSummary | null>(null);

  if (environmentId === null || (identity === null && !enterpriseStatusPending)) {
    return null;
  }

  const summaries = summariesQuery.isSuccess ? (summariesQuery.data ?? []) : [];
  const groups = groupByOwner(summaries);
  return (
    <div className="border-b border-sidebar-border px-2 py-2">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-muted-foreground">
        <UsersIcon className="size-3.5" aria-hidden />
        <span className="flex-1">Team Agents</span>
        <Button
          aria-label="Reload team agents"
          size="icon-xs"
          variant="ghost-muted"
          onClick={() => summariesQuery.refresh()}
        >
          <RefreshCwIcon className="size-3" aria-hidden />
        </Button>
      </div>
      {summariesQuery.error !== null ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          {summariesQuery.error ?? "Team threads are unavailable."}
        </p>
      ) : summariesQuery.isPending || enterpriseStatusPending ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">Loading team threads…</p>
      ) : summaries.length === 0 ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">No team threads yet.</p>
      ) : null}
      {[...groups].map(([owner, threads]) => (
        <div key={owner} className="mt-1">
          <div className="px-2 text-2xs text-muted-foreground">{threads[0]?.ownerDisplayName}</div>
          {threads.map((summary) => (
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent disabled:cursor-default disabled:opacity-60"
              disabled={summary.publicationStatus !== "read-only"}
              key={summary.threadId}
              onClick={() => {
                if (summary.publicationStatus !== "read-only") return;
                setSelected(summary);
                setOpen(true);
              }}
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">{summary.title}</span>
              <span className="text-3xs text-muted-foreground">{summary.status}</span>
            </button>
          ))}
        </div>
      ))}
      <TeamThreadReadOnlyDialog
        environmentId={environmentId}
        open={open}
        onOpenChange={setOpen}
        summary={selected}
      />
    </div>
  );
}

function TeamThreadReadOnlyDialog(props: {
  readonly environmentId: ReturnType<typeof usePrimaryEnvironmentId>;
  readonly summary: TeamThreadSummary | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
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
        </DialogHeader>
        <DialogPanel>
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
