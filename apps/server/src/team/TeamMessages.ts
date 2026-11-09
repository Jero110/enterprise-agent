import {
  EnterpriseError,
  TEAM_MESSAGE_NOTE_MAX_CHARS,
  TEAM_SKILL_CONTENT_MAX_CHARS,
  TEAM_SKILL_NAME_PATTERN,
  TEAM_TASK_DESCRIPTION_MAX_CHARS,
  TEAM_TASK_TITLE_MAX_CHARS,
  TeamSharedSkill,
  TeamSharedTask,
  type TeamMessage,
  type TeamMessageDecideInput,
  type TeamMessageHubSendInput,
  type TeamMessageReference,
} from "@t3tools/contracts";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";

/** Direct messages, skill requests and board-card requests between members of one enterprise, kept on the hub. */
export class TeamMessages extends Context.Service<
  TeamMessages,
  {
    readonly list: (
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<TeamMessage>, EnterpriseError>;
    readonly send: (
      sessionId: string,
      input: TeamMessageHubSendInput,
    ) => Effect.Effect<TeamMessage, EnterpriseError>;
    readonly read: (
      sessionId: string,
      input: TeamMessageReference,
    ) => Effect.Effect<TeamMessage, EnterpriseError>;
    readonly decide: (
      sessionId: string,
      input: TeamMessageDecideInput,
    ) => Effect.Effect<TeamMessage, EnterpriseError>;
  }
>()("t3/team/TeamMessages") {}

/** Unanswered messages one person may leave for another before the hub refuses more. */
export const TEAM_MESSAGE_UNREAD_LIMIT = 20;
const LIST_LIMIT = 200;
const SKILL_DESCRIPTION_MAX_CHARS = 1_000;

interface MessageRow {
  readonly id: string;
  readonly from_email: string;
  readonly to_email: string;
  readonly kind: TeamMessage["kind"];
  readonly note: string | null;
  readonly skill_json: string | null;
  readonly task_json: string | null;
  readonly via_agent: number;
  readonly status: TeamMessage["status"];
  readonly created_at: string;
}

const SkillJson = Schema.fromJsonString(TeamSharedSkill);
const decodeSkill = Schema.decodeUnknownEffect(SkillJson);
const encodeSkill = Schema.encodeEffect(SkillJson);
const TaskJson = Schema.fromJsonString(TeamSharedTask);
const decodeTask = Schema.decodeUnknownEffect(TaskJson);
const encodeTask = Schema.encodeEffect(TaskJson);

/** How each kind of request can be answered: a message isn't answered, only read. */
const DECISIONS: Record<TeamMessage["kind"], ReadonlyArray<TeamMessageDecideInput["decision"]>> = {
  message: [],
  skill: ["installed", "declined"],
  task: ["accepted", "declined"],
};

const invalid = (message: string) => new EnterpriseError({ code: "invalid_message", message });
const notFound = new EnterpriseError({
  code: "message_not_found",
  message: "That message does not exist or is not yours.",
});

export const layer = Layer.effect(
  TeamMessages,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const random = yield* SecureRandom.SecureRandom;

    const identity = Effect.fn("TeamMessages.identity")(function* (sessionId: string) {
      const enrollment = yield* store.getEnrollment(sessionId);
      if (enrollment === null)
        return yield* new EnterpriseError({
          code: "not_connected",
          message: "Connect to your enterprise first.",
        });
      const member = yield* store.getMember(enrollment.email);
      if (member === null || !member.authorized || member.revoked)
        return yield* new EnterpriseError({ code: "access_denied", message: "Access denied." });
      return member;
    });

    const toMessage = Effect.fn("TeamMessages.toMessage")(function* (
      row: MessageRow,
      viewer: string,
    ) {
      const from = yield* store.getMember(row.from_email);
      const to = yield* store.getMember(row.to_email);
      return {
        id: row.id,
        kind: row.kind,
        outgoing: row.from_email === viewer,
        fromKey: teamMemberKey(row.from_email),
        fromDisplayName: from?.displayName ?? row.from_email,
        toKey: teamMemberKey(row.to_email),
        toDisplayName: to?.displayName ?? row.to_email,
        note: row.note,
        skill:
          row.skill_json === null ? null : yield* decodeSkill(row.skill_json).pipe(Effect.orDie),
        task: row.task_json === null ? null : yield* decodeTask(row.task_json).pipe(Effect.orDie),
        viaAgent: row.via_agent === 1,
        status: row.status,
        createdAt: row.created_at,
      } satisfies TeamMessage;
    });

    const ownRow = Effect.fn("TeamMessages.ownRow")(function* (id: string, viewer: string) {
      const rows = yield* sql<MessageRow>`SELECT * FROM enterprise_team_messages
        WHERE id = ${id} AND (to_email = ${viewer} OR from_email = ${viewer})`.pipe(Effect.orDie);
      const row = rows[0];
      if (row === undefined) return yield* notFound;
      return row;
    });

    const list: TeamMessages["Service"]["list"] = Effect.fn("TeamMessages.list")(
      function* (sessionId) {
        const viewer = yield* identity(sessionId);
        const rows = yield* sql<MessageRow>`SELECT * FROM enterprise_team_messages
          WHERE to_email = ${viewer.email} OR from_email = ${viewer.email}
          ORDER BY created_at DESC, id DESC LIMIT ${LIST_LIMIT}`.pipe(Effect.orDie);
        return yield* Effect.forEach(rows, (row) => toMessage(row, viewer.email));
      },
    );

    const send: TeamMessages["Service"]["send"] = Effect.fn("TeamMessages.send")(
      function* (sessionId, input) {
        const sender = yield* identity(sessionId);
        const recipient = (yield* store.listMembers).find(
          (member) => teamMemberKey(member.email) === input.recipientKey,
        );
        if (recipient === undefined || !recipient.authorized || recipient.revoked)
          return yield* invalid("That person is not in your company.");
        if (recipient.email === sender.email) return yield* invalid("You can't message yourself.");
        const note = input.note?.trim() ?? "";
        if (note.length > TEAM_MESSAGE_NOTE_MAX_CHARS)
          return yield* invalid("That message is too long.");
        const { skill, task } = input;
        if (skill !== undefined && task !== undefined)
          return yield* invalid("Send a skill or a card, not both.");
        if (skill === undefined && task === undefined && note.length === 0)
          return yield* invalid("Write a message.");
        if (task !== undefined) {
          if (task.title.length > TEAM_TASK_TITLE_MAX_CHARS)
            return yield* invalid("That card's title is too long.");
          if (task.description.length > TEAM_TASK_DESCRIPTION_MAX_CHARS)
            return yield* invalid("That card's description is too long.");
        }
        if (skill !== undefined) {
          if (!TEAM_SKILL_NAME_PATTERN.test(skill.name))
            return yield* invalid("Skill names use lowercase letters, numbers, - and _.");
          if (skill.content.trim().length === 0) return yield* invalid("The skill is empty.");
          if (skill.content.length > TEAM_SKILL_CONTENT_MAX_CHARS)
            return yield* invalid("That skill is too large to share.");
          if (skill.description.length > SKILL_DESCRIPTION_MAX_CHARS)
            return yield* invalid("That skill's description is too long.");
        }
        const pending = yield* sql<{ readonly count: number }>`SELECT COUNT(*) AS count
          FROM enterprise_team_messages
          WHERE from_email = ${sender.email} AND to_email = ${recipient.email} AND status = 'unread'`.pipe(
          Effect.orDie,
        );
        if ((pending[0]?.count ?? 0) >= TEAM_MESSAGE_UNREAD_LIMIT)
          return yield* new EnterpriseError({
            code: "too_many_messages",
            message: "They have too many unread messages from you. Wait until they read them.",
          });
        const row: MessageRow = {
          id: yield* random.uuidV4(),
          from_email: sender.email,
          to_email: recipient.email,
          kind: skill !== undefined ? "skill" : task !== undefined ? "task" : "message",
          note: note.length === 0 ? null : note,
          skill_json: skill === undefined ? null : yield* encodeSkill(skill).pipe(Effect.orDie),
          task_json: task === undefined ? null : yield* encodeTask(task).pipe(Effect.orDie),
          via_agent: input.viaAgent === true ? 1 : 0,
          status: "unread",
          created_at: DateTime.formatIso(yield* DateTime.now),
        };
        yield* sql`INSERT INTO enterprise_team_messages (id, from_email, to_email, kind, note, skill_json, task_json, via_agent, status, created_at)
          VALUES (${row.id}, ${row.from_email}, ${row.to_email}, ${row.kind}, ${row.note}, ${row.skill_json}, ${row.task_json}, ${row.via_agent}, ${row.status}, ${row.created_at})`.pipe(
          Effect.orDie,
        );
        return yield* toMessage(row, sender.email);
      },
    );

    const read: TeamMessages["Service"]["read"] = Effect.fn("TeamMessages.read")(
      function* (sessionId, input) {
        const viewer = yield* identity(sessionId);
        const row = yield* ownRow(input.id, viewer.email);
        if (row.to_email !== viewer.email || row.status !== "unread")
          return yield* toMessage(row, viewer.email);
        yield* sql`UPDATE enterprise_team_messages SET status = 'read'
          WHERE id = ${row.id} AND status = 'unread'`.pipe(Effect.orDie);
        return yield* toMessage({ ...row, status: "read" }, viewer.email);
      },
    );

    const decide: TeamMessages["Service"]["decide"] = Effect.fn("TeamMessages.decide")(
      function* (sessionId, input) {
        const viewer = yield* identity(sessionId);
        const row = yield* ownRow(input.id, viewer.email);
        if (row.to_email !== viewer.email)
          return yield* new EnterpriseError({
            code: "access_denied",
            message: "Only the person who received it can answer.",
          });
        if (!DECISIONS[row.kind].includes(input.decision))
          return yield* invalid(
            row.kind === "message"
              ? "Messages don't need an answer."
              : row.kind === "skill"
                ? "A skill request is installed or declined."
                : "A card request is accepted or declined.",
          );
        if (row.status !== "unread" && row.status !== "read")
          return yield* new EnterpriseError({
            code: "conflict",
            message: "This request was already answered.",
          });
        const updated = yield* sql`UPDATE enterprise_team_messages SET status = ${input.decision}
          WHERE id = ${row.id} AND status IN ('unread', 'read') RETURNING id`.pipe(Effect.orDie);
        if (updated.length === 0)
          return yield* new EnterpriseError({
            code: "conflict",
            message: "This request was already answered.",
          });
        return yield* toMessage({ ...row, status: input.decision }, viewer.email);
      },
    );

    return TeamMessages.of({ list, send, read, decide });
  }),
);
