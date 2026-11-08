import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  BearerConnectionRegistration,
  BearerConnectionCredential,
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { resolveEnterpriseHubOrigin } from "@t3tools/shared/remote";
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { readEnvironment } from "~/state/environments";
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
  const [hubUrl, setHubUrl] = useState("");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const connect = useAtomCommand(enterpriseEnvironment.connect, {
    label: "connect enterprise",
    reportFailure: false,
  });
  const register = useAtomCommand(environmentCatalog.register, { reportFailure: false });
  const status = useEnvironmentQuery(enterpriseEnvironment.status({ environmentId, input: {} }));
  const configured = status.data?.configured === true;
  const ready =
    email.trim().length > 0 && token.trim().length > 0 && (configured || hubUrl.trim().length > 0);

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setHubUrl("");
      setToken("");
      setEmail("");
      setError(null);
    }
  };
  const submit = async () => {
    if (busy || !ready) return;
    let origin: string | undefined;
    try {
      if (!configured) {
        origin = resolveEnterpriseHubOrigin(hubUrl);
        const destination = readEnvironment(environmentId)?.displayUrl;
        if (destination?.startsWith("http")) resolveEnterpriseHubOrigin(destination);
        else if (!window.desktopBridge) resolveEnterpriseHubOrigin(window.location.origin);
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
        token: token.trim(),
      },
    });
    if (result._tag === "Success") {
      const access = result.value.environmentAccess;
      if (access) {
        const connectionId = `bearer:${access.environmentId}:${access.httpBaseUrl}`;
        const saved = await register(
          new BearerConnectionRegistration({
            target: new BearerConnectionTarget({
              environmentId: access.environmentId,
              label: access.label,
              connectionId,
            }),
            profile: new BearerConnectionProfile({
              environmentId: access.environmentId,
              label: access.label,
              connectionId,
              httpBaseUrl: `${access.httpBaseUrl}/`,
              wsBaseUrl: `${access.httpBaseUrl.replace(/^http/, "ws")}/`,
            }),
            credential: new BearerConnectionCredential({ token: access.token }),
          }),
        );
        if (saved._tag !== "Success") {
          setBusy(false);
          setError(
            "Enterprise connected, but the environment could not be saved. Connect again to retry.",
          );
          return;
        }
      }
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
            {configured
              ? "Sign in to this environment’s Enterprise with your email and Enterprise token. Your name, team and permissions load automatically."
              : "Connect with your Enterprise environment URL, email and Enterprise token."}
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
            {!configured && (
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-foreground">Environment URL</span>
                <Input
                  type="url"
                  value={hubUrl}
                  onChange={(event) => setHubUrl(event.target.value)}
                  placeholder="https://hub.example.com/pair#token=…"
                  disabled={busy}
                  autoFocus
                  nativeInput
                  spellCheck={false}
                />
              </label>
            )}
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Email</span>
              <Input
                type="email"
                autoFocus={configured}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={busy}
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Enterprise token</span>
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
