import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolveEnterpriseHubOrigin } from "@t3tools/shared/remote";
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import {
  readEnvironment,
  useEnvironment,
  useEnvironmentHttpBaseUrl,
  useEnvironments,
} from "~/state/environments";
import { enterpriseEnvironment, enterpriseFailureMessage } from "~/state/enterprise";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { t } from "~/i18n";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

export function ConnectEnterpriseDialog({
  environmentId,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [hubUrlInput, setHubUrlInput] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const connect = useAtomCommand(enterpriseEnvironment.connect, {
    label: "connect enterprise",
    reportFailure: false,
  });
  const environment = useEnvironment(environmentId);
  const status = useEnvironmentQuery(enterpriseEnvironment.status({ environmentId, input: {} }));
  const configured =
    environment?.serverConfig?.environment.capabilities.enterpriseOnboarding === true ||
    status.data?.configured === true;
  // A hub you reached through a pair link already is the environment: no URL to ask for.
  const { environments } = useEnvironments();
  const pairedHub = configured
    ? undefined
    : environments.find(
        (candidate) =>
          candidate.environmentId !== environmentId &&
          candidate.serverConfig?.environment.capabilities.enterpriseOnboarding === true,
      );
  const pairedHubBaseUrl = useEnvironmentHttpBaseUrl(pairedHub?.environmentId ?? null);
  const knownHubUrl = pairedHubBaseUrl ?? undefined;
  const ownUrl = environment?.displayUrl?.startsWith("http")
    ? environment.displayUrl
    : window.desktopBridge
      ? undefined
      : window.location.origin;
  const hubUrl = hubUrlInput ?? "";
  const ready = email.trim().length > 0 && hubUrl.trim().length > 0;

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setHubUrlInput(null);
      setToken("");
      setEmail("");
      setError(null);
    }
  };
  const submit = async () => {
    if (busy || !ready) return;
    let origin: string | undefined;
    const tokenless = token.trim().length === 0;
    try {
      origin = resolveEnterpriseHubOrigin(hubUrl, { tokenless });
      const isOwnHost = configured && ownUrl !== undefined && URL.parse(ownUrl)?.origin === origin;
      if (isOwnHost) {
        origin = undefined;
      } else if (!configured) {
        if (knownHubUrl === undefined) {
          const destination = readEnvironment(environmentId)?.displayUrl;
          if (destination?.startsWith("http"))
            resolveEnterpriseHubOrigin(destination, { tokenless });
          else if (!window.desktopBridge)
            resolveEnterpriseHubOrigin(window.location.origin, { tokenless });
        }
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : t("Check the team address."));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await connect({
      environmentId,
      input: {
        ...(origin === undefined ? {} : { hubUrl: origin }),
        email: email.trim(),
        ...(token.trim().length > 0 ? { token: token.trim() } : {}),
      },
    });
    if (result._tag === "Success") {
      setToken("");
      setBusy(false);
      toastManager.add({
        type: "success",
        title: t("Connected as {name}", { name: result.value.displayName }),
        description: [result.value.teamName, result.value.role].filter(Boolean).join(" · "),
      });
      handleOpenChange(false);
    } else {
      setBusy(false);
      if (!isAtomCommandInterrupted(result))
        setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Join your team")}</DialogTitle>
          <DialogDescription>
            {t(
              "Your admin gives you the team address. Your name, area and permissions load on their own.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">{t("Team address")}</span>
              <Input
                type="url"
                value={hubUrl}
                onChange={(event) => setHubUrlInput(event.target.value)}
                placeholder="http://192.168.0.10:13779"
                disabled={busy}
                autoFocus
                nativeInput
                spellCheck={false}
              />
              <span className="block text-xs text-muted-foreground">
                {t("Your admin gives you this, for example http://192.168.0.10:13779")}
              </span>
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">
                {t("Your work email")}
              </span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("you@company.com")}
                disabled={busy}
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">
                {t("Invite code (optional)")}
              </span>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
                nativeInput
                spellCheck={false}
              />
              <span className="block text-xs text-muted-foreground">
                {t("Only if your admin gave you one.")}
              </span>
            </label>
            {error ? (
              <p role="alert" className="text-xs text-destructive-foreground">
                {error}
              </p>
            ) : null}
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose disabled={busy} render={<Button variant="outline" type="button" />}>
            {t("Cancel")}
          </DialogClose>
          <Button form={formId} type="submit" disabled={busy || !ready}>
            {busy ? t("Joining…") : t("Join")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
