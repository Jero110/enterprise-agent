import type {
  EnvironmentId,
  EnterpriseOrgFiles,
  EnterpriseOrgImportResult,
  EnterpriseIngestStartResult,
  ModelSelection,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { FolderOpenIcon, Link2Icon, FilesIcon, UploadCloudIcon } from "lucide-react";
import {
  enterpriseEnvironment,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { t } from "~/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { areaDestinations, ingestStartError } from "./ingestDestinations";
import { noraiDemoSteps, proposeDemoFile, resetDemo, useDemoState } from "./noraiDemo";
import { ingestSourceSelection, type IngestSourceMode } from "./ingestSourceSelection";
import {
  droppedUploadFiles,
  uploadBatches,
  uploadFileError,
  uploadPath,
} from "./ingestUploadFiles";

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(t("Could not read {name}.", { name: file.name })));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

export function IngestTab({
  environmentId,
  connectors,
  ingestion,
  onReview,
  onOpenMap,
}: {
  environmentId: EnvironmentId;
  connectors?: ReactNode;
  ingestion?: IncrementalIngestion;
  onReview?: () => void;
  onOpenMap?: () => void;
}) {
  const { identity } = useEnterpriseStatus();
  if (!identity) return null;
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <IngestionRun
        key={`${environmentId}:${identity.email}`}
        environmentId={environmentId}
        ingestion={ingestion}
        onReview={onReview}
        onOpenMap={onOpenMap}
      />
      {identity.role === "admin" && (
        <>
          <details
            className="rounded-xl border bg-background p-5"
            aria-label={t("Organization setup")}
          >
            <summary className="cursor-pointer font-medium">
              {t("Organization setup (admins)")}
            </summary>
            <OrgImport environmentId={environmentId} />
          </details>
          <details aria-label={t("Connectors")} className="rounded-xl border p-4">
            <summary className="cursor-pointer font-medium">{t("Connectors (optional)")}</summary>
            {connectors}
          </details>
        </>
      )}
    </div>
  );
}

export interface IncrementalIngestion {
  readonly canStart: boolean;
  readonly modelSelection: ModelSelection;
  readonly start: (input: {
    folder?: string;
    note?: string;
    sourceUrls?: ReadonlyArray<string>;
    destination: string;
    uploadProposalIds?: ReadonlyArray<string>;
    modelSelection: ModelSelection;
  }) => Promise<EnterpriseIngestStartResult>;
  readonly stageUpload?: (
    files: ReadonlyArray<{ name: string; relativePath?: string; mimeType: string; base64: string }>,
    destination: string,
  ) => Promise<{ uploadProposalIds: ReadonlyArray<string> }>;
}

function IngestionRun({
  environmentId,
  ingestion,
  onReview,
  onOpenMap,
}: {
  environmentId: EnvironmentId;
  ingestion: IncrementalIngestion | undefined;
  onReview: (() => void) | undefined;
  onOpenMap: (() => void) | undefined;
}) {
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const { identity } = useEnterpriseStatus();
  const runKey = `t3:enterprise-ingest:${environmentId}:${identity?.email ?? ""}`;
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<IngestSourceMode>(
    import.meta.env.DEV ? "files" : "url",
  );
  const [destination, setDestination] = useState("personal");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<EnterpriseIngestStartResult | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(runKey) ?? "null") as unknown;
      if (
        saved &&
        typeof saved === "object" &&
        "runId" in saved &&
        "threadId" in saved &&
        typeof saved.runId === "string" &&
        typeof saved.threadId === "string"
      )
        return saved as EnterpriseIngestStartResult;
    } catch {
      return null;
    }
    return null;
  });
  const [stagedCount, setStagedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const demoBusy = demoStep !== null;
  const { active: demoReady } = useDemoState(environmentId);
  const demoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- cancel a pending demo timer when the tab unmounts
  useEffect(
    () => () => {
      if (demoTimer.current) clearTimeout(demoTimer.current);
    },
    [],
  );
  const runStatus = useEnvironmentQuery(
    run ? enterpriseEnvironment.ingestStatus({ environmentId, input: { runId: run.runId } }) : null,
  );
  const { sourceUrls, selectedFiles } = ingestSourceSelection(sourceMode, urls, files);
  const canSelectFiles = Boolean(ingestion?.canStart) || import.meta.env.DEV;
  // Dev builds: dropping or choosing a file files the mock proposal straight away.
  const runDemo = (fileName: string | undefined) => {
    if (!fileName || demoBusy) return;
    const advance = (step: number) => {
      setDemoStep(step);
      demoTimer.current = setTimeout(() => {
        if (step + 1 < noraiDemoSteps.length) return advance(step + 1);
        proposeDemoFile(environmentId, fileName);
        setDemoStep(null);
        setFiles([]);
        onReview?.();
      }, 700);
    };
    advance(0);
  };
  const start = async () => {
    if (!ingestion || busy) return;
    const fileError = uploadFileError(selectedFiles);
    if (sourceUrls.length > 10 || fileError) {
      setError(t(fileError ?? "Choose at most 10 URLs."));
      return;
    }
    if (selectedFiles.length && !ingestion.stageUpload) {
      setError(t("File upload is unavailable for this connection."));
      return;
    }
    setBusy(true);
    setError(null);
    setStagedCount(0);
    setRun(null);
    try {
      const uploadProposalIds: string[] = [];
      if (ingestion.stageUpload) {
        for (const batch of uploadBatches(selectedFiles)) {
          const staged = await ingestion.stageUpload(
            await Promise.all(
              batch.map(async (file) => ({
                name: file.name,
                relativePath: uploadPath(file),
                mimeType: file.type || "application/octet-stream",
                base64: await fileBase64(file),
              })),
            ),
            destination,
          );
          uploadProposalIds.push(...staged.uploadProposalIds);
          setStagedCount((count) => count + batch.length);
        }
      }
      const started = await ingestion.start({
        destination,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sourceUrls.length ? { sourceUrls } : {}),
        ...(uploadProposalIds.length ? { uploadProposalIds } : {}),
        modelSelection: ingestion.modelSelection,
      });
      setFiles([]);
      setUrls("");
      setNote("");
      setRun(started);
      try {
        sessionStorage.setItem(runKey, JSON.stringify(started));
      } catch {
        // Session storage is optional; the run remains visible until this panel unmounts.
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("Could not start ingestion");
      setError(t(ingestStartError(message, sourceUrls)));
    }
    setBusy(false);
  };
  return (
    <section
      aria-label={t("Incremental ingestion")}
      className="space-y-5 rounded-xl border bg-background p-5 sm:p-6"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t("Add knowledge")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Choose a source. The agent prepares proposals; you decide what enters the knowledge map.",
          )}
        </p>
      </div>
      <div className="space-y-2">
        <label htmlFor="ingest-destination" className="text-sm font-medium">
          {t("1. Where should it go?")}
        </label>
        <select
          id="ingest-destination"
          aria-label={t("Destination")}
          className="block w-full max-w-xs rounded-lg border border-input bg-background px-3 py-2 text-sm"
          value={destination}
          onChange={(event) => {
            setDestination(event.target.value);
            setFiles([]);
          }}
          disabled={busy}
        >
          <option value="personal">{t("Personal")}</option>
          {areaDestinations(org.data?.teams ?? []).map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
          <option value="global">{t("General")}</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {destination === "personal"
            ? t("Only you review Personal proposals; they are filed under your account.")
            : destination === "global"
              ? t("A company admin reviews General proposals.")
              : t("Your area's lead or a company admin reviews Area proposals.")}
        </p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium">{t("2. Choose one source")}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("Source type")}>
          {(
            [
              ["url", Link2Icon, t("Repository URL")],
              ["folder", FolderOpenIcon, t("Folder")],
              ["files", FilesIcon, t("Files")],
            ] as const
          ).map(([mode, Icon, label]) => (
            <Button
              key={mode}
              size="sm"
              variant={sourceMode === mode ? "secondary" : "outline"}
              aria-pressed={sourceMode === mode}
              disabled={busy}
              onClick={() => {
                setSourceMode(mode);
                setFiles([]);
                setError(null);
              }}
            >
              <Icon className="size-4" /> {label}
            </Button>
          ))}
        </div>
        {sourceMode === "url" ? (
          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <label htmlFor="ingest-url" className="text-sm font-medium">
              {t("Public HTTPS repository or document URL")}
            </label>
            <Input
              nativeInput
              id="ingest-url"
              type="url"
              aria-label={t("Public HTTPS URLs")}
              placeholder="https://github.com/owner/repository"
              disabled={busy || !ingestion?.canStart}
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(
                "For a repository, use its root URL. Only supported files in the selected destination are prepared.",
              )}
            </p>
          </div>
        ) : (
          <div
            className="space-y-3 rounded-xl border border-dashed bg-muted/20 p-5"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (busy || !canSelectFiles) return;
              const dropped = droppedUploadFiles(event.dataTransfer);
              if (dropped === null) {
                setFiles([]);
                setError(
                  t("Folders cannot be dropped here. Use Choose folder to select raw/ instead."),
                );
                return;
              }
              setSourceMode("files");
              setError(null);
              setFiles(dropped);
              if (import.meta.env.DEV) runDemo(dropped[0]?.name);
            }}
          >
            <div className="flex items-start gap-3">
              <UploadCloudIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {sourceMode === "folder"
                    ? t("Select a folder, including its subfolders")
                    : t("Choose files or drop them here")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {sourceMode === "folder"
                    ? t("Use the folder picker for raw/. Dragging a folder is not supported.")
                    : t("Original relative paths are kept for review.")}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canSelectFiles}
              onClick={() => (sourceMode === "folder" ? folderInput : fileInput).current?.click()}
            >
              {sourceMode === "folder" ? t("Choose folder") : t("Choose files")}
            </Button>
            <input
              ref={(input) => {
                folderInput.current = input;
                input?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              className="sr-only"
              aria-label={t("Choose folder")}
              disabled={busy || !canSelectFiles}
              onChange={(event) => {
                const selected = droppedUploadFiles({ items: [], files: event.target.files ?? [] });
                event.target.value = "";
                setFiles(selected ?? []);
                setError(
                  selected === null
                    ? t("This folder could not be read. Choose folder again and select raw/.")
                    : null,
                );
              }}
            />
            <input
              ref={fileInput}
              type="file"
              multiple
              className="sr-only"
              aria-label={t("Choose files")}
              disabled={busy || !canSelectFiles}
              onChange={(event) => {
                const chosen = Array.from(event.target.files ?? []);
                setFiles(chosen);
                event.target.value = "";
                if (import.meta.env.DEV) runDemo(chosen[0]?.name);
                setError(null);
              }}
            />
            {selectedFiles.length > 0 && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("{count} files selected", { count: selectedFiles.length })} ·{" "}
                {selectedFiles.slice(0, 3).map(uploadPath).join(", ")}
                {selectedFiles.length > 3 ? "…" : ""}
              </p>
            )}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          {t("Add a note for the agent (optional)")}
        </summary>
        <div className="mt-2 max-w-xl">
          <Input
            nativeInput
            aria-label={t("Missing knowledge")}
            placeholder={t("What should the agent look for?")}
            disabled={busy || !ingestion?.canStart}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-3 border-t pt-4">
        <Button
          size="sm"
          disabled={
            busy ||
            !ingestion?.canStart ||
            (!selectedFiles.length && !sourceUrls.length && !note.trim())
          }
          onClick={() => void start()}
        >
          {busy ? t("Preparing…") : t("Start ingestion")}
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("Nothing is published until a reviewer approves it.")}
        </p>
      </div>
      {import.meta.env.DEV && (
        <div className="space-y-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4">
          <p className="text-sm font-medium">{t("Norai knowledge map preview")}</p>
          <p className="text-xs text-muted-foreground">
            {t(
              "Ask a mock agent to ingest one file. It files a proposal in Changes; approving it adds a single new node to the sample map. Files are not analyzed or uploaded.",
            )}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              variant="outline"
              disabled={demoBusy || !selectedFiles.length}
              onClick={() => runDemo(selectedFiles[0]?.name)}
            >
              {demoBusy ? t("Ingesting…") : t("Ingest selected file")}
            </Button>
            {demoReady && (
              <>
                <Button size="sm" variant="ghost" onClick={onOpenMap}>
                  {t("Open knowledge map")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    resetDemo(environmentId);
                    onOpenMap?.();
                  }}
                >
                  {t("Return to live map")}
                </Button>
              </>
            )}
          </div>
          {demoBusy && (
            <p role="status" className="text-xs text-muted-foreground">
              {t(noraiDemoSteps[demoStep ?? 0] ?? "Ingesting")}…
            </p>
          )}
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {selectedFiles.length
            ? stagedCount < selectedFiles.length
              ? t("Staging {count} of {total} selected files…", {
                  count: stagedCount,
                  total: selectedFiles.length,
                })
              : t("Files staged. Starting agent turn…")
            : t("Starting agent turn…")}
        </p>
      )}
      {run && (
        <div role="status" className="space-y-2 rounded-xl border bg-muted/20 p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium">
              {runStatus.data?.status === "completed"
                ? t("Agent run completed")
                : runStatus.data?.status === "failed"
                  ? t("Agent run failed")
                  : t("Agent run started")}
            </p>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setRun(null);
                try {
                  sessionStorage.removeItem(runKey);
                } catch {
                  // Storage may be unavailable; the visible run still closes.
                }
              }}
            >
              {t("Dismiss")}
            </Button>
          </div>
          {runStatus.data ? (
            <p className="text-muted-foreground">
              {t(
                "Agent: {status} · {sources} sources · {proposals} proposals ({pending} awaiting review)",
                {
                  status: runStatus.data.agentStatus ?? runStatus.data.status,
                  sources: runStatus.data.sourceCount,
                  proposals: runStatus.data.proposedCount,
                  pending: runStatus.data.pendingCount,
                },
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {runStatus.error
                ? t("Could not load the current run status.")
                : t("Checking run status…")}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t(
              "Proposals appear in Changes as the agent prepares them; nothing is approved automatically.",
            )}
          </p>
          {runStatus.error && (
            <Button size="xs" variant="outline" onClick={runStatus.refresh}>
              {t("Retry status")}
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-4">
            {identity?.hubEnvironmentId === environmentId ? (
              <Link
                className="font-medium text-primary underline underline-offset-2"
                to="/$environmentId/$threadId"
                params={{ environmentId, threadId: run.threadId }}
              >
                {t("Open agent turn")}
              </Link>
            ) : (
              <span className="text-muted-foreground">
                {t("The agent turn runs on the hub. Its status appears here.")}
              </span>
            )}
            {onReview && (
              <Button size="sm" variant="outline" onClick={onReview}>
                {t("Review proposals")}
              </Button>
            )}
          </div>
          {run.skippedSources?.length ? (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">
                {t("{count} sources were skipped; no content was invented for them.", {
                  count: run.skippedSources.length,
                })}
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pl-4">
                {run.skippedSources.map((source) => (
                  <li key={source.path}>
                    {source.path} · {source.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function OrgImport({ environmentId }: { environmentId: EnvironmentId }) {
  const template = useEnvironmentQuery(
    enterpriseEnvironment.orgTemplate({ environmentId, input: {} }),
  );
  const canPreview = useAtomValue(
    enterpriseEnvironment.orgImportPreview.permissionAtom(environmentId),
  );
  const canApply = useAtomValue(enterpriseEnvironment.orgImportApply.permissionAtom(environmentId));
  const previewImport = useAtomCommand(enterpriseEnvironment.orgImportPreview, {
    label: "preview organization import",
  });
  const applyImport = useAtomCommand(enterpriseEnvironment.orgImportApply, {
    label: "apply organization import",
  });
  const [files, setFiles] = useState<EnterpriseOrgFiles>({ organization: "", areas: "" });
  const [fileNames, setFileNames] = useState<Partial<Record<keyof EnterpriseOrgFiles, string>>>({});
  const [preview, setPreview] = useState<EnterpriseOrgImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selections = useRef({ organization: 0, areas: 0 });
  const selectFile = async (name: keyof EnterpriseOrgFiles, file: File | undefined) => {
    if (!file || busy) return;
    const selection = ++selections.current[name];
    setPreview(null);
    setFiles((current) => ({ ...current, [name]: "" }));
    setFileNames((current) => ({ ...current, [name]: undefined }));
    if (!/\.ya?ml$/i.test(file.name) || file.size === 0 || file.size > 1_000_000) {
      setError(t("Choose a nonempty YAML file under 1 MB."));
      return;
    }
    try {
      const content = await file.text();
      if (selections.current[name] !== selection) return;
      setFiles((current) => ({ ...current, [name]: content }));
      setFileNames((current) => ({ ...current, [name]: file.name }));
      setError(null);
    } catch {
      if (selections.current[name] === selection) setError(t("Could not read YAML file."));
    }
  };
  const download = (name: keyof EnterpriseOrgFiles) => {
    if (!template.data) return;
    const url = URL.createObjectURL(new Blob([template.data[name]], { type: "text/yaml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name + ".yaml";
    link.click();
    URL.revokeObjectURL(url);
  };
  const run = async (apply: boolean) => {
    if (busy || (apply && (!preview || preview.applied))) return;
    setBusy(true);
    setError(null);
    try {
      const result = await (apply ? applyImport : previewImport)({ environmentId, input: files });
      if (result._tag === "Success") setPreview(result.value);
      else setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("Could not preview organization import."),
      );
    }
    setBusy(false);
  };
  return (
    <section aria-label={t("Organization import")} className="mt-4 space-y-3 border-t pt-4">
      <h2 className="font-medium">{t("Organization and areas (admins)")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "Upload both matching YAML files. Preview all changes before confirming; missing people may be removed. To add one member or change an area, use Organization settings instead.",
        )}
      </p>
      {(["organization", "areas"] as const).map((name) => (
        <div key={name} className="space-y-2">
          <Button
            size="xs"
            variant="outline"
            disabled={!template.data}
            onClick={() => download(name)}
          >
            {t("Download template")} · {name}.yaml
          </Button>
          <label
            className="block cursor-pointer rounded-lg border border-dashed bg-muted/20 p-4 text-sm hover:border-foreground/30"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy && canPreview) void selectFile(name, event.dataTransfer.files[0]);
            }}
          >
            {name}.yaml · {fileNames[name] ?? t("Drop or choose a YAML file")}
            <input
              className="sr-only"
              type="file"
              accept=".yaml,.yml"
              aria-label={name + ".yaml"}
              disabled={busy || !canPreview}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void selectFile(name, file);
              }}
            />
          </label>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        size="sm"
        disabled={busy || !canPreview || !files.organization || !files.areas}
        onClick={() => void run(false)}
      >
        {t("Preview import")}
      </Button>
      {preview && (
        <div className="space-y-3">
          <p role="status" className="text-sm">
            {preview.applied
              ? t("Organization imported")
              : t("Preview: {count} changes; {removed} removals. Nothing has been applied.", {
                  count: preview.changes.length,
                  removed: preview.changes.filter((change) => change.change === "removed").length,
                })}
          </p>
          <ul className="max-h-52 overflow-auto text-sm">
            {preview.changes.map((change) => (
              <li key={change.kind + ":" + change.id}>
                {change.change} · {change.kind} · {change.name} {change.fields.join(", ")}
              </li>
            ))}
          </ul>
          {preview.changes.length === 0 && <p>{t("No changes")}</p>}
          {preview.applied ? (
            <p role="status">{t("Organization imported")}</p>
          ) : (
            <Button size="sm" disabled={busy || !canApply} onClick={() => void run(true)}>
              {t("Confirm import")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
