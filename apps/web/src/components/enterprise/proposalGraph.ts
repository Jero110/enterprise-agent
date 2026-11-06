import type { KnowledgeProposal } from "@t3tools/contracts";

type Team = { readonly id: string; readonly name: string };

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
          ? "Company"
          : proposal.scope === "personal"
            ? `Personal · ${proposal.recipient ?? proposal.proposedBy}`
            : (teamNames.get(proposal.scope) ?? proposal.scope);
      return {
        id: `proposal:${proposal.id}`,
        proposalId: proposal.id,
        groupId,
        groupLabel,
        title:
          proposal.kind === "upload"
            ? proposal.files?.map((file) => file.name).join(", ") || "File upload"
            : proposal.path || proposal.kind,
      };
    });
}
