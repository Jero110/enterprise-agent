import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { useId, useState } from "react";

import { enterpriseEnvironment, enterpriseFailureMessage } from "~/state/enterprise";
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
  const [pairingCode, setPairingCode] = useState("");
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const connect = useAtomCommand(enterpriseEnvironment.connect, {
    label: "connect enterprise",
    reportFailure: false,
  });
  const ready = [hubUrl, pairingCode, email, token].every((value) => value.trim().length > 0);

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setHubUrl("");
      setPairingCode("");
      setEmail("");
      setToken("");
      setError(null);
    }
  };
  const submit = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    const result = await connect({
      environmentId,
      input: {
        link: { url: hubUrl.trim(), pairingCode: pairingCode.trim(), access: "read-only" },
        email: email.trim(),
        token: token.trim(),
      },
    });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: `Connected as ${result.value.displayName}`,
        description: [result.value.teamName, result.value.role].filter(Boolean).join(" · "),
      });
      handleOpenChange(false);
    } else if (!isAtomCommandInterrupted(result)) {
      setError(enterpriseFailureMessage(squashAtomCommandFailure(result)));
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Enterprise</DialogTitle>
          <DialogDescription>
            Sign in to your company's hub with your work email and the enterprise token. Without
            connecting, everything here works as before. Needs Linked environments on in Settings →
            Labs.
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
              <span className="block text-xs font-medium text-foreground">Hub address</span>
              <Input
                value={hubUrl}
                onChange={(event) => setHubUrl(event.target.value)}
                placeholder="https://hub.example.ts.net"
                disabled={busy}
                autoFocus
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Pairing code</span>
              <Input
                value={pairingCode}
                onChange={(event) => setPairingCode(event.target.value)}
                placeholder="From the hub's Connections, or t3 pair there"
                disabled={busy}
                autoComplete="one-time-code"
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
