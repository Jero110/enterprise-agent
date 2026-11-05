import type { KnowledgeDocument } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import { GLOBAL_OVERVIEW, areaReadme } from "./starterKnowledge.ts";

export const GENERAL_AREA = "general";

/**
 * The hub's knowledge: a git repo at `<home>/enterprise/knowledge` with
 * `global/` and `areas/<teamId>/`. Documents are markdown; the path is the id
 * and nothing a caller sends reaches the file system, so there is no path to escape.
 */
export class KnowledgeRepo extends Context.Service<
  KnowledgeRepo,
  {
    /** Every document, read from the working tree on each call; no scope filtering here. */
    readonly documents: Effect.Effect<ReadonlyArray<KnowledgeDocument>>;
  }
>()("t3/knowledge/KnowledgeRepo") {}

const titleOf = (path: string, content: string): string =>
  /^#\s+(.+)$/m.exec(content)?.[1]?.trim() ?? path;

export const layer = Layer.effect(
  KnowledgeRepo,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const runner = yield* ProcessRunner.ProcessRunner;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const root = path.join(config.baseDir, "enterprise", "knowledge");

    const git = (...args: ReadonlyArray<string>) =>
      runner.run({
        command: "git",
        args: ["-c", "user.name=T3 Enterprise", "-c", "user.email=hub@t3.invalid", ...args],
        cwd: root,
      });

    const initialize = Effect.gen(function* () {
      const files: Array<readonly [string, string]> = [["global/overview.md", GLOBAL_OVERVIEW]];
      for (const team of yield* store.listTeams) {
        files.push([`areas/${team.id}/README.md`, areaReadme(team.id, team.name)]);
      }
      for (const [file, content] of files) {
        yield* fs.makeDirectory(path.dirname(path.join(root, file)), { recursive: true });
        yield* fs.writeFileString(path.join(root, file), content);
      }
      yield* git("init", "--quiet");
      yield* git("add", "-A");
      yield* git("commit", "--quiet", "-m", "chore(knowledge): starter set");
    });

    // A hub without git still serves the files; only history is lost.
    yield* fs.exists(path.join(root, ".git")).pipe(
      Effect.flatMap((exists) => (exists ? Effect.void : initialize)),
      Effect.catchCause((cause) => Effect.logWarning("knowledge repo init failed", cause)),
    );

    const markdownIn = (dir: string): Effect.Effect<ReadonlyArray<string>> =>
      fs.readDirectory(path.join(root, dir), { recursive: true }).pipe(
        Effect.map((entries) =>
          entries
            .filter((entry) => entry.endsWith(".md"))
            .map((entry) => `${dir}/${entry.split(path.sep).join("/")}`),
        ),
        Effect.orElseSucceed(() => []),
      );

    const documents = Effect.gen(function* () {
      const teams = yield* fs
        .readDirectory(path.join(root, "areas"))
        .pipe(Effect.orElseSucceed(() => []));
      const paths = [
        ...(yield* markdownIn("global")).toSorted(),
        ...(yield* Effect.forEach(teams.toSorted(), (team) => markdownIn(`areas/${team}`)))
          .flat()
          .toSorted(),
      ];
      const read = yield* Effect.forEach(paths, (id) =>
        fs.readFileString(path.join(root, id)).pipe(
          Effect.map((content): KnowledgeDocument => {
            const areaId = id.startsWith("global/") ? GENERAL_AREA : id.split("/")[1]!;
            return { id, areaId, title: titleOf(id, content), content };
          }),
          Effect.option,
        ),
      );
      return read.flatMap((doc) => (doc._tag === "Some" ? [doc.value] : []));
    });

    return KnowledgeRepo.of({ documents });
  }),
);
