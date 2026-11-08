import { expect, it } from "@effect/vitest";
import {
  EnterpriseError,
  EnvironmentId,
  ProviderInstanceId,
  ThreadId,
  type EnterpriseIdentity,
  type TeamThreadSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { EnterpriseClient } from "./EnterpriseClient.ts";
import { EnterpriseTeamToolkit, layer } from "./EnterpriseTeamToolkit.ts";

const member: EnterpriseIdentity = {
  email: "member@example.com",
  displayName: "Member",
  teamId: "engineering",
  teamName: "Engineering",
  role: "member",
  hubEnvironmentId: EnvironmentId.make("hub"),
};
const summary: TeamThreadSummary = {
  threadId: "shared",
  parentThreadId: null,
  title: "Shared work",
  ownerEmail: "owner@example.com",
  ownerDisplayName: "Owner",
  status: "idle",
  updatedAt: "2026-11-08T00:00:00Z",
  publicationStatus: "read-only",
};
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("member"),
  capabilities: new Set(),
  issuedAt: 0,
  requestNamespace: "team-test",
  client: undefined,
  thread: {
    threadId: ThreadId.make("caller"),
    providerInstanceId: ProviderInstanceId.make("codex"),
    providerSessionId: "session",
  },
};
const caller = liveThreadShell(ThreadId.make("caller"));
const handlers = (
  client: Partial<EnterpriseClient["Service"]>,
  shell: typeof caller | null = caller,
) =>
  McpToolAccess.HandlersLayer.layer(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(EnterpriseClient)({ status: Effect.succeed({ identity: member }), ...client }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
        }),
      ),
    ),
  );

it.effect(
  "uses the environment identity, pages published summaries, and preserves hub denials",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* EnterpriseTeamToolkit;
      const first = yield* toolkit
        .handle("enterprise_team_list", {})
        .pipe(Stream.unwrap, Stream.runCollect);
      const result = first.at(-1)?.result;
      expect(result).toMatchObject({ ok: true, value: { identity: member, nextCursor: 100 } });
      if (result !== undefined && "ok" in result && result.ok) {
        expect(result.value.threads).toHaveLength(100);
        expect(
          result.value.threads.every((thread) => thread.publicationStatus === "read-only"),
        ).toBe(true);
      }
      const tail = yield* toolkit
        .handle("enterprise_team_list", { cursor: 100 })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(tail.at(-1)?.result).toEqual({
        ok: true,
        value: { identity: member, threads: [summary], nextCursor: null },
      });
      const denied = yield* toolkit
        .handle("enterprise_team_get", { ownerEmail: "other@example.com", threadId: "private" })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(denied.at(-1)?.result).toEqual({
        ok: false,
        code: "access_denied",
        message: "Not accessible.",
      });
    }).pipe(
      Effect.provide(
        handlers({
          teamList: Effect.succeed([
            { ...summary, title: "Private title", publicationStatus: "unpublished" },
            ...Array.from({ length: 101 }, () => summary),
          ]),
          teamGet: () =>
            Effect.fail(new EnterpriseError({ code: "access_denied", message: "Not accessible." })),
        }),
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    ),
);

it.effect("bounds message pages and continues long messages without losing text", () => {
  const messages = Array.from({ length: 105 }, (_, index) => ({
    role: "assistant" as const,
    text: index === 0 ? "x".repeat(120_001) : `message ${index}`,
    createdAt: "2026-11-08T00:00:00Z",
  }));
  return Effect.gen(function* () {
    const toolkit = yield* EnterpriseTeamToolkit;
    const restored: typeof messages = [];
    let messageOffset = 0;
    let textOffset = 0;
    let pages = 0;
    for (;;) {
      const page = yield* toolkit
        .handle("enterprise_team_get", {
          ownerEmail: summary.ownerEmail,
          threadId: summary.threadId,
          messageOffset,
          textOffset,
        })
        .pipe(Stream.unwrap, Stream.runCollect);
      const result = page.at(-1)?.result;
      expect(result).toMatchObject({ ok: true, value: { identity: member, summary } });
      if (result === undefined || !("ok" in result) || !result.ok)
        throw new Error("Expected team page");
      expect(result.value.messages.length).toBeLessThanOrEqual(100);
      expect(
        result.value.messages.reduce((size, message) => size + message.text.length, 0),
      ).toBeLessThanOrEqual(50_000);
      for (const [index, message] of result.value.messages.entries()) {
        const previous = restored[messageOffset + index];
        restored[messageOffset + index] = {
          ...message,
          role: "assistant",
          text: (previous?.text ?? "") + message.text,
        };
      }
      pages += 1;
      if (result.value.nextMessageOffset === null) break;
      messageOffset = result.value.nextMessageOffset;
      textOffset = result.value.nextTextOffset ?? 0;
    }
    expect(pages).toBe(4);
    expect(restored).toEqual(messages);
  }).pipe(
    Effect.provide(handlers({ teamGet: () => Effect.succeed({ summary, messages }) })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
  );
});

it.effect(
  "refuses missing identity, unpublished snapshots, and inactive or mismatched callers",
  () =>
    Effect.gen(function* () {
      for (const [invocation, shell, identity, expected] of [
        [{ ...scope, thread: undefined }, caller, member, "thread_credential_required"],
        [scope, null, member, "thread_not_found"],
        [scope, { ...caller, deletedAt: caller.createdAt }, member, "thread_not_found"],
        [scope, { ...caller, archivedAt: caller.createdAt }, member, "parent_not_active"],
        [scope, { ...caller, activeRunId: null }, member, "parent_not_active"],
        [
          scope,
          { ...caller, providerInstanceId: ProviderInstanceId.make("other") },
          member,
          "parent_not_active",
        ],
        [scope, caller, null, "not_connected"],
        [scope, caller, member, "access_denied"],
      ] as const) {
        yield* Effect.gen(function* () {
          const toolkit = yield* EnterpriseTeamToolkit;
          const denied = yield* toolkit
            .handle("enterprise_team_get", {
              ownerEmail: summary.ownerEmail,
              threadId: summary.threadId,
            })
            .pipe(Stream.unwrap, Stream.runCollect);
          expect(denied.at(-1)?.result).toMatchObject({ code: expected });
          if (expected !== "access_denied") {
            const listed = yield* toolkit
              .handle("enterprise_team_list", {})
              .pipe(Stream.unwrap, Stream.runCollect);
            expect(listed.at(-1)?.result).toMatchObject({ code: expected });
          }
        }).pipe(
          Effect.provide(
            handlers(
              {
                status: Effect.succeed({ identity }),
                teamList: Effect.die("Unauthorized team list"),
                teamGet: () =>
                  expected === "access_denied"
                    ? Effect.succeed({
                        summary: { ...summary, publicationStatus: "unpublished" },
                        messages: [],
                      })
                    : Effect.die("Unauthorized team get"),
              },
              shell,
            ),
          ),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        );
      }
    }),
);
