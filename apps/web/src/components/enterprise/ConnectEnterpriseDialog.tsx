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
import { parseEnterpriseInvite } from "./invite";

export function ConnectEnterpriseDialog({
  environmentId,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [invite, setInvite] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const connect = useAtomCommand(enterpriseEnvironment.connect, {
    label: "connect enterprise",
    reportFailure: false,
  });
  const ready = email.trim().length > 0 && invite.trim().length > 0;

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
    if (!next) {
      setInvite("");
      setEmail("");
      setError(null);
    }
  };
  const submit = async () => {
    if (busy || !ready) return;
    const credentials = parseEnterpriseInvite(invite);
    if (credentials === null) {
      setError("Invalid Enterprise invite. Ask an admin for a fresh one.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await connect({
      environmentId,
      input: {
        link: credentials.link,
        email: email.trim(),
        token: credentials.token,
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
            Enter your work email and the Enterprise invite from your admin. Each invite works for
            one connection. Linked environments must be on in Settings → Labs.
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
              <span className="block text-xs font-medium text-foreground">Email</span>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                disabled={busy}
                autoFocus
                nativeInput
                spellCheck={false}
              />
            </label>
            <label className="block space-y-1.5">
              <span className="block text-xs font-medium text-foreground">Enterprise invite</span>
              <Input
                type="password"
                value={invite}
                onChange={(event) => setInvite(event.target.value)}
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
