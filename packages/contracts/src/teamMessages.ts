import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TEAM_MESSAGE_NOTE_MAX_CHARS = 2_000;
export const TEAM_SKILL_CONTENT_MAX_CHARS = 64_000;
/** A skill travels as its folder name, which becomes the folder the recipient installs into. */
export const TEAM_SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

const TeamMessageKind = Schema.Literals(["message", "skill"]);

/** `installed` and `declined` only apply to skill requests. */
const TeamMessageStatus = Schema.Literals(["unread", "read", "installed", "declined"]);

export const TeamSharedSkill = Schema.Struct({
  name: TrimmedNonEmptyString,
  description: Schema.String,
  content: Schema.String,
});
export type TeamSharedSkill = typeof TeamSharedSkill.Type;

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
});
export type TeamMessageHubSendInput = typeof TeamMessageHubSendInput.Type;

export const TeamMessageReference = Schema.Struct({ id: TrimmedNonEmptyString });
export type TeamMessageReference = typeof TeamMessageReference.Type;

export const TeamMessageDecideInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  decision: Schema.Literals(["installed", "declined"]),
});
export type TeamMessageDecideInput = typeof TeamMessageDecideInput.Type;
