import { useNavigate } from "@tanstack/react-router";
import { Building2Icon } from "lucide-react";
import { useState } from "react";

import { t } from "~/i18n";
import { useEnterpriseStatus } from "~/state/enterprise";
import { Button } from "../ui/button";
import { ConnectEnterpriseDialog } from "./ConnectEnterpriseDialog";

/** Join your team until connected, then who the hub says you are, linking to Settings → Enterprise. */
export function EnterpriseHeaderButton() {
  const { environmentId, identity } = useEnterpriseStatus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (environmentId === null) return null;
  // The sidebar header is narrow: the label truncates and the tooltip keeps the full line.
  const summary = identity
    ? `${identity.displayName} · ${identity.teamName ?? t("No team")} · ${t(identity.role, undefined, "role")}`
    : t("Join your team");
  return (
    <>
      <Button
        className="min-w-0 [-webkit-app-region:no-drag]"
        size="xs"
        variant="ghost"
        title={summary}
        onClick={() => (identity ? void navigate({ to: "/settings/enterprise" }) : setOpen(true))}
      >
        <Building2Icon className="size-3.5 shrink-0" />
        <span className="truncate">{identity ? summary : t("Join team")}</span>
      </Button>
      <ConnectEnterpriseDialog environmentId={environmentId} open={open} onOpenChange={setOpen} />
    </>
  );
}
