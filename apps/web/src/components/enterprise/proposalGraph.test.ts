import { describe, expect, it } from "vite-plus/test";
import type { KnowledgeProposal } from "@t3tools/contracts";
import { pendingGraphNodes, personName, proposalTitle } from "./proposalGraph";

const proposal = (
  id: string,
  scope: string,
  recipient?: string,
  status: KnowledgeProposal["status"] = "pending",
) =>
  ({
    id,
    scope,
    ...(recipient === undefined ? {} : { recipient }),
    status,
    kind: "upload",
    path: "",
    reason: "Review this file",
    evidence: [],
    proposedBy: "author@example.com",
    createdAt: "2026-01-01T00:00:00.000Z",
    baseContentHash: "absent",
    baseVersion: "",
    targetVersion: "",
    files: [{ id: `file-${id}`, name: `${id}.pdf`, mimeType: "application/pdf", sizeBytes: 1 }],
  }) satisfies KnowledgeProposal;

describe("pending proposal graph identity", () => {
  it("groups each area independently, splits personal recipients, and excludes resolved proposals", () => {
    const nodes = pendingGraphNodes(
      [
        proposal("a", "area-a"),
        proposal("b", "area-b"),
        proposal("c", "personal", "ana@example.com"),
        proposal("d", "personal", "bruno@example.com"),
        proposal("e", "global"),
        proposal("f", "area-a", undefined, "approved-awaiting-processing"),
      ],
      [
        { id: "area-a", name: "Payments" },
        { id: "area-b", name: "Security" },
      ],
    );
    expect(nodes.map(({ id, groupId, groupLabel }) => ({ id, groupId, groupLabel }))).toEqual([
      { id: "proposal:a", groupId: "area:area-a", groupLabel: "Payments" },
      { id: "proposal:b", groupId: "area:area-b", groupLabel: "Security" },
      {
        id: "proposal:c",
        groupId: "personal:ana@example.com",
        groupLabel: "Personal · Ana",
      },
      {
        id: "proposal:d",
        groupId: "personal:bruno@example.com",
        groupLabel: "Personal · Bruno",
      },
      { id: "proposal:e", groupId: "global", groupLabel: "Company" },
    ]);
  });
});

describe("plain proposal names", () => {
  it("turns an email into a readable name", () => {
    expect(personName("ana.garcia@example.com")).toBe("Ana Garcia");
    expect(personName("luis_perez-lopez@example.com")).toBe("Luis Perez Lopez");
    expect(personName(undefined)).toBe("");
  });

  it("titles access requests by team name and documents by file name", () => {
    const teams = [{ id: "sales", name: "Ventas" }];
    expect(proposalTitle({ ...proposal("x", "sales"), kind: "area-access" }, teams)).toBe(
      "Access to Ventas",
    );
    expect(
      proposalTitle(
        { ...proposal("y", "sales"), kind: "create", path: "sales/pricing-policy.md" },
        teams,
      ),
    ).toBe("Pricing policy");
    expect(proposalTitle(proposal("z", "global"), teams)).toBe("z.pdf");
  });
});
