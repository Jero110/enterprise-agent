import type { KnowledgeProposal } from "@t3tools/contracts";
import { t } from "~/i18n";

type Team = { readonly id: string; readonly name: string };

/**
 * Flag shared by KnowledgeMap and ContextChanges: shows the 3D map with the real lists beside it.
 * Set to false to show only the lists.
 */
export const SHOW_KNOWLEDGE_GRAPH: boolean = true;

/** Readable name from an email: "ana.garcia@x.com" becomes "Ana Garcia". Org members have no other name field. */
export function personName(email: string | undefined): string {
  if (!email) return "";
  const local = email.split("@", 1)[0] ?? "";
  const words = local.split(/[._-]+/).filter(Boolean);
  if (words.length === 0) return email;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function areaName(scope: string, teams: ReadonlyArray<Team>): string {
  if (scope === "global") return t("Company");
  if (scope === "personal") return t("Personal");
  return teams.find((team) => team.id === scope)?.name ?? scope;
}

/** Plain title for a proposal: "Access to Sales", file names, or the document name without ".md". */
export function proposalTitle(proposal: KnowledgeProposal, teams: ReadonlyArray<Team>): string {
  if (proposal.kind === "area-access")
    return t("Access to {area}", { area: areaName(proposal.scope, teams) });
  if (proposal.kind === "upload")
    return proposal.files?.map((file) => file.name).join(", ") || t("File upload");
  const segment = proposal.path.split("/").filter(Boolean).pop() ?? "";
  const name = segment.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  if (!name) return proposal.kind;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Display name of the place a proposal lands: team name, Company or Personal. */
export function proposalAreaName(proposal: KnowledgeProposal, teams: ReadonlyArray<Team>): string {
  return areaName(proposal.scope, teams);
}

export function pendingGraphNodes(
  proposals: ReadonlyArray<KnowledgeProposal>,
  teams: ReadonlyArray<Team>,
) {
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  return proposals
    .filter((proposal) => proposal.status === "pending")
    .map((proposal) => {
      const groupId =
        proposal.scope === "global"
          ? "global"
          : proposal.scope === "personal"
            ? `personal:${proposal.recipient ?? proposal.proposedBy}`
            : `area:${proposal.scope}`;
      const groupLabel =
        proposal.scope === "global"
          ? t("Company")
          : proposal.scope === "personal"
            ? t("Personal · {who}", { who: personName(proposal.recipient ?? proposal.proposedBy) })
            : (teamNames.get(proposal.scope) ?? proposal.scope);
      return {
        id: `proposal:${proposal.id}`,
        proposalId: proposal.id,
        groupId,
        groupLabel,
        title: proposalTitle(proposal, teams),
      };
    });
}
