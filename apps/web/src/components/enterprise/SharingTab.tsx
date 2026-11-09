import { useState } from "react";
import { t } from "~/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { personalPublicationPath } from "./sharingPublication";

// The hub sharing commands are integrated through this boundary when available.
export interface PersonalSharing {
  readonly ownerMemberKey?: string;
  readonly members?: ReadonlyArray<{ memberKey: string; displayName: string }>;
  readonly publish?: (input: {
    path: string;
    item: {
      kind: "skill" | "node";
      title: string;
      description: string;
      layer: "metrics" | "business" | "ai" | "data";
      content: string;
    };
    grantee: { kind: "member" | "area"; target: string };
  }) => Promise<void>;
  readonly items: ReadonlyArray<{ id: string; title: string }>;
  readonly areas: ReadonlyArray<{ id: string; name: string }>;
  readonly listShared: {
    readonly byMe: ReadonlyArray<{ id: string; title: string; recipient: string }>;
    readonly withMe: ReadonlyArray<{ id: string; title: string; owner: string }>;
  };
  readonly canShare: boolean;
  readonly canRevoke: boolean;
  readonly canUnpublish: boolean;
  readonly share: (input: {
    itemId: string;
    grantee: { kind: "member" | "area"; id: string };
  }) => Promise<void>;
  readonly revoke: (id: string) => Promise<void>;
  readonly unpublish: (itemId: string) => Promise<void>;
  readonly refresh: () => void;
}

export function SharingTab({ sharing }: { sharing?: PersonalSharing }) {
  const [itemId, setItemId] = useState("");
  const [kind, setKind] = useState<"member" | "area">("member");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      sharing?.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not update sharing"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8">
      <h2 className="text-sm font-medium">{t("Personal knowledge sharing")}</h2>
      <p className="text-sm text-muted-foreground">
        {t(
          "Share your personal skills and nodes with people or an area. Area documents are not shared here.",
        )}
      </p>
      {!sharing ? (
        <p role="status">{t("Personal sharing is not available on this hub yet.")}</p>
      ) : (
        <>
          <fieldset
            disabled={busy || !sharing.canShare}
            className="space-y-3 rounded-xl border p-4"
          >
            <legend>{t("Share a personal item")}</legend>
            <label className="block text-sm">
              {t("Personal item")}
              <select
                className="ml-2 rounded border bg-background p-1"
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="">{t("Choose an item")}</option>
                {sharing.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
            {sharing.items.length === 0 && <p>{t("No personal items yet")}</p>}
            <label className="block text-sm">
              {t("Share with")}
              <select
                className="ml-2 rounded border bg-background p-1"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value === "area" ? "area" : "member");
                  setRecipient("");
                }}
              >
                <option value="member">{t("Person")}</option>
                <option value="area">{t("Area")}</option>
              </select>
            </label>
            {kind === "member" && sharing.members ? (
              <select
                aria-label={t("Recipient member")}
                className="rounded border bg-background p-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">{t("Choose a person")}</option>
                {sharing.members.map((member) => (
                  <option key={member.memberKey} value={member.memberKey}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            ) : kind === "member" ? (
              <Input
                nativeInput
                aria-label={t("Recipient member key")}
                placeholder={t("Member key")}
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              />
            ) : (
              <select
                aria-label={t("Recipient area")}
                className="rounded border bg-background p-1"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">{t("Choose an area")}</option>
                {sharing.areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              disabled={!itemId || !recipient.trim()}
              onClick={() =>
                void run(() => sharing.share({ itemId, grantee: { kind, id: recipient.trim() } }))
              }
            >
              {t("Share")}
            </Button>
          </fieldset>
          <PersonalPublication
            sharing={sharing}
            grantee={{ kind, target: recipient.trim() }}
            busy={busy}
            run={run}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !itemId || !sharing.canUnpublish}
            onClick={() => void run(() => sharing.unpublish(itemId))}
          >
            {t("Stop sharing selected item with everyone")}
          </Button>
          <Button size="xs" variant="outline" disabled={busy} onClick={sharing.refresh}>
            {t("Refresh")}
          </Button>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("Shared by me")}</h3>
            {sharing.listShared.byMe.length === 0 && (
              <p className="text-sm">{t("Nothing shared yet")}</p>
            )}
            {sharing.listShared.byMe.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded border p-3 text-sm"
              >
                <span>
                  {item.title} · {item.recipient}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy || !sharing.canRevoke}
                  onClick={() => void run(() => sharing.revoke(item.id))}
                >
                  {t("Revoke")}
                </Button>
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("Shared with me")}</h3>
            {sharing.listShared.withMe.length === 0 && (
              <p className="text-sm">{t("Nothing shared with you yet")}</p>
            )}
            {sharing.listShared.withMe.map((item) => (
              <p key={item.id} className="rounded border p-3 text-sm">
                {item.title} · {item.owner}
              </p>
            ))}
          </section>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function PersonalPublication({
  sharing,
  grantee,
  busy,
  run,
}: {
  sharing: PersonalSharing;
  grantee: { kind: "member" | "area"; target: string };
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [itemKind, setItemKind] = useState<"skill" | "node">("skill");
  const [layer, setLayer] = useState<"metrics" | "business" | "ai" | "data">("ai");
  const [content, setContent] = useState("");
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const path = personalPublicationPath(sharing.ownerMemberKey ?? "", title);
  return (
    <section className="space-y-3">
      <fieldset
        className="space-y-3 rounded-xl border p-4"
        disabled={
          busy || reading || !sharing.canShare || !sharing.publish || !sharing.ownerMemberKey
        }
      >
        <legend>{t("Publish and share a personal copy")}</legend>
        <p className="text-sm text-muted-foreground">
          {t(
            "Choose a recipient above, then paste a skill or node, or select its file. Only this copy is published; your local original is not changed or automatically synced.",
          )}
        </p>
        <Input
          nativeInput
          aria-label={t("Publication title")}
          placeholder={t("Title, for example RAG practices")}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input
          nativeInput
          aria-label={t("Publication description")}
          placeholder={t("Description")}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <label className="block text-sm">
          {t("Item kind")}
          <select
            className="ml-2 rounded border bg-background p-1"
            value={itemKind}
            onChange={(event) => setItemKind(event.target.value === "node" ? "node" : "skill")}
          >
            <option value="skill">{t("Skill")}</option>
            <option value="node">{t("Node")}</option>
          </select>
        </label>
        <label className="block text-sm">
          {t("Layer")}
          <select
            className="ml-2 rounded border bg-background p-1"
            value={layer}
            onChange={(event) => {
              const next = event.target.value;
              if (next === "metrics" || next === "business" || next === "ai" || next === "data")
                setLayer(next);
            }}
          >
            <option value="metrics">{t("Metrics")}</option>
            <option value="business">{t("Business")}</option>
            <option value="ai">AI</option>
            <option value="data">{t("Data")}</option>
          </select>
        </label>
        <label className="block text-sm">
          {t("Select a Markdown or text file (optional)")}
          <input
            type="file"
            accept=".md,.txt,text/plain,text/markdown"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setFileError(null);
              if (file.size > 200_000) {
                setFileError(t("File exceeds 200 KB"));
                return;
              }
              setReading(true);
              try {
                setContent(await file.text());
                setPublished(false);
              } catch {
                setFileError(t("Could not read file"));
              } finally {
                setReading(false);
              }
            }}
          />
        </label>
        <Textarea
          aria-label={t("Personal copy content")}
          placeholder={t("Paste the content to publish")}
          maxLength={200_000}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setPublished(false);
          }}
        />
        {fileError && (
          <p role="alert" className="text-sm text-destructive">
            {fileError}
          </p>
        )}
        <Button
          size="sm"
          disabled={
            !path || !content.trim() || !grantee.target || content.length > 200_000 || !!fileError
          }
          onClick={() =>
            void run(async () => {
              const publish = sharing.publish;
              if (!publish || !path) return;
              if (sharing.items.some((item) => item.id === path))
                throw new Error(
                  t(
                    "An item with this title is already published. Choose a different title to avoid replacing it.",
                  ),
                );
              setPublished(false);
              await publish({
                path,
                item: {
                  kind: itemKind,
                  title: title.trim(),
                  description: description.trim(),
                  layer,
                  content,
                },
                grantee,
              });
              setPublished(true);
            })
          }
        >
          {t("Publish copy and share")}
        </Button>
      </fieldset>
      {!sharing.publish && (
        <p className="text-sm text-muted-foreground">
          {t("Publishing personal copies is not available on this hub yet.")}
        </p>
      )}
      {published && (
        <p role="status" className="text-sm">
          {t("Personal copy published and shared. Your local original is unchanged.")}
        </p>
      )}
    </section>
  );
}
