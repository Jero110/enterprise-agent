import {
  EnterpriseError,
  type KnowledgeDocument,
  type KnowledgeProposal,
} from "@t3tools/contracts";
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
    readonly version: (path: string) => Effect.Effect<string, EnterpriseError>;
    readonly apply: (
      proposal: KnowledgeProposal,
      approver: string,
    ) => Effect.Effect<string, EnterpriseError>;
    readonly revert: (
      proposal: KnowledgeProposal,
      approver: string,
    ) => Effect.Effect<string, EnterpriseError>;
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

    // Read access remains available when git initialization fails.
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

    const checkedGit = Effect.fn("KnowledgeRepo.git")(function* (...args: ReadonlyArray<string>) {
      const result = yield* git(...args).pipe(
        Effect.mapError(
          () =>
            new EnterpriseError({
              code: "knowledge_write_failed",
              message: "Knowledge git command failed.",
            }),
        ),
      );
      if (result.code !== 0)
        return yield* new EnterpriseError({
          code: "knowledge_write_failed",
          message: "Knowledge git command failed.",
        });
      return result.stdout.trim();
    });
    const version = Effect.fn("KnowledgeRepo.version")((file: string) =>
      checkedGit("log", "-1", "--format=%H", "--", file),
    );
    const destination = (proposal: KnowledgeProposal) => {
      const prefix = proposal.scope === "global" ? "global/" : `areas/${proposal.scope}/`;
      const target =
        proposal.targetScope === "global" ? "global/" : `areas/${proposal.targetScope}/`;
      return target + proposal.path.slice(prefix.length);
    };
    const trailers = (proposal: KnowledgeProposal, approver: string) =>
      `Proposal-Id: ${proposal.id}\nProposed-By: ${proposal.proposedBy}\nApproved-By: ${approver}\nEvidence: ${proposal.evidence.join(", ") || "none"}`;
    const apply = Effect.fn("KnowledgeRepo.apply")(function* (
      proposal: KnowledgeProposal,
      approver: string,
    ) {
      if ((yield* checkedGit("status", "--porcelain")) !== "") {
        return yield* new EnterpriseError({
          code: "conflict",
          message: "Knowledge has uncommitted changes.",
        });
      }
      const target = proposal.kind === "move-scope" ? destination(proposal) : null;
      if (
        proposal.kind !== "area-access" &&
        ((yield* version(proposal.path)) !== proposal.baseVersion ||
          (target !== null && (yield* version(target)) !== proposal.targetVersion))
      ) {
        return yield* new EnterpriseError({
          code: "conflict",
          message:
            "This document changed since the proposal. Propose again against the current version.",
        });
      }
      const files =
        proposal.kind === "area-access"
          ? []
          : [proposal.path, ...(target === null ? [] : [target])];
      const snapshots = yield* Effect.forEach(files, (file) =>
        fs.readFileString(path.join(root, file)).pipe(Effect.option),
      );
      const change = Effect.gen(function* () {
        if (proposal.kind === "create" || proposal.kind === "update") {
          yield* fs.makeDirectory(path.dirname(path.join(root, proposal.path)), {
            recursive: true,
          });
          yield* fs.writeFileString(path.join(root, proposal.path), proposal.content!);
        } else if (proposal.kind === "delete") {
          yield* fs.remove(path.join(root, proposal.path));
        } else if (target !== null) {
          yield* fs.makeDirectory(path.dirname(path.join(root, target)), { recursive: true });
          yield* fs.rename(path.join(root, proposal.path), path.join(root, target));
        }
        if (files.length > 0) yield* checkedGit("add", "--", ...files);
        yield* checkedGit(
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          `knowledge: ${proposal.kind} ${proposal.path || proposal.scope}\n\n${trailers(proposal, approver)}`,
        );
        return yield* checkedGit("rev-parse", "HEAD");
      }).pipe(
        Effect.mapError(
          () =>
            new EnterpriseError({
              code: "knowledge_write_failed",
              message: "Could not apply knowledge proposal.",
            }),
        ),
      );
      return yield* change.pipe(
        Effect.tapError(() =>
          Effect.gen(function* () {
            if (files.length > 0) yield* git("reset", "HEAD", "--", ...files).pipe(Effect.ignore);
            yield* Effect.forEach(files, (file, index) => {
              const before = snapshots[index]!;
              return before._tag === "Some"
                ? fs.writeFileString(path.join(root, file), before.value).pipe(Effect.ignore)
                : fs.remove(path.join(root, file), { force: true }).pipe(Effect.ignore);
            });
          }),
        ),
      );
    });
    const revert = Effect.fn("KnowledgeRepo.revert")(function* (
      proposal: KnowledgeProposal,
      approver: string,
    ) {
      if ((yield* checkedGit("status", "--porcelain")) !== "")
        return yield* new EnterpriseError({
          code: "conflict",
          message: "Knowledge has uncommitted changes.",
        });
      if (proposal.kind === "area-access") {
        yield* checkedGit(
          "commit",
          "--quiet",
          "--allow-empty",
          "-m",
          `Revert proposal ${proposal.id}\n\n${trailers(proposal, approver)}`,
        );
      } else {
        yield* checkedGit("revert", "--no-commit", proposal.commit!).pipe(
          Effect.catch(() =>
            git("revert", "--abort").pipe(
              Effect.ignore,
              Effect.andThen(
                Effect.fail(
                  new EnterpriseError({
                    code: "conflict",
                    message: "Revert conflicts with later knowledge changes.",
                  }),
                ),
              ),
            ),
          ),
        );
        yield* checkedGit(
          "commit",
          "--quiet",
          "-m",
          `Revert proposal ${proposal.id}\n\n${trailers(proposal, approver)}`,
        );
      }
      return yield* checkedGit("rev-parse", "HEAD");
    });
    return KnowledgeRepo.of({ documents, version, apply, revert });
  }),
);
