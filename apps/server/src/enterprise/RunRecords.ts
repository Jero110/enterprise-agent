import {
  EnterpriseError,
  RunRecord,
  type RunRecordInput,
  type RunsQuery,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnterpriseStore from "./EnterpriseStore.ts";

export class RunRecords extends Context.Service<
  RunRecords,
  {
    readonly report: (
      sessionId: string,
      input: RunRecordInput,
    ) => Effect.Effect<{ readonly updated: boolean }, EnterpriseError>;
    readonly query: (
      sessionId: string,
      filters: RunsQuery,
    ) => Effect.Effect<ReadonlyArray<RunRecord>, EnterpriseError>;
  }
>()("t3/enterprise/RunRecords") {}

const denied = new EnterpriseError({ code: "access_denied", message: "Run record access denied." });
const codec = Schema.fromJsonString(RunRecord);
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const store = yield* EnterpriseStore.EnterpriseStore;
  const identity = Effect.fn("RunRecords.identity")(function* (sessionId: string) {
    const enrollment = yield* store.getEnrollment(sessionId);
    if (enrollment === null) return yield* denied;
    const member = yield* store.getMember(enrollment.email);
    if (member === null || !member.authorized || member.revoked) return yield* denied;
    return member;
  });
  const report: RunRecords["Service"]["report"] = Effect.fn("RunRecords.report")(
    function* (sessionId, input) {
      const member = yield* identity(sessionId);
      const record = { ...input, member: member.email, teamId: member.teamId };
      const json = yield* Schema.encodeEffect(codec)(record).pipe(Effect.orDie);
      yield* sql`INSERT INTO enterprise_run_records (member, turn_id, team_id, thread_id, record_json)
      VALUES (${member.email}, ${input.turnId}, ${member.teamId}, ${input.threadId}, ${json})
      ON CONFLICT(member, turn_id) DO NOTHING`.pipe(Effect.orDie);
      return { updated: true };
    },
  );
  const query: RunRecords["Service"]["query"] = Effect.fn("RunRecords.query")(
    function* (sessionId, filters) {
      const member = yield* identity(sessionId);
      if (
        member.role !== "admin" &&
        (member.role !== "lead" ||
          member.teamId === null ||
          (filters.teamId !== undefined && filters.teamId !== member.teamId))
      )
        return yield* denied;
      const team = member.role === "admin" ? filters.teamId : member.teamId;
      const rows = yield* sql<{
        readonly record_json: string;
      }>`SELECT record_json FROM enterprise_run_records
      WHERE (${team ?? null} IS NULL OR team_id = ${team ?? null})
      AND (${filters.member ?? null} IS NULL OR member = ${filters.member ?? null})
      AND (${filters.threadId ?? null} IS NULL OR thread_id = ${filters.threadId ?? null})
      AND (${filters.turnId ?? null} IS NULL OR turn_id = ${filters.turnId ?? null})
      ORDER BY member, turn_id`.pipe(Effect.orDie);
      return yield* Effect.forEach(rows, (row) =>
        Schema.decodeEffect(codec)(row.record_json).pipe(Effect.orDie),
      );
    },
  );
  return RunRecords.of({ report, query });
});
export const layer = Layer.effect(RunRecords, make);
