import { expect, it } from "@effect/vitest";
import {
  EnterpriseError,
  ProviderInstanceId,
  ThreadId,
  EnvironmentId,
  EnterpriseCliThreadReadInput,
  type TeamThreadSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { McpSchema } from "effect/ai";
import { readEnterpriseThread } from "../cli/enterprise.ts";
import { type ThreadTools, ThreadToolFailedError } from "../cli/thread.ts";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { EnterpriseClient } from "./EnterpriseClient.ts";
import { layer, EnterpriseCliToolkit } from "./EnterpriseCliToolkit.ts";

const decodeReadInput = Schema.decodeUnknownEffect(EnterpriseCliThreadReadInput);

it.effect("lists only published conversations and preserves hub read denials", () => {
  const summary: TeamThreadSummary = {
    ownerEmail: "owner@example.com",
    ownerDisplayName: "Owner",
    threadId: "shared",
    parentThreadId: null,
    title: "Shared work",
    status: "idle",
    updatedAt: "2026-11-08T00:00:00Z",
    publicationStatus: "read-only",
  };
  return Effect.gen(function* () {
    const toolkit = yield* EnterpriseCliToolkit;
    const listed = yield* toolkit
      .handle("t3_cli_enterprise_thread_list", {})
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(listed.at(-1)?.result).toEqual({
      ok: true,
      value: { threads: [summary], nextCursor: null },
    });
    const denied = yield* toolkit
      .handle("t3_cli_enterprise_thread_get", {
        ownerEmail: "other@example.com",
        threadId: "private",
      })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(denied.at(-1)?.result).toMatchObject({ ok: false, code: "access_denied" });
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(EnterpriseClient)({
              teamList: Effect.succeed([
                summary,
                {
                  ...summary,
                  threadId: "private",
                  title: "Private title",
                  publicationStatus: "unpublished",
                },
              ]),
              teamGet: () =>
                Effect.fail(
                  new EnterpriseError({ code: "access_denied", message: "Not accessible." }),
                ),
            }),
          ),
        ),
      ),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("member"),
      capabilities: new Set<McpInvocationContext.McpCapability>(),
      issuedAt: 0,
      requestNamespace: "cli",
      thread: undefined,
      client: { sessionId: "cli", label: "t3 enterprise cli", access: "read-only" },
    }),
  );
});

it.effect("hides CLI transport from providers and refuses non-CLI or linked sessions", () =>
  Effect.gen(function* () {
    const toolkit = yield* EnterpriseCliToolkit;
    const base: McpInvocationContext.McpInvocationScope = {
      environmentId: EnvironmentId.make("member"),
      capabilities: new Set(),
      issuedAt: 0,
      requestNamespace: "test",
      thread: undefined,
      client: undefined,
    };
    const client = { sessionId: "cli", label: "t3 enterprise cli", access: "read-only" as const };
    for (const [scope, visible] of [
      [{ ...base, client }, true],
      [{ ...base, client: { ...client, linked: true } }, false],
      [{ ...base, client: { ...client, label: "Other client" } }, false],
      [base, false],
      [
        {
          ...base,
          thread: {
            threadId: ThreadId.make("provider"),
            providerInstanceId: ProviderInstanceId.make("codex"),
            providerSessionId: "provider",
          },
        },
        false,
      ],
    ] as const) {
      yield* Effect.gen(function* () {
        for (const tool of Object.values(EnterpriseCliToolkit.tools)) {
          const enabled = Context.getOrUndefined(tool.annotations, McpSchema.EnabledWhen);
          expect(
            yield* Effect.sync(() =>
              enabled?.({ protocolVersion: "2025-06-18", capabilities: {} }),
            ),
          ).toBe(visible);
        }
        if (!visible) {
          const denied = yield* toolkit
            .handle("t3_cli_enterprise_thread_list", {})
            .pipe(Stream.unwrap, Stream.runCollect);
          expect(denied.at(-1)?.result).toMatchObject({ ok: false, code: "access_denied" });
        }
      }).pipe(Effect.provideService(McpInvocationContext.McpInvocationContext, scope));
    }
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(layer).pipe(
        Layer.provide(Layer.mock(EnterpriseClient)({})),
      ),
    ),
  ),
);

it.effect("bounds knowledge pages and preserves the hub's document access denial", () => {
  const document = {
    id: "global/overview.md",
    areaId: "global",
    title: "Overview",
    content: "x".repeat(50_001),
  };
  const summary = { id: document.id, areaId: document.areaId, title: document.title };
  return Effect.gen(function* () {
    const toolkit = yield* EnterpriseCliToolkit;
    const first = yield* toolkit
      .handle("t3_cli_enterprise_knowledge_list", {})
      .pipe(Stream.unwrap, Stream.runCollect);
    const result = first.at(-1)?.result;
    expect(result).toMatchObject({ ok: true, value: { nextCursor: 100 } });
    if (result !== undefined && "ok" in result && result.ok)
      expect(result.value.documents).toHaveLength(100);
    const tail = yield* toolkit
      .handle("t3_cli_enterprise_knowledge_list", { cursor: 100 })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(tail.at(-1)?.result).toEqual({
      ok: true,
      value: { documents: [summary], nextCursor: null },
    });
    const page = yield* toolkit
      .handle("t3_cli_enterprise_knowledge_get", { path: document.id })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(page.at(-1)?.result).toEqual({
      ok: true,
      value: { ...document, content: "x".repeat(50_000), nextTextOffset: 50_000 },
    });
    const last = yield* toolkit
      .handle("t3_cli_enterprise_knowledge_get", { path: document.id, textOffset: 50_000 })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(last.at(-1)?.result).toEqual({
      ok: true,
      value: { ...document, content: "x", nextTextOffset: null },
    });
    const denied = yield* toolkit
      .handle("t3_cli_enterprise_knowledge_get", { path: "areas/other/private.md" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(denied.at(-1)?.result).toMatchObject({ ok: false, code: "access_denied" });
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(layer).pipe(
        Layer.provide(
          Layer.mock(EnterpriseClient)({
            knowledgeList: Effect.succeed({
              documents: Array.from({ length: 101 }, () => summary),
            }),
            knowledgeGet: (input) =>
              input.path === document.id
                ? Effect.succeed(document)
                : Effect.fail(
                    new EnterpriseError({ code: "access_denied", message: "Not accessible." }),
                  ),
          }),
        ),
      ),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("member"),
      capabilities: new Set<McpInvocationContext.McpCapability>(),
      issuedAt: 0,
      requestNamespace: "cli",
      thread: undefined,
      client: { sessionId: "cli", label: "t3 enterprise cli", access: "read-only" },
    }),
  );
});

it.effect("bounds team pages and lets the CLI reassemble long messages without losing text", () => {
  const summary: TeamThreadSummary = {
    ownerEmail: "owner@example.com",
    ownerDisplayName: "Owner",
    threadId: "shared",
    parentThreadId: null,
    title: "Shared work",
    status: "idle",
    updatedAt: "2026-11-08T00:00:00Z",
    publicationStatus: "read-only",
  };
  const messages = Array.from({ length: 105 }, (_, index) => ({
    role: "assistant" as const,
    text: index === 0 ? "x".repeat(120_001) : `message ${index}`,
    createdAt: "2026-11-08T00:00:00Z",
  }));
  return Effect.gen(function* () {
    const toolkit = yield* EnterpriseCliToolkit;
    const first = yield* toolkit
      .handle("t3_cli_enterprise_thread_list", {})
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(first.at(-1)?.result).toMatchObject({
      ok: true,
      value: { threads: expect.any(Array), nextCursor: 100 },
    });
    const second = yield* toolkit
      .handle("t3_cli_enterprise_thread_list", { cursor: 100 })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(second.at(-1)?.result).toMatchObject({
      ok: true,
      value: { threads: [summary], nextCursor: null },
    });
    const tools = {
      call: ((_tool, args, schema) =>
        Effect.gen(function* () {
          const page = yield* toolkit
            .handle("t3_cli_enterprise_thread_get", yield* decodeReadInput(args))
            .pipe(Stream.unwrap, Stream.runCollect);
          const result = page.at(-1)?.result;
          if (result !== undefined && "ok" in result && result.ok) {
            expect(result.value.messages.length).toBeLessThanOrEqual(100);
            expect(
              result.value.messages.reduce((count, message) => count + message.text.length, 0),
            ).toBeLessThanOrEqual(50_000);
          }
          return yield* Schema.decodeEffect(schema)(result).pipe(
            Effect.mapError(
              () =>
                new ThreadToolFailedError({
                  tool: "t3_cli_enterprise_thread_get",
                  detail: "Invalid test result",
                }),
            ),
          );
        })) as ThreadTools["call"],
    } satisfies ThreadTools;
    expect(
      yield* readEnterpriseThread(tools, {
        ownerEmail: summary.ownerEmail,
        threadId: summary.threadId,
      }),
    ).toEqual({ summary, messages });
  }).pipe(
    Effect.provide(
      McpToolAccess.HandlersLayer.layer(layer).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(EnterpriseClient)({
              teamList: Effect.succeed(Array.from({ length: 101 }, () => summary)),
              teamGet: () => Effect.succeed({ summary, messages }),
            }),
          ),
        ),
      ),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, {
      environmentId: EnvironmentId.make("member"),
      capabilities: new Set<McpInvocationContext.McpCapability>(),
      issuedAt: 0,
      requestNamespace: "cli",
      thread: undefined,
      client: { sessionId: "cli", label: "t3 enterprise cli", access: "read-only" },
    }),
  );
});
