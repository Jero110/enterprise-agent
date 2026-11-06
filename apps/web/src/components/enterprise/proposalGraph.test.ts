import { describe, expect, it } from "vite-plus/test";
import type { KnowledgeProposal } from "@t3tools/contracts";
import { pendingGraphNodes } from "./proposalGraph";

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
        groupLabel: "Personal · ana@example.com",
      },
      {
        id: "proposal:d",
        groupId: "personal:bruno@example.com",
        groupLabel: "Personal · bruno@example.com",
      },
      { id: "proposal:e", groupId: "global", groupLabel: "Company" },
    ]);
  });
});
