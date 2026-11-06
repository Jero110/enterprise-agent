import type { EnvironmentId, KnowledgeProposal } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";
import {
  enterpriseEnvironment,
  enterpriseFiles,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 35 * 1024 * 1024;

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function CurrentDocument({ environmentId, path }: { environmentId: EnvironmentId; path: string }) {
  const document = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeGet({ environmentId, input: { path } }),
  );
  return (
    <div className="space-y-1">
      <p>Current content</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
        {document.error ?? document.data?.content ?? "Loading…"}
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
  const resolve = async (action: "approve" | "reject" | "revert") => {
    setBusy(true);
    const result = await decide({
      environmentId,
      input: { id: proposal.id, action, ...(action === "reject" ? { reason: reason.trim() } : {}) },
    });
    setBusy(false);
    if (result._tag === "Success") refresh();
    else if (!isAtomCommandInterrupted(result))
      toastManager.add({
        type: "error",
        title: "Could not resolve proposal",
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
        title: "Could not download file",
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
      aria-label={`Proposal ${proposal.id}`}
      className="space-y-3 rounded-lg border p-4 text-sm"
    >
      <h3 className="font-medium">
        {proposal.kind === "upload"
          ? proposal.files?.map((file) => file.name).join(", ")
          : proposal.path || proposal.kind}
      </h3>
      <p>
        {proposal.scope === "global"
          ? "Company"
          : proposal.scope === "personal"
            ? `Personal · ${proposal.recipient ?? proposal.proposedBy}`
            : `Area · ${proposal.scope}`}
      </p>
      <p>
        Authored by {proposal.proposedBy} ·{" "}
        {proposal.status === "approved-awaiting-processing"
          ? "Approved, awaiting processing (not in current context)"
          : proposal.status}
      </p>
      <p>
        Reviewers:{" "}
        {proposal.reviewers?.map((reviewer) => `${reviewer.email} (${reviewer.role})`).join(", ") ||
          "Not assigned"}
      </p>
      <p>{proposal.reason}</p>
      {proposal.evidence.length > 0 && <p>Evidence: {proposal.evidence.join(", ")}</p>}
      {proposal.path && proposal.kind !== "create" && proposal.kind !== "area-access" && (
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
            Download {file.name} ({Math.ceil(file.sizeBytes / 1024)} KiB)
          </Button>
          {file.mimeType === "application/pdf" && (
            <Button size="xs" variant="outline" onClick={() => void save(file, true)}>
              Preview PDF
            </Button>
          )}
        </div>
      ))}
      {proposal.rejectionReason && <p>Rejected: {proposal.rejectionReason}</p>}
      {proposal.resolvedBy && (
        <p>
          Resolved by {proposal.resolvedBy} · {proposal.resolvedAt}
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
            Revert
          </Button>
        )}
      {proposal.status === "pending" && proposal.canDecide === true && permission && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="xs" disabled={busy} onClick={() => void resolve("approve")}>
            Approve
          </Button>
          <Input
            nativeInput
            aria-label="Rejection reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for rejection"
            disabled={busy}
          />
          <Button
            size="xs"
            variant="destructive-outline"
            disabled={busy || !reason.trim()}
            onClick={() => void resolve("reject")}
          >
            Reject
          </Button>
        </div>
      )}
    </section>
  );
}

function ProposalList({
  title,
  proposals,
  selected,
  onSelect,
}: {
  readonly title: string;
  readonly proposals: ReadonlyArray<KnowledgeProposal>;
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
          {proposal.kind === "upload"
            ? proposal.files?.map((file) => file.name).join(", ")
            : proposal.path || proposal.kind}{" "}
          · {proposal.status} · {proposal.proposedBy}
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
  const upload = useAtomCommand(enterpriseFiles.upload, {
    label: "upload context files",
    reportFailure: false,
  });
  const [scope, setScope] = useState("personal");
  const [recipient, setRecipient] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const proposals = inbox.data?.proposals ?? [];
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selected);
  const scopes = [
    { id: "personal", name: "Personal" },
    ...(org.data?.teams ?? [])
      .filter((team) => identity?.role === "admin" || team.access !== "none")
      .map((team) => ({ id: team.id, name: team.name })),
    { id: "global", name: "Company" },
  ];
  const submit = async () => {
    if (busy) return;
    if (
      !reason.trim() ||
      files.length === 0 ||
      files.length > MAX_FILES ||
      files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_BYTES ||
      files.some((file) => file.size === 0 || file.size > MAX_FILE_BYTES) ||
      (scope === "personal" && !recipient.trim())
    ) {
      setError(
        `Select a destination${scope === "personal" ? " and recipient" : ""}, add a reason and 1–${MAX_FILES} nonempty files (up to 10 MiB each, 35 MiB total).`,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const encoded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: await fileBase64(file),
        })),
      );
      const result = await upload({
        environmentId,
        input: {
          scope,
          ...(scope === "personal" ? { recipient: recipient.trim() } : {}),
          reason: reason.trim(),
          files: encoded,
        },
      });
      if (result._tag === "Failure")
        throw new Error(enterpriseFailureMessage(squashAtomCommandFailure(result)));
      setFiles([]);
      setFileInputKey((value) => value + 1);
      setReason("");
      setSelected(result.value.id);
      inbox.refresh();
      toastManager.add({
        type: "success",
        title: "Files staged for review",
        description: "Approval does not process or add them to current context.",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <section
        aria-label="Pending context changes"
        className="relative min-h-64 overflow-hidden rounded-xl border bg-background"
      >
        <iframe
          title="Knowledge map behind pending changes"
          sandbox="allow-scripts"
          src="/context-graph/index.html"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full border-0 opacity-20 grayscale"
        />
        <div className="relative grid gap-3 p-4 sm:grid-cols-3">
          {scopes.map((group) => (
            <section key={group.id} className="rounded-lg border bg-background/95 p-3">
              <h3 className="mb-2 text-sm font-medium">{group.name}</h3>
              {pending
                .filter((proposal) => proposal.scope === group.id)
                .map((proposal) => (
                  <button
                    key={proposal.id}
                    type="button"
                    aria-pressed={selected === proposal.id}
                    className="mb-2 block w-full rounded-md border border-primary/50 bg-primary/10 p-2 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => setSelected(proposal.id)}
                  >
                    {proposal.kind === "upload"
                      ? proposal.files?.map((file) => file.name).join(", ")
                      : proposal.path || proposal.kind}
                    <span className="block text-muted-foreground">
                      {group.id === "personal" ? proposal.recipient : proposal.proposedBy}
                    </span>
                  </button>
                ))}
              {pending.every((proposal) => proposal.scope !== group.id) && (
                <p className="text-xs text-muted-foreground">No pending changes</p>
              )}
            </section>
          ))}
        </div>
      </section>
      <section aria-label="Ingest files" className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">Ingest files</h2>
        <p className="text-xs text-muted-foreground">
          Stage files from this device for review. Approved files await future processing and are
          not added to current context.
        </p>
        <label className="block text-sm">
          Destination{" "}
          <select
            aria-label="Destination"
            className="ml-2 rounded border bg-background p-1"
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            disabled={busy}
          >
            {scopes.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
        </label>
        {scope === "personal" && (
          <Input
            nativeInput
            type="email"
            aria-label="Recipient email"
            placeholder="Enrolled recipient's email"
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            disabled={busy}
          />
        )}
        <label className="block text-sm">
          Files{" "}
          <input
            className="block text-xs"
            type="file"
            key={fileInputKey}
            multiple
            disabled={busy}
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </label>
        {files.length > 0 && <p className="text-xs">{files.map((file) => file.name).join(", ")}</p>}
        <Input
          nativeInput
          aria-label="Reason for upload"
          placeholder="What should reviewers know?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={busy}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button size="xs" disabled={busy || files.length === 0} onClick={() => void submit()}>
          {busy ? "Uploading…" : "Stage for review"}
        </Button>
      </section>
      <section aria-label="Context changes history" className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Authored, assigned and history</h2>
          <Button size="xs" variant="outline" onClick={inbox.refresh}>
            Refresh
          </Button>
        </div>
        {inbox.error ? (
          <p role="alert">{inbox.error}</p>
        ) : !inbox.data ? (
          <p role="status">Loading proposals…</p>
        ) : proposals.length === 0 ? (
          <p>No proposals yet.</p>
        ) : (
          <div className="space-y-4">
            <ProposalList
              title="Assigned to you"
              proposals={pending.filter((proposal) =>
                proposal.reviewers?.some((reviewer) => reviewer.email === identity?.email),
              )}
              selected={selected}
              onSelect={setSelected}
            />
            <ProposalList
              title="Authored by you"
              proposals={pending.filter((proposal) => proposal.proposedBy === identity?.email)}
              selected={selected}
              onSelect={setSelected}
            />
            <ProposalList
              title="History"
              proposals={proposals.filter((proposal) => proposal.status !== "pending")}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        )}
        {selectedProposal && (
          <ProposalDetails
            key={selectedProposal.id}
            proposal={selectedProposal}
            environmentId={environmentId}
            refresh={inbox.refresh}
          />
        )}
      </section>
    </div>
  );
}
