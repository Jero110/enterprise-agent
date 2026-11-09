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
    files: ReadonlyArray<{ name: string; mimeType: string; base64: string }>,
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
    if (
      sourceUrls.length > 10 ||
      files.length > MAX_FILES ||
      files.some((file) => file.size === 0 || file.size > MAX_FILE_BYTES) ||
      files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES
    ) {
      setError(t("Choose up to 20 nonempty files (10 MiB each, 35 MiB total) or 10 URLs."));
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const staged =
        files.length > 0 && ingestion.stageUpload
          ? await ingestion.stageUpload(
              await Promise.all(
                files.map(async (file) => ({
                  name: file.name,
                  mimeType: file.type || "application/octet-stream",
                  base64: await fileBase64(file),
                })),
              ),
              destination,
            )
          : { uploadProposalIds: [] };
      await ingestion.start({
        destination,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sourceUrls.length ? { sourceUrls } : {}),
        ...(staged.uploadProposalIds.length ? { uploadProposalIds: staged.uploadProposalIds } : {}),
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
          setFiles(Array.from(event.dataTransfer.files));
        }}
      >
        {t("Drop files here or choose files")}
        <input
          className="block"
          type="file"
          multiple
          disabled={busy || !ingestion?.canStart}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
        />
      </label>
      {files.length > 0 && <p className="text-xs">{files.map((file) => file.name).join(", ")}</p>}
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
