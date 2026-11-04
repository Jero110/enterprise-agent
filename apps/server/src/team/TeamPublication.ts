import { type ThreadMetadata, type ThreadPublication, TeamActivityError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as TeamDirectory from "./TeamDirectory.ts";

type DirectoryPrincipal = TeamDirectory.DirectoryPrincipal;

interface StoredThread {
  readonly metadata: ThreadMetadata;
  readonly publication: ThreadPublication;
}

export interface TeamPublicationService {
  readonly registerThread: (
    threadId: string,
    ownerEmail: string,
    title: string,
  ) => Effect.Effect<void>;
  readonly publishToTeam: (
    principal: DirectoryPrincipal,
    threadId: string,
  ) => Effect.Effect<ThreadPublication, TeamActivityError>;
  readonly unpublish: (
    principal: DirectoryPrincipal,
    threadId: string,
  ) => Effect.Effect<ThreadPublication, TeamActivityError>;
  readonly canReadThreadContent: (
    principal: DirectoryPrincipal,
    threadId: string,
  ) => Effect.Effect<boolean>;
  readonly listThreadMetadata: (
    principal: DirectoryPrincipal,
  ) => Effect.Effect<ReadonlyArray<ThreadMetadata>>;
}

export class TeamPublication extends Context.Service<TeamPublication, TeamPublicationService>()(
  "t3/team/TeamPublication",
) {}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const layer = Layer.effect(
  TeamPublication,
  Effect.gen(function* () {
    const threads = yield* Ref.make(HashMap.empty<string, StoredThread>());

    const getThread = (threadId: string) =>
      Ref.get(threads).pipe(
        Effect.flatMap((all) => {
          const thread = HashMap.get(all, threadId);
          return thread._tag === "Some"
            ? Effect.succeed(thread.value)
            : Effect.fail(
                new TeamActivityError({ code: "thread_not_found", message: "Thread not found." }),
              );
        }),
      );

    const registerThread: TeamPublicationService["registerThread"] = Effect.fn(
      "TeamPublication.registerThread",
    )(function* (threadId, ownerEmail, title) {
      const owner = normalizeEmail(ownerEmail);
      yield* Ref.update(threads, (all) =>
        HashMap.set(all, threadId, {
          metadata: {
            threadId,
            title,
            ownerEmail: owner,
            ownerDisplayName: owner,
            status: "idle",
            publicationStatus: "unpublished",
          },
          publication: { threadId, status: "unpublished" },
        }),
      );
    });

    const publishToTeam: TeamPublicationService["publishToTeam"] = Effect.fn(
      "TeamPublication.publishToTeam",
    )(function* (principal, threadId) {
      const thread = yield* getThread(threadId);
      if (normalizeEmail(principal.email) !== thread.metadata.ownerEmail) {
        return yield* new TeamActivityError({
          code: "access_denied",
          message: "Only the thread owner can publish it.",
        });
      }
      if (principal.teamId === undefined) {
        return yield* new TeamActivityError({
          code: "access_denied",
          message: "Join a team before publishing a thread.",
        });
      }
      if (thread.publication.status === "published") {
        return yield* new TeamActivityError({
          code: "already_published",
          message: "Thread is already published.",
        });
      }
      const now = yield* DateTime.now;
      const publication: ThreadPublication = {
        threadId,
        status: "published",
        teamId: principal.teamId,
        publishedAt: now,
        publishedBy: normalizeEmail(principal.email),
      };
      yield* Ref.update(threads, (all) =>
        HashMap.set(all, threadId, {
          ...thread,
          publication,
          metadata: { ...thread.metadata, publicationStatus: "published" },
        }),
      );
      return publication;
    });

    const unpublish: TeamPublicationService["unpublish"] = Effect.fn("TeamPublication.unpublish")(
      function* (principal, threadId) {
        const thread = yield* getThread(threadId);
        if (normalizeEmail(principal.email) !== thread.metadata.ownerEmail) {
          return yield* new TeamActivityError({
            code: "access_denied",
            message: "Only the thread owner can unpublish it.",
          });
        }
        if (thread.publication.status !== "published") {
          return yield* new TeamActivityError({
            code: "not_published",
            message: "Thread is not published.",
          });
        }
        const publication: ThreadPublication = { threadId, status: "unpublished" };
        yield* Ref.update(threads, (all) =>
          HashMap.set(all, threadId, {
            ...thread,
            publication,
            metadata: { ...thread.metadata, publicationStatus: "unpublished" },
          }),
        );
        return publication;
      },
    );

    const canReadThreadContent: TeamPublicationService["canReadThreadContent"] = Effect.fn(
      "TeamPublication.canReadThreadContent",
    )(function* (principal, threadId) {
      const thread = yield* getThread(threadId).pipe(Effect.orElseSucceed(() => undefined));
      if (thread === undefined) return false;
      if (normalizeEmail(principal.email) === thread.metadata.ownerEmail) return true;
      return (
        thread.publication.status === "published" &&
        principal.teamId !== undefined &&
        principal.teamId === thread.publication.teamId
      );
    });

    const listThreadMetadata: TeamPublicationService["listThreadMetadata"] = Effect.fn(
      "TeamPublication.listThreadMetadata",
    )(function* (_principal) {
      const all = yield* Ref.get(threads);
      return Array.from(HashMap.values(all), (thread) => thread.metadata);
    });

    return {
      registerThread,
      publishToTeam,
      unpublish,
      canReadThreadContent,
      listThreadMetadata,
    } satisfies TeamPublicationService;
  }),
);
