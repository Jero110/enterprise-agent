import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  KnowledgeProposal,
  KnowledgeProposalDecision,
} from "@t3tools/contracts";
import { useState } from "react";
import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";

export function ApprovalCount() {
  const { environmentId, identity } = useEnterpriseStatus();
  const inbox = useEnvironmentQuery(
    identity && identity.role !== "member" && environmentId !== null
      ? enterpriseEnvironment.proposalInbox({ environmentId, input: { countOnly: true } })
      : null,
  );
  const count = inbox.error ? 0 : (inbox.data?.pendingCount ?? 0);
  return count > 0 ? <span aria-label={`${count} pending approvals`}>({count})</span> : null;
}

export function ApprovalsInbox({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const inbox = useEnvironmentQuery(
    enterpriseEnvironment.proposalInbox({ environmentId, input: {} }),
  );
  return (
    <SettingsSection
      title="Approvals inbox"
      headerAction={
        <Button size="xs" variant="outline" onClick={inbox.refresh}>
          Refresh
        </Button>
      }
    >
      {inbox.error ? (
        <SettingsRow title="Could not load proposals" description={inbox.error} />
      ) : !inbox.data ? (
        <SettingsRow title="Loading proposals…" role="status" />
      ) : inbox.data.proposals.length === 0 ? (
        <SettingsRow
          title="No proposals you can act on"
          description="Leads approve their own area. Admins approve global changes, moves between areas and access requests."
        />
      ) : (
        inbox.data.proposals.map((proposal) => (
          <ProposalRow key={proposal.id} environmentId={environmentId} proposal={proposal} />
        ))
      )}
    </SettingsSection>
  );
}

function CurrentDocument({
  environmentId,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly path: string;
}) {
  const document = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGet({ environmentId, input: { path } }),
  );
  return (
    <div>
      <p>Current content</p>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
        {document.error ?? document.data?.content ?? "Loading…"}
      </pre>
    </div>
  );
}

function ProposalRow({
  environmentId,
  proposal,
}: {
  readonly environmentId: EnvironmentId;
  readonly proposal: KnowledgeProposal;
}) {
  const canDecide = useAtomValue(
    enterpriseEnvironment.proposalDecide.permissionAtom(environmentId),
  );
  const decide = useAtomCommand(enterpriseEnvironment.proposalDecide, {
    label: "resolve knowledge proposal",
    reportFailure: false,
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const run = async (action: KnowledgeProposalDecision["action"]) => {
    if (busy) return;
    setBusy(true);
    const result = await decide({
      environmentId,
      input: { id: proposal.id, action, ...(action === "reject" ? { reason: reason.trim() } : {}) },
    });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result))
      toastManager.add({
        type: "error",
        title: "Could not resolve proposal",
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
  };
  return (
    <SettingsRow
      title={`${proposal.kind} · ${proposal.path || proposal.scope}`}
      description={`${proposal.proposedBy} · ${proposal.status}${proposal.targetScope ? ` → ${proposal.targetScope}` : ""}`}
      control={
        <Button size="xs" variant="outline" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide" : "Review"}
        </Button>
      }
    >
      {expanded ? (
        <div className="mt-3 space-y-3 text-sm">
          <p>{proposal.reason}</p>
          <p className="text-xs text-muted-foreground">
            Evidence: {proposal.evidence.join(", ") || "None supplied"}
          </p>
          {proposal.kind !== "area-access" && proposal.kind !== "create" ? (
            <CurrentDocument environmentId={environmentId} path={proposal.path} />
          ) : null}
          {proposal.content !== undefined &&
          (proposal.kind === "create" || proposal.kind === "update") ? (
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">
              {proposal.content}
            </pre>
          ) : null}
          {proposal.rejectionReason ? <p>Rejected: {proposal.rejectionReason}</p> : null}
          {proposal.commit ? (
            <p className="break-all text-xs text-muted-foreground">
              Commit: {proposal.commit}
              {proposal.revertCommit ? ` · Revert: ${proposal.revertCommit}` : ""}
            </p>
          ) : null}
          {proposal.status === "pending" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="xs" disabled={busy || !canDecide} onClick={() => void run("approve")}>
                Approve
              </Button>
              <Input
                nativeInput
                aria-label="Rejection reason"
                placeholder="Reason for rejection"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy || !canDecide}
              />
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busy || !canDecide || !reason.trim()}
                onClick={() => void run("reject")}
              >
                Reject
              </Button>
            </div>
          ) : proposal.status === "applied" ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy || !canDecide}
              onClick={() => void run("revert")}
            >
              Revert
            </Button>
          ) : null}
        </div>
      ) : null}
    </SettingsRow>
  );
}
