import * as Schema from "effect/Schema";

import { ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TEAM_MESSAGE_NOTE_MAX_CHARS = 2_000;
export const TEAM_SKILL_CONTENT_MAX_CHARS = 64_000;
/** A skill travels as its folder name, which becomes the folder the recipient installs into. */
export const TEAM_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const TeamMessageKind = Schema.Literals(["message", "skill", "task"]);

/** A skill request ends `installed` or `declined`; a board card request `accepted` or `declined`. */
const TeamMessageStatus = Schema.Literals(["unread", "read", "installed", "accepted", "declined"]);

export const TeamSharedSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.String,
  content: Schema.String,
});
export type TeamSharedSkill = typeof TeamSharedSkill.Type;

export const TEAM_TASK_TITLE_MAX_CHARS = 300;
export const TEAM_TASK_DESCRIPTION_MAX_CHARS = 2_000;

/** A card proposed for someone else's board; it lands there only if they accept it. */
export const TeamSharedTask = Schema.Struct({
  title: TrimmedNonEmptyString,
  description: Schema.String,
  priority: Schema.NullOr(Schema.Literals(["urgent", "high", "normal", "low"])),
  dueDate: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
});
export type TeamSharedTask = typeof TeamSharedTask.Type;

export const TeamMessage = Schema.Struct({
  id: TrimmedNonEmptyString,
  kind: TeamMessageKind,
  outgoing: Schema.Boolean,
  fromKey: TrimmedNonEmptyString,
  fromDisplayName: TrimmedNonEmptyString,
  toKey: TrimmedNonEmptyString,
  toDisplayName: TrimmedNonEmptyString,
  note: Schema.NullOr(Schema.String),
  skill: Schema.NullOr(TeamSharedSkill),
  task: Schema.NullOr(TeamSharedTask),
  /** Sent by the sender's agent through the enterprise MCP tools rather than by hand. */
  viaAgent: Schema.Boolean,
  status: TeamMessageStatus,
  createdAt: Schema.String,
});
export type TeamMessage = typeof TeamMessage.Type;

/** What the client sends: a skill is named by the SKILL.md path its own server discovered. */
export const TeamMessageSendInput = Schema.Struct({
  recipientKey: TrimmedNonEmptyString,
  note: Schema.optionalKey(Schema.String),
  skillPath: Schema.optionalKey(TrimmedNonEmptyString),
});
export type TeamMessageSendInput = typeof TeamMessageSendInput.Type;

/** What reaches the hub: the sender's server has already read the skill from disk. */
export const TeamMessageHubSendInput = Schema.Struct({
  recipientKey: TrimmedNonEmptyString,
  note: Schema.optionalKey(Schema.String),
  skill: Schema.optionalKey(TeamSharedSkill),
  task: Schema.optionalKey(TeamSharedTask),
  viaAgent: Schema.optionalKey(Schema.Boolean),
});
export type TeamMessageHubSendInput = typeof TeamMessageHubSendInput.Type;

export const TeamMessageReference = Schema.Struct({ id: TrimmedNonEmptyString });
export type TeamMessageReference = typeof TeamMessageReference.Type;

export const TeamMessageDecideInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  decision: Schema.Literals(["installed", "accepted", "declined"]),
  /** Accepting a card needs the project whose board receives it, on the recipient's own IDE. */
  projectId: Schema.optionalKey(ProjectId),
});
export type TeamMessageDecideInput = typeof TeamMessageDecideInput.Type;
