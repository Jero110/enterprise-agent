import { expect, it } from "@effect/vitest";
import { ProjectId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import Migration from "../persistence/Migrations/087_ProjectBoards.ts";
import * as ProjectBoards from "./ProjectBoards.ts";

const projectId = ProjectId.make("project-a");
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
  "persists project boards across service instances and refuses stale writes and invalid projects",
  () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_projects (project_id TEXT PRIMARY KEY, deleted_at TEXT)`;
      yield* sql`INSERT INTO projection_projects VALUES ('project-a', NULL), ('project-b', NULL), ('deleted', 'now')`;
      yield* Migration;
      const first = yield* ProjectBoards.ProjectBoards.pipe(Effect.provide(ProjectBoards.layer));
      expect(yield* first.get({ projectId })).toEqual({ revision: 0, boards: [] });
      expect(yield* first.save({ projectId, revision: 0, boards })).toEqual({
        revision: 1,
        boards,
      });
      const reopened = yield* ProjectBoards.ProjectBoards.pipe(Effect.provide(ProjectBoards.layer));
      expect(yield* reopened.get({ projectId })).toEqual({ revision: 1, boards });
      expect(yield* reopened.get({ projectId: ProjectId.make("project-b") })).toEqual({
        revision: 0,
        boards: [],
      });
      expect(
        yield* reopened.save({ projectId, revision: 0, boards: [] }).pipe(Effect.flip),
      ).toMatchObject({ code: "conflict" });
      expect(
        yield* reopened
          .save({ projectId, revision: 1, boards: [...boards, ...boards] })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "invalid" });
      for (const id of ["missing", "deleted"]) {
        expect(
          yield* reopened.get({ projectId: ProjectId.make(id) }).pipe(Effect.flip),
        ).toMatchObject({ code: "not_found" });
        expect(
          yield* reopened
            .save({ projectId: ProjectId.make(id), revision: 0, boards })
            .pipe(Effect.flip),
        ).toMatchObject({ code: "not_found" });
      }
      expect(yield* reopened.get({ projectId })).toEqual({ revision: 1, boards });
      expect(yield* reopened.save({ projectId, revision: 1, boards: [] })).toEqual({
        revision: 2,
        boards: [],
      });
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
