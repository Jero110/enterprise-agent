import { describe, expect, it } from "vite-plus/test";
import type { EnterpriseOrgTeam } from "@t3tools/contracts";
import { areaDestinations, ingestStartError } from "./ingestDestinations";

describe("areaDestinations", () => {
  it("shows only the member's enrolled and granted areas, even for an admin", () => {
    const teams = [
      { id: "risk", name: "Risk", access: "member" },
      { id: "sales", name: "Sales", access: "granted" },
      { id: "platform", name: "Platform", access: "none" },
    ] as EnterpriseOrgTeam[];
    expect(areaDestinations(teams)).toEqual([
      { id: "risk", name: "Risk" },
      { id: "sales", name: "Sales" },
    ]);
  });

  it("explains a failed GitHub repository import without claiming HTML was ingested", () => {
    expect(
      ingestStartError("Schema validation failed", ["https://github.com/mellamanelpoeta/kavak-kb"]),
    ).toContain("No repository files were imported");
    expect(ingestStartError("Schema validation failed", ["https://example.com/notes.txt"])).toBe(
      "Schema validation failed",
    );
  });
});
