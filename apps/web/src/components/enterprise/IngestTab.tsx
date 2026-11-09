import type {
  EnvironmentId,
  EnterpriseOrgFiles,
  EnterpriseOrgImportResult,
  ModelSelection,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState, type ReactNode } from "react";
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
}: {
  environmentId: EnvironmentId;
  connectors?: ReactNode;
  ingestion?: IncrementalIngestion;
}) {
  const { identity } = useEnterpriseStatus();
  if (!identity) return null;
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <IngestionRun environmentId={environmentId} ingestion={ingestion} />
      {identity.role === "admin" && (
        <>
          <OrgImport environmentId={environmentId} />
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
  }) => Promise<void>;
  readonly stageUpload?: (
    files: ReadonlyArray<{ name: string; relativePath?: string; mimeType: string; base64: string }>,
    destination: string,
  ) => Promise<{ uploadProposalIds: ReadonlyArray<string> }>;
}

function IngestionRun({
  environmentId,
  ingestion,
}: {
  environmentId: EnvironmentId;
  ingestion: IncrementalIngestion | undefined;
}) {
  const org = useEnvironmentQuery(enterpriseEnvironment.org({ environmentId, input: {} }));
  const [destination, setDestination] = useState("personal");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sourceUrls = urls.split(/[\s,]+/).filter(Boolean);
  const start = async () => {
    if (!ingestion || busy) return;
    const fileError = uploadFileError(files);
    if (sourceUrls.length > 10 || fileError) {
      setError(t(fileError ?? "Choose at most 10 URLs."));
      return;
    }
    if (files.length && !ingestion.stageUpload) {
      setError(t("File upload is unavailable for this connection."));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const uploadProposalIds: string[] = [];
      if (ingestion.stageUpload) {
        for (const batch of uploadBatches(files)) {
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
        }
      }
      await ingestion.start({
        destination,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sourceUrls.length ? { sourceUrls } : {}),
        ...(uploadProposalIds.length ? { uploadProposalIds } : {}),
        modelSelection: ingestion.modelSelection,
      });
      setFiles([]);
      setUrls("");
      setNote("");
      setStatus(
        t("Run started. Check Changes after processing; nothing is approved automatically."),
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("Could not start ingestion");
      setError(t(ingestStartError(message, sourceUrls)));
    }
    setBusy(false);
  };
  return (
    <section aria-label={t("Incremental ingestion")} className="space-y-3 rounded-xl border p-4">
      <h2 className="font-medium">{t("Add knowledge")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "Drop files or paste public HTTPS links. Changes are proposed for review, not applied automatically.",
        )}
      </p>
      <label className="block text-sm">
        {t("Destination")}
        <select
          aria-label={t("Destination")}
          className="ml-2 rounded border bg-background p-1"
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
      </label>
      <p className="text-xs text-muted-foreground">
        {destination === "personal"
          ? t("Only you review Personal proposals; they are filed under your account.")
          : destination === "global"
            ? t("A company admin reviews General proposals.")
            : t("Your area's lead or a company admin reviews Area proposals.")}
      </p>
      <label
        className="block rounded border border-dashed p-4 text-sm"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          if (busy || !ingestion?.canStart) return;
          const dropped = droppedUploadFiles(event.dataTransfer);
          if (dropped === null) {
            setFiles([]);
            setError(
              t("Folders cannot be dropped here. Use Choose folder to select raw/ instead."),
            );
            return;
          }
          setError(null);
          setFiles(dropped);
        }}
      >
        {t("Drop files here or choose files")}
        <input
          aria-label={t("Choose files")}
          className="block"
          type="file"
          multiple
          disabled={busy || !ingestion?.canStart}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
        <span className="mt-2 block">{t("Choose folder (for raw/ and nested files)")}</span>
        <input
          aria-label={t("Choose folder")}
          className="block"
          type="file"
          multiple
          ref={(input) => input?.setAttribute("webkitdirectory", "")}
          disabled={busy || !ingestion?.canStart}
          onChange={(event) => {
            const selected = droppedUploadFiles({ items: [], files: event.target.files ?? [] });
            setFiles(selected ?? []);
            setError(
              selected === null
                ? t("This folder could not be read. Choose folder again and select raw/.")
                : null,
            );
          }}
        />
      </label>
      {files.length > 0 && (
        <p className="text-xs">
          {t("{count} files selected", { count: files.length })} ·{" "}
          {files.slice(0, 3).map(uploadPath).join(", ")}
          {files.length > 3 ? "…" : ""}
        </p>
      )}
      <textarea
        aria-label={t("Public HTTPS URLs")}
        placeholder={t("Paste public HTTPS URLs, one per line")}
        className="w-full rounded border bg-background p-2 text-sm"
        rows={2}
        value={urls}
        disabled={busy || !ingestion?.canStart}
        onChange={(event) => setUrls(event.target.value)}
      />
      <Input
        nativeInput
        aria-label={t("Missing knowledge")}
        placeholder={t("Optional note about missing knowledge")}
        disabled={busy || !ingestion?.canStart}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <Button
        size="sm"
        disabled={
          busy || !ingestion?.canStart || (!files.length && !sourceUrls.length && !note.trim())
        }
        onClick={() => void start()}
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
    <section aria-label={t("Organization import")} className="space-y-3 rounded-xl border p-4">
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
            className="block rounded border border-dashed p-3 text-sm"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!busy && canPreview) void selectFile(name, event.dataTransfer.files[0]);
            }}
          >
            {name}.yaml · {fileNames[name] ?? t("Drop or choose a YAML file")}
            <input
              className="block text-xs"
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
