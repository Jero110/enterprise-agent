import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeEnterpriseCommand } from "./enterprise.ts";
import { ThreadToolFailedError, type ThreadTools } from "./thread.ts";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

it.effect("page commands issue one bounded request and expose continuation offsets", () => {
  const summary = {
    ownerEmail: "owner@example.com",
    ownerDisplayName: "Owner",
    threadId: "shared",
    parentThreadId: null,
    title: "Shared",
    status: "idle",
    updatedAt: "2026-11-08T00:00:00Z",
    publicationStatus: "read-only",
  };
  const document = {
    id: "global/overview.md",
    areaId: "global",
    title: "Overview",
    content: "Chunk",
  };
  return Effect.gen(function* () {
    for (const entry of [
      {
        args: ["threads", "list", "--page"],
        tool: "t3_cli_enterprise_thread_list",
        input: { cursor: 0 },
        page: { threads: [summary], nextCursor: 100 },
      },
      {
        args: [
          "threads",
          "show",
          summary.ownerEmail,
          summary.threadId,
          "--page",
          "--message-offset",
          "100",
          "--text-offset",
          "20",
        ],
        tool: "t3_cli_enterprise_thread_get",
        input: {
          ownerEmail: summary.ownerEmail,
          threadId: summary.threadId,
          messageOffset: 100,
          textOffset: 20,
        },
        page: {
          summary,
          messages: [{ role: "assistant", text: "Chunk", createdAt: summary.updatedAt }],
          nextMessageOffset: 100,
          nextTextOffset: 50_020,
        },
      },
      {
        args: ["knowledge", "list", "--cursor", "100"],
        tool: "t3_cli_enterprise_knowledge_list",
        input: { cursor: 100 },
        page: {
          documents: [{ id: document.id, areaId: document.areaId, title: document.title }],
          nextCursor: 200,
        },
      },
      {
        args: ["knowledge", "show", document.id, "--page", "--text-offset", "50000"],
        tool: "t3_cli_enterprise_knowledge_get",
        input: { path: document.id, textOffset: 50_000 },
        page: { ...document, nextTextOffset: 100_000 },
      },
    ]) {
      for (const json of [true, false]) {
        yield* Effect.gen(function* () {
          const previousLines = (yield* TestConsole.logLines).length;
          const previousErrors = (yield* TestConsole.errorLines).length;
          let calls = 0;
          const tools = {
            call: ((tool, input, schema) => {
              calls += 1;
              if (calls > 1) return Effect.die("Page output requested another page");
              expect(tool).toBe(entry.tool);
              expect(input).toEqual(entry.input);
              return Schema.decodeEffect(schema)({ ok: true, value: entry.page }).pipe(
                Effect.mapError(
                  () => new ThreadToolFailedError({ tool, detail: "Invalid test page" }),
                ),
              );
            }) as ThreadTools["call"],
          };
          const command = makeEnterpriseCommand((_flags, run) => run(tools));
          yield* Command.runWith(command, { version: "0.0.0" })([
            ...entry.args,
            ...(json ? ["--json"] : []),
          ]);
          expect(calls).toBe(1);
          const lines = (yield* TestConsole.logLines).slice(previousLines);
          if (json) {
            expect(lines).toHaveLength(1);
            expect(yield* decodeJson(lines[0])).toEqual(entry.page);
          } else {
            expect(lines.length).toBeGreaterThan(0);
            const errors = (yield* TestConsole.errorLines).slice(previousErrors);
            expect(errors).toHaveLength(1);
            expect(String(errors[0])).toContain("Continue with --page");
          }
        }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, TestConsole.layer)));
      }
    }
  });
});
