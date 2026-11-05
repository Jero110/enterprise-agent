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
import { Checkbox } from "../ui/checkbox";
import { toastManager } from "../ui/toast";
import { SettingsRow, SettingsSection } from "../settings/settingsLayout";
import { approveBatch } from "./approveBatch";

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
  const canDecide = useAtomValue(
    enterpriseEnvironment.proposalDecide.permissionAtom(environmentId),
  );
  const decide = useAtomCommand(enterpriseEnvironment.proposalDecide, {
    label: "approve knowledge proposal",
    reportFailure: false,
  });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const pending = inbox.data?.proposals.filter((proposal) => proposal.status === "pending") ?? [];
  const selectedPending = pending.filter((proposal) => selected.has(proposal.id));
  const runBatch = async () => {
    if (busy || !canDecide) return;
    setBusy(true);
    const result = await approveBatch(
      selectedPending.map((proposal) => proposal.id),
      async (id) => {
        const outcome = await decide({ environmentId, input: { id, action: "approve" } });
        if (outcome._tag === "Success") return true;
        if (!isAtomCommandInterrupted(outcome))
          toastManager.add({
            type: "error",
            title: "Batch approval stopped",
            description: enterpriseFailureMessage(squashAtomCommandFailure(outcome)),
          });
        return false;
      },
    );
    setSelected((current) => new Set([...current].filter((id) => !result.approved.includes(id))));
    setBusy(false);
  };
  return (
    <SettingsSection
      title="Approvals inbox"
      headerAction={
        <div className="flex gap-2">
          <Button
            size="xs"
            disabled={!canDecide || busy || selectedPending.length === 0}
            onClick={() => void runBatch()}
          >
            Approve selected ({selectedPending.length})
          </Button>
          <Button size="xs" variant="outline" onClick={inbox.refresh}>
            Refresh
          </Button>
        </div>
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
          <ProposalRow
            key={proposal.id}
            environmentId={environmentId}
            proposal={proposal}
            selected={selected.has(proposal.id)}
            batchBusy={busy}
            onSelect={(checked) =>
              setSelected((current) => {
                const next = new Set(current);
                if (checked) next.add(proposal.id);
                else next.delete(proposal.id);
                return next;
              })
            }
          />
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
  selected,
  batchBusy,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly proposal: KnowledgeProposal;
  readonly selected: boolean;
  readonly batchBusy: boolean;
  readonly onSelect: (checked: boolean) => void;
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
        <div className="flex items-center gap-2">
          {proposal.status === "pending" ? (
            <Checkbox
              aria-label={`Select ${proposal.path || proposal.scope}`}
              checked={selected}
              disabled={batchBusy || !canDecide}
              onCheckedChange={onSelect}
            />
          ) : null}
          <Button size="xs" variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Hide" : "Review"}
          </Button>
        </div>
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
              <Button
                size="xs"
                disabled={busy || batchBusy || !canDecide}
                onClick={() => void run("approve")}
              >
                Approve
              </Button>
              <Input
                nativeInput
                aria-label="Rejection reason"
                placeholder="Reason for rejection"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy || batchBusy || !canDecide}
              />
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busy || batchBusy || !canDecide || !reason.trim()}
                onClick={() => void run("reject")}
              >
                Reject
              </Button>
            </div>
          ) : proposal.status === "applied" ? (
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy || batchBusy || !canDecide}
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
