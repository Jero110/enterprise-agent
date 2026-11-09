import type { EnvironmentId } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { enterpriseEnvironment, enterpriseFailureMessage } from "~/state/enterprise";
import { t } from "~/i18n";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/** Switches which version of the company wiki every reader sees; the hub allows admins only. */
export function WikiVersionSelect({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const version = useEnvironmentQuery(
    enterpriseEnvironment.knowledgeWikiVersion({ environmentId, input: {} }),
  );
  const activate = useAtomCommand(enterpriseEnvironment.knowledgeWikiActivate, {
    label: "activate wiki version",
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const available = version.data?.available ?? [];
  if (available.length === 0) return null;
  const select = async (next: string) => {
    setBusy(true);
    const result = await activate({ environmentId, input: { version: next } });
    setBusy(false);
    if (result._tag === "Success") {
      toastManager.add({
        type: "success",
        title: t("Wiki {version} is active", { version: next }),
      });
      return;
    }
    if (!isAtomCommandInterrupted(result))
      toastManager.add({
        type: "error",
        title: t("Could not switch the wiki"),
        description: enterpriseFailureMessage(squashAtomCommandFailure(result)),
      });
  };
  return (
    <div className="flex items-center gap-2" aria-label={t("Knowledge version")}>
      <span className="text-xs text-muted-foreground">{t("Knowledge version")}</span>
      <span className="text-xs font-medium">
        {version.data?.active ? t("Active: {version}", { version: version.data.active }) : null}
      </span>
      {available.map((name) => (
        <Button
          key={name}
          size="xs"
          disabled={busy}
          variant={version.data?.active === name ? "default" : "outline"}
          aria-pressed={version.data?.active === name}
          onClick={() => void select(name)}
        >
          {name}
        </Button>
      ))}
    </div>
  );
}
