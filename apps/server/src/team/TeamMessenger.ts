import {
  EnterpriseError,
  TEAM_SKILL_CONTENT_MAX_CHARS,
  TEAM_SKILL_NAME_PATTERN,
  type TeamMessage,
  type TeamMessageDecideInput,
  type TeamMessageSendInput,
  type TeamSharedSkill,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";

/**
 * The member IDE's side of team messages: it reads a skill from this machine before sending it,
 * and installs a received skill only when its recipient accepts it here.
 */
export class TeamMessenger extends Context.Service<
  TeamMessenger,
  {
    readonly send: (input: TeamMessageSendInput) => Effect.Effect<TeamMessage, EnterpriseError>;
    readonly decide: (input: TeamMessageDecideInput) => Effect.Effect<TeamMessage, EnterpriseError>;
  }
>()("t3/team/TeamMessenger") {}

const invalid = (message: string) => new EnterpriseError({ code: "invalid_message", message });

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
        if (input.decision === "installed") {
          const message = (yield* enterprise.messagesList).find((entry) => entry.id === input.id);
          if (message === undefined || message.outgoing)
            return yield* new EnterpriseError({
              code: "message_not_found",
              message: "That message does not exist or is not yours.",
            });
          if (
            message.skill === null ||
            message.status === "installed" ||
            message.status === "declined"
          )
            return yield* new EnterpriseError({
              code: "conflict",
              message: "This request was already answered.",
            });
          yield* install(message.skill);
        }
        return yield* enterprise.messageDecide(input);
      },
    );

    return TeamMessenger.of({ send, decide });
  }),
);
