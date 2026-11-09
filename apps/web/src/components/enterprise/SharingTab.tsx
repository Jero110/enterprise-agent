import { useState } from "react";
import { t } from "~/i18n";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

// The hub sharing commands are integrated through this boundary when available.
export interface PersonalSharing {
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
            {kind === "member" ? (
              <Input
                nativeInput
                aria-label={t("Recipient email")}
                type="email"
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
