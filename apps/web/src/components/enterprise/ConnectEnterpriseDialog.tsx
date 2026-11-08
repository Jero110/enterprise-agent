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
      setError(error instanceof Error ? error.message : "Enter a secure environment URL.");
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
        title: `Connected as ${result.value.displayName}`,
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
          <DialogTitle>Connect Enterprise</DialogTitle>
          <DialogDescription>
            Connect with your Enterprise host URL and work email. Your name, team and permissions
            load automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-3"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Host URL</span>
              <Input
                type="url"
                value={hubUrl}
                onChange={(event) => setHubUrlInput(event.target.value)}
                placeholder="https://hub.example.com/pair#token=…"
                disabled={busy}
                autoFocus
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Email</span>
              <Input
                type="email"

                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={busy}
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">
                Enterprise token (optional)
              </span>
              <Input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                disabled={busy}
                nativeInput
                spellCheck={false}
              />
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
            Cancel
          </DialogClose>
          <Button form={formId} type="submit" disabled={busy || !ready}>
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
