import * as Schema from "effect/Schema";
import { ProjectId, NonNegativeInt } from "./baseSchemas.ts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100));
const Label = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(300));
export const ProjectTask = Schema.Struct({
  id: Id,
  title: Label,
  description: Schema.String.check(Schema.isMaxLength(20_000)),
  status: Schema.Literals(["backlog", "in_progress", "blocked", "complete"]),
  priority: Schema.NullOr(Schema.Literals(["urgent", "high", "normal", "low"])),
  assignees: Schema.Array(Label).check(Schema.isMaxLength(20)),
  tags: Schema.Array(Label).check(Schema.isMaxLength(20)),
  dueDate: Schema.NullOr(Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
});
export type ProjectTask = typeof ProjectTask.Type;
export const ProjectBoard = Schema.Struct({
  id: Id,
  name: Label,
  tasks: Schema.Array(ProjectTask).check(Schema.isMaxLength(500)),
});
export type ProjectBoard = typeof ProjectBoard.Type;
export const ProjectBoardSnapshot = Schema.Struct({
  revision: NonNegativeInt,
  boards: Schema.Array(ProjectBoard).check(Schema.isMaxLength(30)),
});
export type ProjectBoardSnapshot = typeof ProjectBoardSnapshot.Type;
export const ProjectBoardInput = Schema.Struct({ projectId: ProjectId });
export const ProjectBoardSaveInput = Schema.Struct({
  ...ProjectBoardInput.fields,
  ...ProjectBoardSnapshot.fields,
});
export type ProjectBoardSaveInput = typeof ProjectBoardSaveInput.Type;
export class ProjectBoardError extends Schema.TaggedError<ProjectBoardError>()(
  "ProjectBoardError",
  {
    code: Schema.Literals(["not_found", "conflict", "invalid", "storage"]),
  },
) {
  override get message(): string {
    switch (this.code) {
      case "not_found":
        return "The project or card was not found.";
      case "conflict":
        return "The board changed in another window. Refresh and try again.";
      case "invalid":
        return "The board exceeds its limits or contains duplicate identifiers.";
      case "storage":
        return "The project board could not be stored or read.";
    }
  }
}
