import { expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Legacy from "../persistence/Migrations/087_ProjectBoards.ts";
import Migration from "../persistence/Migrations/093_UserBoards.ts";
import * as ProjectBoards from "./ProjectBoards.ts";

const ana = "ana@x.test";
const boards = [
  {
    id: "board",
    name: "Sprint",
    tasks: [
      {
        id: "card",
        title: "Review ledger",
        description: "Check totals",
        status: "backlog" as const,
        priority: null,
        assignees: [],
        tags: [],
        dueDate: null,
      },
    ],
  },
];

it.effect(
  "keeps one board space per identity, migrates project boards to the shared space, and refuses stale writes",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* Legacy;
      yield* sql`INSERT INTO project_boards VALUES ('project-a', 3, ${JSON.stringify(boards)}), ('project-b', 1, ${JSON.stringify([{ id: "board-b", name: "Other", tasks: [] }])})`;
      yield* Migration;
      const first = yield* ProjectBoards.ProjectBoards.pipe(Effect.provide(ProjectBoards.layer));
      const shared = yield* first.get(null);
      expect(shared.revision).toBe(4);
      expect(shared.boards.map((board) => board.id)).toEqual(["board", "board-b"]);
      // The first identified member claims the shared space once; nobody else gets a copy.
      expect(yield* first.get(ana)).toEqual(shared);
      expect(yield* first.get(null)).toEqual({ revision: 0, boards: [] });
      expect(yield* first.get("BRUNO@x.test")).toEqual({ revision: 0, boards: [] });

      expect(yield* first.save(ana, { revision: 4, boards })).toEqual({ revision: 5, boards });
      const reopened = yield* ProjectBoards.ProjectBoards.pipe(Effect.provide(ProjectBoards.layer));
      expect(yield* reopened.get(" Ana@X.test ")).toEqual({ revision: 5, boards });

      expect(
        yield* reopened.save(ana, { revision: 0, boards: [] }).pipe(Effect.flip),
      ).toMatchObject({ code: "conflict" });
      expect(
        yield* reopened
          .save(ana, { revision: 5, boards: [...boards, ...boards] })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "invalid" });
      expect(yield* reopened.get(ana)).toEqual({ revision: 5, boards });
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect("moves a card between boards and columns for one owner only", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Legacy;
    yield* Migration;
    const service = yield* ProjectBoards.ProjectBoards.pipe(Effect.provide(ProjectBoards.layer));
    const target = { id: "done", name: "Done", tasks: [] };
    yield* service.save(ana, { revision: 0, boards: [...boards, target] });
    const moved = yield* service.moveCard(ana, {
      cardId: "card",
      toBoardId: "done",
      status: "complete",
    });
    expect(moved.revision).toBe(2);
    expect(moved.boards[0]?.tasks).toEqual([]);
    expect(moved.boards[1]?.tasks).toMatchObject([{ id: "card", status: "complete" }]);
    expect(yield* service.moveCard(ana, { cardId: "card", status: "blocked" })).toMatchObject({
      revision: 3,
    });
    expect(yield* service.moveCard(ana, { cardId: "nope" }).pipe(Effect.flip)).toMatchObject({
      code: "not_found",
    });
    expect(
      yield* service.moveCard(ana, { cardId: "card", toBoardId: "missing" }).pipe(Effect.flip),
    ).toMatchObject({ code: "not_found" });
    expect(
      yield* service
        .moveCard("bruno@x.test", { cardId: "card", status: "backlog" })
        .pipe(Effect.flip),
    ).toMatchObject({ code: "not_found" });
    expect(yield* sql`SELECT revision FROM user_boards WHERE owner = 'ana@x.test'`).toEqual([
      { revision: 3 },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
