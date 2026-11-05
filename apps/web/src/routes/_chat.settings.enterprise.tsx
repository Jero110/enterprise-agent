import { createFileRoute } from "@tanstack/react-router";
import { EnterpriseSettingsPanel } from "../components/settings/EnterpriseSettingsPanel";

export const Route = createFileRoute("/_chat/settings/enterprise")({
  component: EnterpriseSettingsPanel,
});
