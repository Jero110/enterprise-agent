import type { EnvironmentId, KnowledgeProposal } from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useRef, useState } from "react";
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
import { pendingGraphNodes } from "./proposalGraph";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 35 * 1024 * 1024;

const STATUS_LABELS: Record<KnowledgeProposal["status"], string> = {
  pending: "Pending",
  applied: "Applied",
  rejected: "Rejected",
  reverted: "Reverted",
  "approved-awaiting-processing": "Approved, awaiting processing (not in current context)",
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
  return t(STATUS_LABELS[status]);
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("Could not read {name}.", { name: file.name })));
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
  const areaName =
    org.data?.teams.find((team) => team.id === proposal.scope)?.name ?? proposal.scope;
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
          ? t("{who} asks for access to {area}", { who: proposal.proposedBy, area: areaName })
          : proposal.kind === "upload"
            ? proposal.files?.map((file) => file.name).join(", ")
            : proposal.path || proposal.kind}
      </h3>
      <p>
        {proposal.scope === "global"
          ? t("Company")
          : proposal.scope === "personal"
            ? t("Personal · {who}", { who: proposal.recipient ?? proposal.proposedBy })
            : t("Area · {area}", { area: areaName })}
      </p>
      <p>
        {t("Authored by {who}", { who: proposal.proposedBy })} · {statusLabel(proposal.status)}
      </p>
      {!isAccessRequest && (
        <p>
          {t("Reviewers:")}{" "}
          {proposal.reviewers
            ?.map((reviewer) => `${reviewer.email} (${reviewer.role})`)
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
          {t("Resolved by {who}", { who: proposal.resolvedBy })} ·{" "}
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
      {proposal.status === "pending" && proposal.canDecide === true && permission && (
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
          · {statusLabel(proposal.status)} · {proposal.proposedBy}
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
  const [graphReady, setGraphReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const proposals = inbox.data?.proposals ?? [];
  const pending = proposals.filter((proposal) => proposal.status === "pending");
  const selectedProposal = proposals.find((proposal) => proposal.id === selected);
  const graphNodes = pendingGraphNodes(inbox.data?.proposals ?? [], org.data?.teams ?? []);
  const graphGroups = [
    ...new Map(graphNodes.map((node) => [node.groupId, node.groupLabel])).entries(),
  ];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronize the sandboxed graph with hub-confirmed pending proposals
  useEffect(() => {
    if (graphReady)
      frame.current?.contentWindow?.postMessage(
        {
          type: "knowledge-proposals",
          nodes: pendingGraphNodes(inbox.data?.proposals ?? [], org.data?.teams ?? []),
        },
        "*",
      );
  }, [graphReady, inbox.data?.proposals, org.data?.teams]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- receive node selection and readiness from the sandboxed graph
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.type === "knowledge-graph-ready") setGraphReady(true);
      if (
        event.data?.type === "knowledge-proposal-selected" &&
        inbox.data?.proposals.some(
          (proposal) => proposal.status === "pending" && proposal.id === event.data.id,
        )
      )
        setSelected(event.data.id);
      if (event.data?.type === "knowledge-proposal-cleared") setSelected(null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [inbox.data?.proposals]);
  const selectProposal = (id: string) => {
    setSelected(id);
    frame.current?.contentWindow?.postMessage(
      { type: "knowledge-proposal-focus", id: `proposal:${id}` },
      "*",
    );
  };
  const scopes = [
    { id: "personal", name: t("Personal") },
    ...(org.data?.teams ?? [])
      .filter((team) => identity?.role === "admin" || team.access !== "none")
      .map((team) => ({ id: team.id, name: team.name })),
    { id: "global", name: t("Company") },
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
        scope === "personal"
          ? t(
              "Select a destination and recipient, add a reason and 1–{max} nonempty files (up to 10 MiB each, 35 MiB total).",
              { max: MAX_FILES },
            )
          : t(
              "Select a destination, add a reason and 1–{max} nonempty files (up to 10 MiB each, 35 MiB total).",
              { max: MAX_FILES },
            ),
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
      if (result._tag === "Failure") {
        setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
      } else {
        setFiles([]);
        setFileInputKey((value) => value + 1);
        setReason("");
        setSelected(result.value.id);
        inbox.refresh();
        toastManager.add({
          type: "success",
          title: t("Files staged for review"),
          description: t("Approval does not process or add them to current context."),
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Upload failed. Please try again."));
    }
    setBusy(false);
  };
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <section
        aria-label={t("Pending context changes")}
        className="overflow-hidden rounded-xl border bg-background"
      >
        <div className="grid lg:grid-cols-[minmax(0,1fr)_230px]">
          <iframe
            ref={frame}
            title={t("Interactive context changes graph")}
            sandbox="allow-scripts"
            src="/context-graph/index.html"
            className="h-[470px] w-full border-0"
          />
          <aside
            aria-label={t("Pending proposals by scope")}
            className="max-h-[470px] space-y-3 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l"
          >
            {graphGroups.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {inbox.data ? t("No pending changes") : t("Loading proposals…")}
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
                      aria-pressed={selected === node.proposalId}
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
      <section aria-label={t("Ingest files")} className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">{t("Ingest files")}</h2>
        <p className="text-xs text-muted-foreground">
          {t(
            "Stage files from this device for review. Approved files await future processing and are not added to current context.",
          )}
        </p>
        <label className="block text-sm">
          {t("Destination")}{" "}
          <select
            aria-label={t("Destination")}
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
            aria-label={t("Recipient email")}
            placeholder={t("Enrolled recipient's email")}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            disabled={busy}
          />
        )}
        <label className="block text-sm">
          {t("Files")}{" "}
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
          aria-label={t("Reason for upload")}
          placeholder={t("What should reviewers know?")}
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
          {busy ? t("Uploading…") : t("Stage for review")}
        </Button>
      </section>
      <section aria-label={t("Context changes history")} className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">{t("Authored, assigned and history")}</h2>
          <Button size="xs" variant="outline" onClick={inbox.refresh}>
            {t("Refresh")}
          </Button>
        </div>
        {inbox.error ? (
          <p role="alert">{inbox.error}</p>
        ) : !inbox.data ? (
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
              selected={selected}
              onSelect={selectProposal}
            />
            <ProposalList
              title={t("Authored by you")}
              proposals={pending.filter((proposal) => proposal.proposedBy === identity?.email)}
              selected={selected}
              onSelect={selectProposal}
            />
            <ProposalList
              title={t("History")}
              proposals={proposals.filter((proposal) => proposal.status !== "pending")}
              selected={selected}
              onSelect={selectProposal}
            />
          </div>
        )}
      </section>
    </div>
  );
}
