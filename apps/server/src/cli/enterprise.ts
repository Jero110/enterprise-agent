import {
  EnterpriseCliKnowledgeListResult,
  EnterpriseCliKnowledgeGetResult,
  type KnowledgeDocumentSummary,
  type TeamThreadSnapshot,
  EnterpriseCliThreadListResult,
  EnterpriseCliThreadReadResult,
  type TeamThreadSummary,
  type TeamThreadReference,
} from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { hubResult } from "../enterprise/EnterpriseToolkit.ts";
import { projectLocationFlags } from "./config.ts";
import {
  reportThreadErrors,
  ThreadToolFailedError,
  type ThreadServerUnreachableError,
  withThreadTools,
  type ThreadTools,
} from "./thread.ts";

const withEnterpriseTools = <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  run: (tools: ThreadTools) => Effect.Effect<A, E, R>,
) =>
  withThreadTools(flags, run, {
    label: "t3 enterprise cli",
    name: "t3-enterprise-cli",
    access: "read-only",
  });

const flags = {
  ...projectLocationFlags,
  json: Flag.Boolean("json").pipe(Flag.withDefault(false)),
  page: Flag.Boolean("page").pipe(
    Flag.withDescription("Return one bounded page with continuation offsets."),
    Flag.withDefault(false),
  ),
};
const offsetFlag = (name: string) =>
  Flag.Int(name).pipe(
    Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
    Flag.withDefault(0),
  );
const listFlags = { ...flags, cursor: offsetFlag("cursor") };
const printJson = (value: unknown) => Console.log(JSON.stringify(value));

const callEnterpriseTool = Effect.fn("cli.enterprise.callTool")(function* <A>(
  tools: ThreadTools,
  tool: string,
  args: Readonly<Record<string, unknown>>,
  schema: Schema.Codec<A>,
) {
  const result = yield* tools.call(tool, args, hubResult(schema));
  if (!result.ok) {
    return yield* new ThreadToolFailedError({ tool, detail: `${result.code}: ${result.message}` });
  }
  return result.value;
});

export const readEnterpriseThread = Effect.fn("cli.enterprise.readThread")(function* (
  tools: ThreadTools,
  reference: TeamThreadReference,
) {
  const messages: Array<TeamThreadSnapshot["messages"][number]> = [];
  let messageOffset = 0;
  let textOffset = 0;
  while (true) {
    const page = yield* callEnterpriseTool(
      tools,
      "t3_cli_enterprise_thread_get",
      {
        ...reference,
        messageOffset,
        textOffset,
      },
      EnterpriseCliThreadReadResult,
    );
    for (let index = 0; index < page.messages.length; index += 1) {
      const message = page.messages[index]!;
      const previous = messages[messageOffset + index];
      messages[messageOffset + index] =
        previous === undefined ? message : { ...message, text: previous.text + message.text };
    }
    if (page.nextMessageOffset === null) return { summary: page.summary, messages };
    messageOffset = page.nextMessageOffset;
    textOffset = page.nextTextOffset ?? 0;
  }
});

export const makeEnterpriseCommand = <E, R>(
  withTools: (
    flags: { readonly baseDir: Option.Option<string> },
    run: (
      tools: ThreadTools,
    ) => Effect.Effect<void, ThreadToolFailedError | ThreadServerUnreachableError>,
  ) => Effect.Effect<void, E, R>,
) => {
  const threadsList = Command.make("list", listFlags).pipe(
    Command.withDescription("List published, accessible team conversations."),
    Command.withHandler((input) =>
      withTools(input, (tools) =>
        Effect.gen(function* () {
          const threads: Array<TeamThreadSummary> = [];
          let cursor: number | null = input.cursor;
          while (cursor !== null) {
            const page: typeof EnterpriseCliThreadListResult.Type = yield* callEnterpriseTool(
              tools,
              "t3_cli_enterprise_thread_list",
              { cursor },
              EnterpriseCliThreadListResult,
            );
            if (input.page || input.cursor > 0) {
              if (input.json) return yield* printJson(page);
              for (const thread of page.threads)
                yield* Console.log(`${thread.ownerEmail}\t${thread.threadId}\t${thread.title}`);
              if (page.nextCursor !== null)
                yield* Console.error(`Continue with --page --cursor ${page.nextCursor}`);
              return;
            }
            threads.push(
              ...page.threads.filter((thread) => thread.publicationStatus !== "unpublished"),
            );
            cursor = page.nextCursor;
          }
          if (input.json) return yield* printJson(threads);
          for (const thread of threads)
            yield* Console.log(`${thread.ownerEmail}\t${thread.threadId}\t${thread.title}`);
        }),
      ).pipe(reportThreadErrors),
    ),
  );

  const threadsShow = Command.make("show", {
    ...flags,
    ownerEmail: Argument.String("owner-email"),
    threadId: Argument.String("thread-id"),
    messageOffset: offsetFlag("message-offset"),
    textOffset: offsetFlag("text-offset"),
  }).pipe(
    Command.withDescription("Read a published team conversation."),
    Command.withHandler((input) =>
      withTools(input, (tools) =>
        Effect.gen(function* () {
          const reference = { ownerEmail: input.ownerEmail, threadId: input.threadId };
          const snapshot = yield* input.page || input.messageOffset > 0 || input.textOffset > 0
            ? callEnterpriseTool(
                tools,
                "t3_cli_enterprise_thread_get",
                { ...reference, messageOffset: input.messageOffset, textOffset: input.textOffset },
                EnterpriseCliThreadReadResult,
              )
            : readEnterpriseThread(tools, reference);
          if (input.json) return yield* printJson(snapshot);
          yield* Console.log(snapshot.summary.title);
          for (const message of snapshot.messages)
            yield* Console.log(`\n[${message.role}]\n${message.text}`);
          if ("nextMessageOffset" in snapshot && snapshot.nextMessageOffset !== null) {
            yield* Console.error(
              `Continue with --page --message-offset ${snapshot.nextMessageOffset} --text-offset ${snapshot.nextTextOffset ?? 0}`,
            );
          }
        }),
      ).pipe(reportThreadErrors),
    ),
  );

  const knowledgeList = Command.make("list", listFlags).pipe(
    Command.withDescription("List currently permitted Enterprise knowledge."),
    Command.withHandler((input) =>
      withTools(input, (tools) =>
        Effect.gen(function* () {
          const documents: Array<KnowledgeDocumentSummary> = [];
          let cursor: number | null = input.cursor;
          while (cursor !== null) {
            const page: typeof EnterpriseCliKnowledgeListResult.Type = yield* callEnterpriseTool(
              tools,
              "t3_cli_enterprise_knowledge_list",
              { cursor },
              EnterpriseCliKnowledgeListResult,
            );
            if (input.page || input.cursor > 0) {
              if (input.json) return yield* printJson(page);
              for (const document of page.documents) yield* Console.log(document.id);
              if (page.nextCursor !== null)
                yield* Console.error(`Continue with --page --cursor ${page.nextCursor}`);
              return;
            }
            documents.push(...page.documents);
            cursor = page.nextCursor;
          }
          if (input.json) return yield* printJson({ documents });
          for (const document of documents) yield* Console.log(document.id);
        }),
      ).pipe(reportThreadErrors),
    ),
  );

  const knowledgeShow = Command.make("show", {
    ...flags,
    path: Argument.String("path"),
    textOffset: offsetFlag("text-offset"),
  }).pipe(
    Command.withDescription("Read one currently permitted knowledge document."),
    Command.withHandler((input) =>
      withTools(input, (tools) =>
        Effect.gen(function* () {
          let textOffset = input.textOffset;
          let content = "";
          while (true) {
            const document = yield* callEnterpriseTool(
              tools,
              "t3_cli_enterprise_knowledge_get",
              { path: input.path, textOffset },
              EnterpriseCliKnowledgeGetResult,
            );
            if (input.page || input.textOffset > 0) {
              if (input.json) return yield* printJson(document);
              yield* Console.log(document.content);
              if (document.nextTextOffset !== null)
                yield* Console.error(
                  `Continue with --page --text-offset ${document.nextTextOffset}`,
                );
              return;
            }
            content += document.content;
            if (document.nextTextOffset === null) {
              return yield* input.json
                ? printJson({
                    id: document.id,
                    areaId: document.areaId,
                    title: document.title,
                    content,
                  })
                : Console.log(content);
            }
            textOffset = document.nextTextOffset;
          }
        }),
      ).pipe(reportThreadErrors),
    ),
  );

  return Command.make("enterprise").pipe(
    Command.withDescription(
      "Owner/script access to shared Enterprise conversations and knowledge through the running server.",
    ),
    Command.withSubcommands([
      Command.make("threads").pipe(Command.withSubcommands([threadsList, threadsShow])),
      Command.make("knowledge").pipe(Command.withSubcommands([knowledgeList, knowledgeShow])),
    ]),
  );
};

export const enterpriseCommand = makeEnterpriseCommand(withEnterpriseTools);
