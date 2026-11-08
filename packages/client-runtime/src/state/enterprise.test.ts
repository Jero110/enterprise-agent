import { expect, it } from "vite-plus/test";

import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import { groupTeamThreads, selectPersonalThreads } from "./enterprise.ts";

it("keeps only the signed-in member's conversations in their personal list", () => {
  const threads = [
    { id: "legacy" },
    { id: "ana", enterpriseOwnerEmail: "ana@example.com" },
    { id: "bruno", enterpriseOwnerEmail: "bruno@example.com" },
    { id: "ana-second", enterpriseOwnerEmail: "ana@example.com" },
  ];
  expect(selectPersonalThreads(threads, "ana@example.com").map((thread) => thread.id)).toEqual([
    "ana",
    "ana-second",
  ]);
  expect(selectPersonalThreads(threads, "bruno@example.com").map((thread) => thread.id)).toEqual([
    "bruno",
  ]);
  expect(selectPersonalThreads(threads, null).map((thread) => thread.id)).toEqual(["legacy"]);
});

it("lists the whole team including yourself and members without conversations, keeping same-name owners separate", () => {
  const members = [
    {
      memberKey: teamMemberKey("ana@example.com"),
      displayName: "Ana",
      role: "lead" as const,
      isMe: true,
    },
    {
      memberKey: teamMemberKey("bruno@example.com"),
      displayName: "Bruno",
      role: "member" as const,
      isMe: false,
    },
    {
      memberKey: teamMemberKey("other-ana@example.com"),
      displayName: "Ana",
      role: "member" as const,
      isMe: false,
    },
  ];
  const summary = (email: string, status: "read-only" | "unpublished") => ({
    threadId: email,
    parentThreadId: null,
    title: "Conversation",
    status: "idle" as const,
    updatedAt: "2026-11-08T00:00:00Z",
    ownerEmail: email,
    ownerDisplayName: "Ana",
    publicationStatus: status,
  });
  const groups = groupTeamThreads(
    [
      summary("ana@example.com", "read-only"),
      summary("other-ana@example.com", "unpublished"),
      summary("another-team@example.com", "read-only"),
    ],
    members,
    "ana@example.com",
  );
  expect(groups).toHaveLength(3);
  expect(groups[0]).toMatchObject({
    displayName: "Ana",
    isMe: true,
    threads: [{ ownerEmail: "ana@example.com", publicationStatus: "read-only" }],
  });
  expect(groups[1]).toMatchObject({ displayName: "Bruno", isMe: false, threads: [] });
  expect(groups[2]).toMatchObject({
    displayName: "Ana",
    isMe: false,
    threads: [{ ownerEmail: "other-ana@example.com", publicationStatus: "unpublished" }],
  });
});
