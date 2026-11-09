import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, describe } from "@effect/vitest";
import {
  ProjectBoardError,
  ProjectId,
  type ProjectBoard,
  type TeamMessage,
  type TeamMessageHubSendInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as ProjectBoards from "../project/ProjectBoards.ts";
import * as TeamMessenger from "./TeamMessenger.ts";

const incoming = (overrides: Partial<TeamMessage> = {}): TeamMessage => ({
  id: "m1",
  kind: "skill",
  outgoing: false,
  fromKey: "a",
  fromDisplayName: "Ana",
  toKey: "b",
  toDisplayName: "Bruno",
  note: null,
  skill: { name: "rag-search", description: "", content: "# RAG" },
  task: null,
  viaAgent: false,
  status: "unread",
  createdAt: "2026-11-09T12:00:00Z",
  ...overrides,
});

const project = ProjectId.make("project-1");
const card = (overrides: Partial<TeamMessage> = {}) =>
  incoming({
    id: "c1",
    kind: "task",
    skill: null,
    note: "para la junta",
    viaAgent: true,
    task: { title: "Buscar % de la promo", description: "Ventas", priority: "high", dueDate: null },
    ...overrides,
  });

const setup = (inbox: ReadonlyArray<TeamMessage>, options: { readonly conflicts?: number } = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-team-messenger-" });
    const claude = path.join(root, "claude");
    const codex = path.join(root, "codex");
    const sent: TeamMessageHubSendInput[] = [];
    const decided: string[] = [];
    const board = { revision: 0, boards: [] as ReadonlyArray<ProjectBoard> };
    let conflicts = options.conflicts ?? 0;
    const boards = Layer.mock(ProjectBoards.ProjectBoards)({
      get: ({ projectId }) =>
        projectId === project
          ? Effect.sync(() => ({ revision: board.revision, boards: board.boards }))
          : Effect.fail(new ProjectBoardError({ code: "not_found" })),
      save: (input) =>
        Effect.suspend(() => {
          if (conflicts > 0 || input.revision !== board.revision) {
            conflicts -= 1;
            board.revision += 1;
            return Effect.fail(new ProjectBoardError({ code: "conflict" }));
          }
          board.revision += 1;
          board.boards = input.boards;
          return Effect.succeed({ revision: board.revision, boards: input.boards });
        }),
    });
    const client = Layer.mock(EnterpriseClient.EnterpriseClient)({
      messagesList: Effect.succeed(inbox),
      messageSend: (input) =>
        Effect.sync(() => {
          sent.push(input);
          return incoming({ outgoing: true });
        }),
      messageDecide: (input) =>
        Effect.sync(() => {
          decided.push(`${input.id}:${input.decision}`);
          return incoming({ status: input.decision });
        }),
    });
    const messenger = yield* TeamMessenger.TeamMessenger.pipe(
      Effect.provide(TeamMessenger.layer.pipe(Layer.provide(Layer.merge(client, boards)))),
    );
    const run = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.provideService(HostProcess.Environment, {
          CLAUDE_CONFIG_DIR: claude,
          CODEX_HOME: codex,
        }),
      );
    return { fs, path, root, claude, codex, sent, decided, messenger, run, board };
  });
const code = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  effect.pipe(
    Effect.map(() => "ok"),
    Effect.catch((error) => Effect.succeed(error.code)),
  );

describe("TeamMessenger", () => {
  it.effect("installs an accepted skill into the Claude and Codex skill folders", () =>
    Effect.gen(function* () {
      const t = yield* setup([incoming()]);
      yield* t.run(t.messenger.decide({ id: "m1", decision: "installed" }));
      for (const home of [t.claude, t.codex])
        expect(
          yield* t.fs.readFileString(t.path.join(home, "skills", "rag-search", "SKILL.md")),
        ).toBe("# RAG");
      expect(t.decided).toEqual(["m1:installed"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never overwrites a skill the recipient already has", () =>
    Effect.gen(function* () {
      const t = yield* setup([incoming()]);
      const mine = t.path.join(t.codex, "skills", "rag-search");
      yield* t.fs.makeDirectory(mine, { recursive: true });
      yield* t.fs.writeFileString(t.path.join(mine, "SKILL.md"), "mine");
      expect(yield* code(t.run(t.messenger.decide({ id: "m1", decision: "installed" })))).toBe(
        "skill_exists",
      );
      expect(yield* t.fs.readFileString(t.path.join(mine, "SKILL.md"))).toBe("mine");
      expect(yield* t.fs.exists(t.path.join(t.claude, "skills", "rag-search"))).toBe(false);
      expect(t.decided).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses unsafe names, answered requests and messages that are not its own", () =>
    Effect.gen(function* () {
      const t = yield* setup([
        incoming({ id: "evil", skill: { name: "../../evil", description: "", content: "x" } }),
        incoming({ id: "done", status: "declined" }),
        incoming({ id: "mine", outgoing: true }),
        incoming({ id: "note", kind: "message", skill: null, note: "hi" }),
      ]);
      const install = (id: string) =>
        code(t.run(t.messenger.decide({ id, decision: "installed" })));
      expect(yield* install("evil")).toBe("invalid_message");
      expect(yield* install("done")).toBe("conflict");
      expect(yield* install("mine")).toBe("message_not_found");
      expect(yield* install("note")).toBe("conflict");
      expect(yield* install("missing")).toBe("message_not_found");
      expect(yield* t.fs.readDirectory(t.root)).toEqual([]);
      // Declining never touches the disk.
      yield* t.run(t.messenger.decide({ id: "done", decision: "declined" }));
      expect(t.decided).toEqual(["done:declined"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sends only a SKILL.md it can read, named by its folder", () =>
    Effect.gen(function* () {
      const t = yield* setup([]);
      const folder = t.path.join(t.root, "skills", "rag-search");
      yield* t.fs.makeDirectory(folder, { recursive: true });
      const file = t.path.join(folder, "SKILL.md");
      yield* t.fs.writeFileString(
        file,
        "\uFEFF---\r\nname: RAG\r\ndescription: Search the wiki\r\n---\r\nbody",
      );
      yield* t.messenger.send({ recipientKey: "k", note: "úsala", skillPath: file });
      expect(t.sent).toEqual([
        {
          recipientKey: "k",
          note: "úsala",
          skill: {
            name: "rag-search",
            description: "Search the wiki",
            content: "---\r\nname: RAG\r\ndescription: Search the wiki\r\n---\r\nbody",
          },
        },
      ]);
      const other = t.path.join(t.root, "notes.txt");
      yield* t.fs.writeFileString(other, "secret");
      expect(yield* code(t.messenger.send({ recipientKey: "k", skillPath: other }))).toBe(
        "invalid_message",
      );
      expect(
        yield* code(
          t.messenger.send({ recipientKey: "k", skillPath: t.path.join(t.root, "x", "SKILL.md") }),
        ),
      ).toBe("invalid_message");
      expect(t.sent).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("adds an accepted card once, on its own requests board, crediting the sender", () =>
    Effect.gen(function* () {
      const t = yield* setup([card()], { conflicts: 1 });
      yield* t.messenger.decide({ id: "c1", decision: "accepted", projectId: project });
      // A retry after the hub answer was lost must not add the card again.
      yield* t.messenger.decide({ id: "c1", decision: "accepted", projectId: project });
      expect(t.board.boards).toHaveLength(1);
      const [requests] = t.board.boards;
      expect(requests).toMatchObject({ id: TeamMessenger.TEAM_REQUESTS_BOARD.id });
      expect(requests?.tasks).toEqual([
        {
          id: "c1",
          title: "Buscar % de la promo",
          description: "para la junta\n\nVentas\n\nLo pidió Ana (con su agente).",
          status: "backlog",
          priority: "high",
          assignees: [],
          tags: ["de Ana"],
          dueDate: null,
        },
      ]);
      expect(t.decided).toEqual(["c1:accepted", "c1:accepted"]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("needs a project to accept a card and never mixes up card and skill answers", () =>
    Effect.gen(function* () {
      const t = yield* setup([card(), incoming({ id: "s1" })]);
      const answer = (id: string, decision: "accepted" | "installed", projectId?: ProjectId) =>
        code(
          t.run(
            t.messenger.decide({
              id,
              decision,
              ...(projectId === undefined ? {} : { projectId }),
            }),
          ),
        );
      expect(yield* answer("c1", "accepted")).toBe("invalid_message");
      expect(yield* answer("c1", "accepted", ProjectId.make("elsewhere"))).toBe("invalid_message");
      expect(yield* answer("s1", "accepted", project)).toBe("invalid_message");
      expect(yield* answer("c1", "installed", project)).toBe("conflict");
      expect(t.board.boards).toEqual([]);
      expect(t.decided).toEqual([]);
      expect(yield* t.fs.readDirectory(t.root)).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("sends an agent's card as a request, never as a board write", () =>
    Effect.gen(function* () {
      const t = yield* setup([]);
      const task = { title: "Revisar", description: "", priority: null, dueDate: "2026-11-10" };
      yield* t.messenger.sendCard({ recipientKey: "k", task });
      expect(t.sent).toEqual([{ recipientKey: "k", task, viaAgent: true }]);
      expect(t.board.boards).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
