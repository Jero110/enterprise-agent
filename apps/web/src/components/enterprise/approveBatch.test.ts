import { describe, expect, it } from "vite-plus/test";
import { approveBatch } from "./approveBatch";

describe("approveBatch", () => {
  it("approves the selected proposals in order and stops on failure", async () => {
    const applied: string[] = [];
    const result = await approveBatch(["one", "two", "three"], async (id) => {
      if (id === "two") return false;
      applied.push(id);
      return true;
    });
    expect(applied).toEqual(["one"]);
    expect(result).toEqual({ approved: ["one"], failed: "two" });
  });
});
