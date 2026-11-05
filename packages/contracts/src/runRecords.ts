import * as Schema from "effect/Schema";

export const RunRecordInput = Schema.Struct({
  threadId: Schema.String,
  turnId: Schema.String,
  provider: Schema.NullOr(Schema.String),
  model: Schema.NullOr(Schema.String),
  inputTokens: Schema.NullOr(Schema.Number),
  outputTokens: Schema.NullOr(Schema.Number),
  toolCalls: Schema.Array(
    Schema.Struct({ name: Schema.String, mcpServer: Schema.NullOr(Schema.String) }),
  ),
  knowledgeReads: Schema.Array(Schema.String),
  proposalIds: Schema.Array(Schema.String),
  startedAt: Schema.String,
  endedAt: Schema.String,
  outcome: Schema.Literal("unknown"),
});
export type RunRecordInput = typeof RunRecordInput.Type;
export const RunRecord = Schema.Struct({
  ...RunRecordInput.fields,
  member: Schema.String,
  teamId: Schema.NullOr(Schema.String),
});
export type RunRecord = typeof RunRecord.Type;
export const RunsQuery = Schema.Struct({
  teamId: Schema.optional(Schema.String),
  member: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  turnId: Schema.optional(Schema.String),
});
export type RunsQuery = typeof RunsQuery.Type;
