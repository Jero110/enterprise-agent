import { describe, expect, it } from "vite-plus/test";
import { personalPublicationPath } from "./sharingPublication";

describe("personal publication paths", () => {
  it("keeps explicit publications in the owner's namespace with safe title slugs", () => {
    const owner = "a".repeat(64);
    expect(personalPublicationPath(owner, "RAG: María's practices")).toBe(
      `personal/${owner}/rag-maria-s-practices.md`,
    );
    expect(personalPublicationPath(owner, "../../sales/promotions")).toBe(
      `personal/${owner}/sales-promotions.md`,
    );
    expect(personalPublicationPath("../sales", "RAG")).toBeNull();
    expect(personalPublicationPath(owner, " ../ ")).toBeNull();
    expect(personalPublicationPath(owner, "x".repeat(200))).toBe(
      `personal/${owner}/${"x".repeat(80)}.md`,
    );
  });
});
