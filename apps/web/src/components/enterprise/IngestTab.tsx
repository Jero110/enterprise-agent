import type {
  EnvironmentId,
  EnterpriseOrgFiles,
  EnterpriseOrgImportResult,
} from "@t3tools/contracts";
import { AuthOrchestrationOperateScope } from "@t3tools/contracts";
import { useEnvironmentScope } from "~/state/session";
import { useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  enterpriseEnvironment,
  enterpriseFiles,
  enterpriseFailureMessage,
  useEnterpriseStatus,
} from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { t } from "~/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_BYTES = 35 * 1024 * 1024;

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
}: {
  environmentId: EnvironmentId;
  connectors?: ReactNode;
  ingestion?: IncrementalIngestion;
}) {
  const { identity } = useEnterpriseStatus();
  return identity?.role === "admin" ? (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <BucketUpload environmentId={environmentId} />
      <IngestionRun ingestion={ingestion} />
      <OrgImport environmentId={environmentId} />
      <section aria-label={t("Connectors")} className="space-y-3 rounded-xl border p-4">
        <h2 className="font-medium">{t("Connectors")}</h2>
        {/* T4 slot: <ConnectorsSection environmentId={environmentId} /> */}
        {connectors ?? (
          <p className="text-sm text-muted-foreground">
            {t("Connectors are not available on this hub yet.")}
          </p>
        )}
      </section>
    </div>
  ) : null;
}

export interface IncrementalIngestion {
  readonly canStart: boolean;
  readonly start: (input: {
    folder?: string;
    note?: string;
    uploadBatchId?: string;
  }) => Promise<void>;
  readonly stageUpload?: (
    files: ReadonlyArray<{ name: string; mimeType: string; base64: string }>,
  ) => Promise<{ uploadBatchId: string }>;
}

function IngestionRun({ ingestion }: { ingestion: IncrementalIngestion | undefined }) {
  const [folder, setFolder] = useState("");
  const [uploadBatchId, setUploadBatchId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <section aria-label={t("Incremental ingestion")} className="space-y-3 rounded-xl border p-4">
      <h2 className="font-medium">{t("Add to company knowledge")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "Load another folder on the hub, or describe what knowledge is missing. A note can start a run without new files.",
        )}
      </p>
      {!ingestion && (
        <p role="status" className="text-sm">
          {t("Incremental ingestion is not available on this hub yet.")}
        </p>
      )}
      <Input
        nativeInput
        aria-label={t("Hub folder")}
        placeholder={t("Folder path on the hub (optional)")}
        disabled={busy || !ingestion?.canStart}
        value={folder}
        onChange={(event) => setFolder(event.target.value)}
      />
      <label className="block space-y-2 text-sm">
        {t("Upload a new bucket")}
        <input
          type="file"
          multiple
          disabled={busy || !ingestion?.canStart || !ingestion.stageUpload}
          onChange={async (event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (!ingestion?.stageUpload || files.length === 0) return;
            if (
              files.length > MAX_FILES ||
              files.some((file) => file.size === 0 || file.size > MAX_FILE_BYTES) ||
              files.reduce((size, file) => size + file.size, 0) > MAX_BATCH_BYTES
            ) {
              setError(t("Select 1–20 nonempty files (up to 10 MiB each, 35 MiB total)."));
              return;
            }
            setBusy(true);
            setError(null);
            setStatus(null);
            setUploadBatchId("");
            try {
              const encoded = await Promise.all(
                files.map(async (file) => ({
                  name: file.name,
                  mimeType: file.type || "application/octet-stream",
                  base64: await fileBase64(file),
                })),
              );
              const staged = await ingestion.stageUpload(encoded);
              setUploadBatchId(staged.uploadBatchId);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : t("Could not stage upload"));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {uploadBatchId && (
        <div className="flex items-center gap-3 text-sm">
          <p role="status">{t("Upload staged for the next run")}</p>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setUploadBatchId("")}>
            {t("Remove upload")}
          </Button>
        </div>
      )}
      <Input
        nativeInput
        aria-label={t("Missing knowledge")}
        placeholder={t("We're missing…")}
        disabled={busy || !ingestion?.canStart}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button
        size="sm"
        disabled={
          busy || !ingestion?.canStart || (!folder.trim() && !note.trim() && !uploadBatchId)
        }
        onClick={async () => {
          if (!ingestion) return;
          setBusy(true);
          setStatus(null);
          setError(null);
          try {
            await ingestion.start({
              ...(folder.trim() ? { folder: folder.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(uploadBatchId ? { uploadBatchId } : {}),
            });
            setUploadBatchId("");
            setStatus(t("Ingestion started. Review proposed nodes in Changes."));
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : t("Could not start ingestion"));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? t("Starting…") : t("Start ingestion")}
      </Button>
      {status && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

function BucketUpload({ environmentId }: { environmentId: EnvironmentId }) {
  const { identity } = useEnterpriseStatus();
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const inbox = useEnvironmentQuery(
    enterpriseEnvironment.proposalInbox({ environmentId, input: {} }),
  );
  const canUpload = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
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
  const scopes = [
    { id: "personal", name: t("Personal") },
    ...(org.data?.teams ?? [])
      .filter((team) => identity?.role === "admin" || team.access !== "none")
      .map((team) => ({ id: team.id, name: team.name })),
    { id: "global", name: t("Company") },
  ];
  const submit = async () => {
    if (busy || !canUpload) return;
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
    <details aria-label={t("Ingest files")} className="space-y-3 rounded-xl border p-4">
      <summary className="cursor-pointer font-medium">{t("Upload files (preview)")}</summary>
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
      <Button
        size="xs"
        disabled={!canUpload || busy || files.length === 0}
        onClick={() => void submit()}
      >
        {busy ? t("Uploading…") : t("Stage for review")}
      </Button>
    </details>
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
  const [preview, setPreview] = useState<EnterpriseOrgImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    setBusy(true);
    const result = await (apply ? applyImport : previewImport)({ environmentId, input: files });
    if (result._tag === "Success") setPreview(result.value);
    setBusy(false);
  };
  return (
    <section aria-label={t("Organization import")} className="space-y-3 rounded-xl border p-4">
      <h2 className="font-medium">{t("Organization and areas")}</h2>
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
          <label className="block text-sm">
            {name}.yaml
            <input
              type="file"
              accept=".yaml,.yml"
              disabled={busy || !canPreview}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                setPreview(null);
                setFiles((current) => ({ ...current, [name]: "" }));
                if (!file) return;
                if (file.size > 1_000_000) {
                  setError(t("File exceeds 1 MB"));
                  return;
                }
                try {
                  const content = await file.text();
                  setFiles((current) => ({ ...current, [name]: content }));
                  setError(null);
                } catch {
                  setError(t("Could not read file"));
                }
              }}
            />
          </label>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
      <Button
        size="sm"
        disabled={busy || !canPreview || !files.organization || !files.areas}
        onClick={() => void run(false)}
      >
        {t("Preview import")}
      </Button>
      {preview && (
        <div className="space-y-3">
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
