import {
  EnterpriseError,
  TEAM_SKILL_CONTENT_MAX_CHARS,
  TEAM_SKILL_NAME_PATTERN,
  type ProjectBoard,
  type ProjectId,
  type ProjectTask,
  type TeamMessage,
  type TeamMessageDecideInput,
  type TeamMessageSendInput,
  type TeamSharedSkill,
  type TeamSharedTask,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as ProjectBoards from "../project/ProjectBoards.ts";

/**
 * The member IDE's side of team messages: it reads a skill from this machine before sending it,
 * and installs a received skill, or adds a received card to a board, only when its recipient
 * accepts it here. Nobody, person or agent, writes into someone else's board directly.
 */
export class TeamMessenger extends Context.Service<
  TeamMessenger,
  {
    readonly send: (input: TeamMessageSendInput) => Effect.Effect<TeamMessage, EnterpriseError>;
    readonly decide: (input: TeamMessageDecideInput) => Effect.Effect<TeamMessage, EnterpriseError>;
    /** An agent proposing a card for a colleague's board; it waits in their requests. */
    readonly sendCard: (input: {
      readonly recipientKey: string;
      readonly task: TeamSharedTask;
      readonly note?: string;
    }) => Effect.Effect<TeamMessage, EnterpriseError>;
  }
>()("t3/team/TeamMessenger") {}

const invalid = (message: string) => new EnterpriseError({ code: "invalid_message", message });
const notYours = new EnterpriseError({
  code: "message_not_found",
  message: "That message does not exist or is not yours.",
});
const answered = new EnterpriseError({
  code: "conflict",
  message: "This request was already answered.",
});

/** Accepted cards collect on one board, so a colleague's request never lands inside your own boards. */
export const TEAM_REQUESTS_BOARD = { id: "team-requests", name: "Solicitudes del equipo" } as const;

function cardFor(message: TeamMessage, task: TeamSharedTask): ProjectTask {
  const from = message.viaAgent
    ? `Lo pidió ${message.fromDisplayName} (con su agente).`
    : `Lo pidió ${message.fromDisplayName}.`;
  return {
    // The message id makes accepting twice (say, after a dropped hub answer) add the card once.
    id: message.id,
    title: task.title.slice(0, 300),
    description: [message.note, task.description.trim(), from]
      .filter((part) => part !== null && part.length > 0)
      .join("\n\n")
      .slice(0, 20_000),
    status: "backlog",
    priority: task.priority,
    assignees: [],
    tags: [`de ${message.fromDisplayName}`.slice(0, 300)],
    dueDate: task.dueDate,
  };
}

function withCard(boards: ReadonlyArray<ProjectBoard>, card: ProjectTask) {
  const requests = boards.find((board) => board.id === TEAM_REQUESTS_BOARD.id);
  if (requests === undefined) return [...boards, { ...TEAM_REQUESTS_BOARD, tasks: [card] }];
  if (requests.tasks.some((task) => task.id === card.id)) return null;
  return boards.map((board) =>
    board.id === TEAM_REQUESTS_BOARD.id ? { ...board, tasks: [...board.tasks, card] } : board,
  );
}

/** `description:` from the SKILL.md front matter, if there is one. */
function skillDescription(content: string): string {
  // Windows editors often save a BOM before the front matter.
  const frontMatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
  const line = frontMatter.split(/\r?\n/).find((entry) => /^description\s*:/.test(entry));
  return (line?.replace(/^description\s*:\s*/, "").replace(/^["']|["']$/g, "") ?? "").slice(
    0,
    1_000,
  );
}

/** Where a shared skill lands: the user skill folders Claude Code and Codex both read. */
const skillInstallDirectories = Effect.fn("TeamMessenger.skillInstallDirectories")(function* (
  name: string,
) {
  const path = yield* Path.Path;
  const home = yield* HostProcess.HomeDirectory;
  const env = yield* HostProcess.Environment;
  const claude = env.CLAUDE_CONFIG_DIR?.trim() || path.join(home, ".claude");
  const codex = env.CODEX_HOME?.trim() || path.join(home, ".codex");
  return [path.join(claude, "skills", name), path.join(codex, "skills", name)];
});

export const layer = Layer.effect(
  TeamMessenger,
  Effect.gen(function* () {
    const enterprise = yield* EnterpriseClient.EnterpriseClient;
    const boards = yield* ProjectBoards.ProjectBoards;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const readSkill = Effect.fn("TeamMessenger.readSkill")(function* (skillPath: string) {
      if (path.basename(skillPath) !== "SKILL.md")
        return yield* invalid("Choose a skill (a SKILL.md file).");
      const name = path.basename(path.dirname(skillPath));
      if (!TEAM_SKILL_NAME_PATTERN.test(name))
        return yield* invalid(
          "That skill can't be shared: skill folder names use lowercase letters, numbers, - and _.",
        );
      const content = yield* fs
        .readFileString(skillPath)
        .pipe(Effect.mapError(() => invalid("Could not read that skill on this computer.")));
      if (content.length > TEAM_SKILL_CONTENT_MAX_CHARS)
        return yield* invalid("That skill is too large to share.");
      return { name, description: skillDescription(content), content } satisfies TeamSharedSkill;
    });

    const install = Effect.fn("TeamMessenger.install")(function* (skill: TeamSharedSkill) {
      // The hub validated this too; the files land on this machine, so check again here.
      if (!TEAM_SKILL_NAME_PATTERN.test(skill.name) || skill.content.trim().length === 0)
        return yield* invalid("This skill can't be installed.");
      if (skill.content.length > TEAM_SKILL_CONTENT_MAX_CHARS)
        return yield* invalid("That skill is too large to install.");
      const directories = yield* skillInstallDirectories(skill.name).pipe(
        Effect.provideService(Path.Path, path),
      );
      for (const directory of directories) {
        if (
          yield* fs.exists(path.join(directory, "SKILL.md")).pipe(Effect.orElseSucceed(() => true))
        )
          return yield* new EnterpriseError({
            code: "skill_exists",
            message: "You already have a skill with that name. Rename or remove yours first.",
          });
      }
      const writeFailed = () =>
        new EnterpriseError({
          code: "invalid_message",
          message: "Could not write the skill on this computer.",
        });
      for (const directory of directories) {
        yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.mapError(writeFailed));
        yield* fs
          .writeFileString(path.join(directory, "SKILL.md"), skill.content)
          .pipe(Effect.mapError(writeFailed));
      }
    });

    const boardFailed = (error: { readonly code: string }) =>
      invalid(
        error.code === "not_found"
          ? "Open a project to add the card to its board."
          : "Could not add the card to your board. Try again.",
      );
    const addCard = Effect.fn("TeamMessenger.addCard")(function* (
      projectId: ProjectId,
      card: ProjectTask,
    ) {
      // The board saves by revision; a concurrent edit makes us re-read and try again.
      for (let attempt = 0; attempt < 3; attempt++) {
        const snapshot = yield* boards.get({ projectId }).pipe(Effect.mapError(boardFailed));
        const next = withCard(snapshot.boards, card);
        if (next === null) return;
        const saved = yield* boards
          .save({ projectId, revision: snapshot.revision, boards: next })
          .pipe(Effect.result);
        if (saved._tag === "Success") return;
        if (saved.failure.code !== "conflict") return yield* boardFailed(saved.failure);
      }
      return yield* invalid("Your board kept changing. Try again.");
    });

    const send: TeamMessenger["Service"]["send"] = Effect.fn("TeamMessenger.send")(
      function* (input) {
        const skill = input.skillPath === undefined ? undefined : yield* readSkill(input.skillPath);
        return yield* enterprise.messageSend({
          recipientKey: input.recipientKey,
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(skill === undefined ? {} : { skill }),
        });
      },
    );

    const decide: TeamMessenger["Service"]["decide"] = Effect.fn("TeamMessenger.decide")(
      function* (input) {
        if (input.decision !== "declined") {
          const message = (yield* enterprise.messagesList).find((entry) => entry.id === input.id);
          if (message === undefined || message.outgoing) return yield* notYours;
          if (message.status !== "unread" && message.status !== "read") return yield* answered;
          if (input.decision === "installed") {
            if (message.skill === null) return yield* answered;
            yield* install(message.skill);
          } else {
            if (message.task === null) return yield* invalid("That message isn't a card request.");
            if (input.projectId === undefined)
              return yield* invalid("Open a project to add the card to its board.");
            yield* addCard(input.projectId, cardFor(message, message.task));
          }
        }
        return yield* enterprise.messageDecide({ id: input.id, decision: input.decision });
      },
    );

    const sendCard: TeamMessenger["Service"]["sendCard"] = Effect.fn("TeamMessenger.sendCard")(
      function* (input) {
        return yield* enterprise.messageSend({
          recipientKey: input.recipientKey,
          task: input.task,
          viaAgent: true,
          ...(input.note === undefined ? {} : { note: input.note }),
        });
      },
    );

    return TeamMessenger.of({ send, decide, sendCard });
  }),
);
