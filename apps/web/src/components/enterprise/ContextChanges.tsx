import type { EnvironmentId, KnowledgeProposal } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  enterpriseEnvironment,
  enterpriseFiles,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { getLocale, t } from "~/i18n";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { pendingGraphNodes, personName, proposalAreaName, proposalTitle } from "./proposalGraph";
import { decideDemoProposal, demoKnowledgeProposals, useDemoState } from "./noraiDemo";

const STATUS_LABELS: Record<KnowledgeProposal["status"], string> = {
  pending: "Pending",
  applied: "Applied",
  rejected: "Rejected",
  reverted: "Reverted",
  "approved-awaiting-processing": "Received",
};

function formatResolvedAt(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(getLocale() === "es" ? "es-MX" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

function statusLabel(status: KnowledgeProposal["status"]): string {
  return t(STATUS_LABELS[status], undefined, "proposal");
}

function formatTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString(getLocale() === "es" ? "es-MX" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
}

function isToday(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
}

function CurrentDocument({ environmentId, path }: { environmentId: EnvironmentId; path: string }) {
  const document = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGet({ environmentId, input: { path } }),
  );
  return (
    <div className="space-y-1">
      <p>{t("Current content")}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
        {document.error ?? document.data?.content ?? t("Loading…")}
      </pre>
    </div>
  );
}

function ProposalDetails({
  proposal,
  environmentId,
  refresh,
}: {
  proposal: KnowledgeProposal;
  environmentId: EnvironmentId;
  refresh: () => void;
}) {
  const permission = useAtomValue(
    enterpriseEnvironment.proposalDecide.permissionAtom(environmentId),
  );
  const { identity } = useEnterpriseStatus();
  // Access requests are shown in plain words: who asks for which area, by its team name.
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const teams = org.data?.teams ?? [];
  const areaName = proposalAreaName(proposal, teams);
  const isAccessRequest = proposal.kind === "area-access";
  const decide = useAtomCommand(enterpriseEnvironment.proposalDecide, {
    label: "resolve proposal",
    reportFailure: false,
  });
  const download = useAtomCommand(enterpriseFiles.download, {
    label: "download proposal file",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const isDemo = proposal.id.startsWith("demo-");
  const resolve = async (action: "approve" | "reject" | "revert") => {
    if (isDemo) {
      if (action !== "revert")
        decideDemoProposal(environmentId, proposal.id, action, reason.trim());
      toastManager.add({
        type: "success",
        title:
          action === "approve"
            ? t("Saved to {area} knowledge", { area: areaName })
            : t("Proposal rejected"),
      });
      return;
    }
    setBusy(true);
    const result = await decide({
      environmentId,
      input: { id: proposal.id, action, ...(action === "reject" ? { reason: reason.trim() } : {}) },
    });
    setBusy(false);
    if (result._tag === "Success") {
      refresh();
      toastManager.add({
        type: "success",
        title:
          action === "approve"
            ? isAccessRequest
              ? t("{who} can now see {area}", {
                  who: personName(proposal.proposedBy),
                  area: areaName,
                })
              : t("Saved to {area} knowledge", { area: areaName })
            : action === "reject"
              ? t("Proposal rejected")
              : t("Change undone"),
      });
    } else if (!isAtomCommandInterrupted(result))
      toastManager.add({
        type: "error",
        title: t("Could not resolve proposal"),
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
  };
  const save = async (file: NonNullable<KnowledgeProposal["files"]>[number], preview = false) => {
    const tab = preview && file.mimeType === "application/pdf" ? window.open("", "_blank") : null;
    if (tab) tab.opener = null;
    const result = await download({
      environmentId,
      input: { proposalId: proposal.id, fileId: file.id },
    });
    if (result._tag === "Failure") {
      tab?.close();
      toastManager.add({
        type: "error",
        title: t("Could not download file"),
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
      return;
    }
    const blob = new Blob([result.value], {
      type: file.mimeType === "application/pdf" ? "application/pdf" : "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    if (tab) {
      tab.location.href = url;
    } else {
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <section
      aria-label={t("Proposal {id}", { id: proposal.id })}
      className="space-y-3 rounded-lg border p-4 text-sm"
    >
      <h3 className="font-medium">
        {isAccessRequest
          ? t("{who} asks for access to {area}", {
              who: personName(proposal.proposedBy),
              area: areaName,
            })
          : proposalTitle(proposal, teams)}
      </h3>
      <p>
        {proposal.scope === "global"
          ? t("Company")
          : proposal.scope === "personal"
            ? t("Personal · {who}", { who: personName(proposal.recipient ?? proposal.proposedBy) })
            : t("Area · {area}", { area: areaName })}
      </p>
      <p>
        {t("Authored by {who}", { who: personName(proposal.proposedBy) })} ·{" "}
        {statusLabel(proposal.status)}
      </p>
      {!isAccessRequest && (
        <p>
          {t("Reviewers:")}{" "}
          {proposal.reviewers
            ?.map(
              (reviewer) =>
                `${personName(reviewer.email)} (${t(reviewer.role, undefined, "role")})`,
            )
            .join(", ") || t("Not assigned")}
        </p>
      )}
      <p>{isAccessRequest ? t(proposal.reason) : proposal.reason}</p>
      {!isAccessRequest && proposal.evidence.length > 0 && (
        <p>
          {t("Evidence:")} {proposal.evidence.join(", ")}
        </p>
      )}
      {proposal.path &&
        proposal.kind !== "upload" &&
        proposal.kind !== "create" &&
        proposal.kind !== "area-access" && (
          <CurrentDocument environmentId={environmentId} path={proposal.path} />
        )}
      {proposal.content && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2">
          {proposal.content}
        </pre>
      )}
      {proposal.files?.map((file) => (
        <div key={file.id} className="flex gap-2">
          <Button size="xs" variant="outline" onClick={() => void save(file)}>
            {t("Download {name} ({size} KiB)", {
              name: file.name,
              size: Math.ceil(file.sizeBytes / 1024),
            })}
          </Button>
          {file.mimeType === "application/pdf" && (
            <Button size="xs" variant="outline" onClick={() => void save(file, true)}>
              {t("Preview PDF")}
            </Button>
          )}
        </div>
      ))}
      {proposal.rejectionReason && (
        <p>
          {t("Rejected:")} {proposal.rejectionReason}
        </p>
      )}
      {proposal.resolvedBy && (
        <p>
          {t("Resolved by {who}", { who: personName(proposal.resolvedBy) })} ·{" "}
          {formatResolvedAt(proposal.resolvedAt)}
        </p>
      )}
      {proposal.status === "applied" &&
        permission &&
        proposal.reviewers?.some((reviewer) => reviewer.email === identity?.email) && (
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy}
            onClick={() => void resolve("revert")}
          >
            {t("Revert")}
          </Button>
        )}
      {proposal.status === "pending" && proposal.canDecide === true && (permission || isDemo) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" disabled={busy} onClick={() => void resolve("approve")}>
            {t("Approve")}
          </Button>
          <Input
            nativeInput
            aria-label={t("Rejection reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={t("Reason for rejection")}
            disabled={busy}
          />
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy || !reason.trim()}
            onClick={() => void resolve("reject")}
          >
            {t("Reject")}
          </Button>
        </div>
      )}
    </section>
  );
}

function ProposalList({
  title,
  proposals,
  teams,
  selected,
  onSelect,
}: {
  readonly title: string;
  readonly proposals: ReadonlyArray<KnowledgeProposal>;
  readonly teams: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly selected: string | null;
  readonly onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} ({proposals.length})
      </h3>
      {proposals.map((proposal) => (
        <button
          key={proposal.id}
          type="button"
          className="block w-full rounded border p-2 text-left text-sm"
          aria-pressed={selected === proposal.id}
          onClick={() => onSelect(proposal.id)}
        >
          {proposalTitle(proposal, teams)} · {statusLabel(proposal.status)} ·{" "}
          {personName(proposal.proposedBy)}
        </button>
      ))}
    </div>
  );
}

export function ContextChanges({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { identity } = useEnterpriseStatus();
  const inbox = useEnvironmentQuery(
    enterpriseEnvironment.proposalInbox({ environmentId, input: {} }),
  );
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const [selected, setSelected] = useState<string | null>(null);
  const demo = useDemoState(environmentId);
  const demoProposals = demo.active ? demoKnowledgeProposals(demo.state) : [];
  const proposals = [...demoProposals, ...(inbox.data?.proposals ?? [])];
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selected) ?? pending[0];
  const teams = org.data?.teams ?? [];
  const graphNodes = pendingGraphNodes(proposals, teams);
  // What the hub applied today, newest first: visible proof that the team's knowledge grew.
  const learnedToday = proposals
    .filter(
      (proposal) =>
        proposal.status === "applied" && proposal.kind !== "upload" && isToday(proposal.resolvedAt),
    )
    .toSorted((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));
  const graphGroups = [
    ...new Map(graphNodes.map((node) => [node.groupId, node.groupLabel])).entries(),
  ];
  const selectProposal = (id: string) => {
    setSelected(id);
  };
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <div className="flex justify-end">
        <Button size="xs" variant="outline" onClick={inbox.refresh}>
          {t("Refresh")}
        </Button>
      </div>
      {learnedToday.length > 0 && (
        <section
          aria-label={t("What the team learned today")}
          className="space-y-3 rounded-xl border bg-background p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium">{t("What the team learned today")}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
              {t("+{n} today", { n: learnedToday.length })}
            </span>
          </div>
          <ul className="space-y-1">
            {learnedToday.map((proposal) => (
              <li key={proposal.id}>
                <button
                  type="button"
                  aria-pressed={selected === proposal.id}
                  className="flex w-full items-start gap-3 rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => selectProposal(proposal.id)}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {proposal.kind === "area-access"
                        ? t("Access to {area} granted to {who}", {
                            area: proposalAreaName(proposal, teams),
                            who: personName(proposal.proposedBy),
                          })
                        : proposalTitle(proposal, teams)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("proposed by {proposer} · approved by {approver} · {time}", {
                        proposer: personName(proposal.proposedBy),
                        approver: personName(proposal.resolvedBy),
                        time: formatTime(proposal.resolvedAt),
                      })}
                    </span>
                    {proposal.evidence[0] && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {proposal.evidence[0]}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        aria-label={t("Pending context changes")}
        className="overflow-hidden rounded-xl border bg-background"
      >
        <div>
          <aside aria-label={t("Pending proposals by scope")} className="space-y-3 p-4">
            {graphGroups.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {inbox.data || demo.active ? t("No pending changes") : t("Loading proposals…")}
              </p>
            )}
            {graphGroups.map(([groupId, groupLabel]) => (
              <div key={groupId} className="space-y-1">
                <h3 className="text-xs font-medium">{groupLabel}</h3>
                {graphNodes
                  .filter((node) => node.groupId === groupId)
                  .map((node) => (
                    <button
                      key={node.id}
                      type="button"
                      aria-pressed={selectedProposal?.id === node.proposalId}
                      className="block w-full rounded border px-2 py-1 text-left text-xs hover:bg-muted"
                      onClick={() => selectProposal(node.proposalId)}
                    >
                      {node.title}
                    </button>
                  ))}
              </div>
            ))}
          </aside>
        </div>
      </section>
      {selectedProposal && (
        <ProposalDetails
          key={selectedProposal.id}
          proposal={selectedProposal}
          environmentId={environmentId}
          refresh={inbox.refresh}
        />
      )}
      <section aria-label={t("Context changes history")} className="space-y-2">
        <h2 className="font-medium">{t("Authored, assigned and history")}</h2>
        {inbox.error && !demo.active ? (
          <p role="alert">{inbox.error}</p>
        ) : !inbox.data && proposals.length === 0 ? (
          <p role="status">{t("Loading proposals…")}</p>
        ) : proposals.length === 0 ? (
          <p>{t("No proposals yet.")}</p>
        ) : (
          <div className="space-y-4">
            <ProposalList
              title={t("Assigned to you")}
              proposals={pending.filter((proposal) =>
                proposal.reviewers?.some((reviewer) => reviewer.email === identity?.email),
              )}
              teams={teams}
              selected={selected}
              onSelect={selectProposal}
            />
            <ProposalList
              title={t("Authored by you")}
              proposals={pending.filter((proposal) => proposal.proposedBy === identity?.email)}
              teams={teams}
              selected={selected}
              onSelect={selectProposal}
            />
            <ProposalList
              title={t("History")}
              proposals={proposals.filter((proposal) => proposal.status !== "pending")}
              teams={teams}
              selected={selected}
              onSelect={selectProposal}
            />
          </div>
        )}
      </section>
    </div>
  );
}
