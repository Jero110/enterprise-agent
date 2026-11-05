import { useNavigate } from "@tanstack/react-router";
import { Building2Icon } from "lucide-react";
import { useState } from "react";

import { useEnterpriseStatus } from "~/state/enterprise";
import { Button } from "../ui/button";
import { ConnectEnterpriseDialog } from "./ConnectEnterpriseDialog";

/** Connect Enterprise until connected, then who the hub says you are, linking to Settings → Enterprise. */
export function EnterpriseHeaderButton() {
  const { environmentId, identity } = useEnterpriseStatus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (environmentId === null) return null;
  return (
    <>
      <Button
        className="[-webkit-app-region:no-drag]"
        size="xs"
        variant="ghost"
        onClick={() => (identity ? void navigate({ to: "/settings/enterprise" }) : setOpen(true))}
      >
        <Building2Icon className="size-3.5" />
        {identity
          ? `${identity.displayName} · ${identity.teamName ?? "No team"} · ${identity.role}`
          : "Connect Enterprise"}
      </Button>
      <ConnectEnterpriseDialog environmentId={environmentId} open={open} onOpenChange={setOpen} />
    </>
  );
}
