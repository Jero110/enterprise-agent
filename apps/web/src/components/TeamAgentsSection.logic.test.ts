import { describe, expect, it } from "vite-plus/test";

import { nestSubagentThreads } from "./TeamAgentsSection.logic";

const thread = (threadId: string, parentThreadId: string | null = null) => ({
  threadId,
  parentThreadId,
});

const flatten = (threads: ReturnType<typeof thread>[]) =>
  nestSubagentThreads(threads).map((entry) => `${entry.depth}:${entry.summary.threadId}`);

describe("nestSubagentThreads", () => {
  it("puts each subagent chat right after its parent, one level deeper", () => {
    expect(
      flatten([
        thread("a"),
        thread("b"),
        thread("a1", "a"),
        thread("a1x", "a1"),
        thread("b1", "b"),
      ]),
    ).toEqual(["0:a", "1:a1", "2:a1x", "0:b", "1:b1"]);
  });

  it("keeps a subagent chat whose parent is not shared at the top level", () => {
    expect(flatten([thread("a"), thread("orphan", "missing")])).toEqual(["0:a", "0:orphan"]);
  });

  it("lists chats caught in a parent loop instead of dropping them", () => {
    expect(flatten([thread("x", "y"), thread("y", "x")])).toEqual(["0:x", "1:y"]);
  });
});
