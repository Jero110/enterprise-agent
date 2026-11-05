import { type ThreadMetadata, type ThreadPublication, TeamActivityError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as TeamDirectory from "./TeamDirectory.ts";
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";

type DirectoryPrincipal = TeamDirectory.DirectoryPrincipal;

interface StoredThread {
  readonly metadata: ThreadMetadata;
  readonly publication: ThreadPublication;
  readonly parentThreadId?: string;
}

export interface TeamPublicationService {
  readonly registerThread: (
    threadId: string,
    ownerEmail: string,
    title: string,
    options?: { readonly parentThreadId?: string; readonly status?: ThreadMetadata["status"] },
  ) => Effect.Effect<void, TeamActivityError>;
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
    const store = yield* EnterpriseStore.EnterpriseStore;
    const denied = new TeamActivityError({
      code: "access_denied",
      message: "Thread access denied.",
    });
    const activeMember = Effect.fn("TeamPublication.activeMember")(function* (email: string) {
      const member = yield* store.getMember(email);
      return member?.authorized && !member.revoked ? member : null;
    });

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

    const rootOf = (all: HashMap.HashMap<string, StoredThread>, thread: StoredThread) => {
      let root = thread;
      while (root.parentThreadId !== undefined) {
        const parent = HashMap.get(all, root.parentThreadId);
        if (parent._tag === "None") return undefined;
        root = parent.value;
      }
      return root;
    };

    const registerThread: TeamPublicationService["registerThread"] = Effect.fn(
      "TeamPublication.registerThread",
    )(function* (threadId, ownerEmail, title, options) {
      const owner = normalizeEmail(ownerEmail);
      if ((yield* activeMember(owner)) === null) return yield* denied;
      const all = yield* Ref.get(threads);
      const existing = HashMap.get(all, threadId);
      if (existing._tag === "Some") {
        if (
          existing.value.metadata.ownerEmail !== owner ||
          existing.value.parentThreadId !== options?.parentThreadId
        ) {
          return yield* denied;
        }
        yield* Ref.update(threads, (current) =>
          HashMap.set(current, threadId, {
            ...existing.value,
            metadata: {
              ...existing.value.metadata,
              title,
              status: options?.status ?? existing.value.metadata.status,
            },
          }),
        );
        return;
      }
      if (options?.parentThreadId !== undefined) {
        const parent = yield* getThread(options.parentThreadId);
        if (parent.metadata.ownerEmail !== owner || threadId === options.parentThreadId)
          return yield* denied;
      }
      yield* Ref.update(threads, (current) =>
        HashMap.set(current, threadId, {
          metadata: {
            threadId,
            title,
            ownerEmail: owner,
            ownerDisplayName: owner,
            status: options?.status ?? "idle",
            publicationStatus: "unpublished",
          },
          publication: { threadId, status: "unpublished" },
          ...(options?.parentThreadId === undefined
            ? {}
            : { parentThreadId: options.parentThreadId }),
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
      const owner = yield* activeMember(principal.email);
      if (owner === null || thread.parentThreadId !== undefined) return yield* denied;
      if (owner.teamId === null) {
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
        teamId: owner.teamId,
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
        if ((yield* activeMember(principal.email)) === null || thread.parentThreadId !== undefined)
          return yield* denied;
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
      const viewer = yield* activeMember(principal.email);
      const owner = yield* activeMember(thread.metadata.ownerEmail);
      if (viewer === null || owner === null) return false;
      if (viewer.email === owner.email) return true;
      const root = rootOf(yield* Ref.get(threads), thread);
      return (
        root?.publication.status === "published" &&
        owner.teamId !== null &&
        owner.teamId === root.publication.teamId &&
        (viewer.role === "admin" || viewer.teamId === owner.teamId)
      );
    });

    const listThreadMetadata: TeamPublicationService["listThreadMetadata"] = Effect.fn(
      "TeamPublication.listThreadMetadata",
    )(function* (principal) {
      const viewer = yield* activeMember(principal.email);
      if (viewer === null) return [];
      const all = yield* Ref.get(threads);
      const members = new Map(
        (yield* store.listMembers)
          .filter((member) => member.authorized && !member.revoked)
          .map((member) => [member.email, member]),
      );
      const summaries: ThreadMetadata[] = [];
      for (const thread of HashMap.values(all)) {
        const owner = members.get(thread.metadata.ownerEmail);
        if (
          owner === undefined ||
          (viewer.role !== "admin" &&
            viewer.email !== owner.email &&
            (viewer.teamId === null || viewer.teamId !== owner.teamId))
        )
          continue;
        const root = rootOf(all, thread);
        summaries.push({
          ...thread.metadata,
          ownerDisplayName: owner.displayName,
          publicationStatus:
            root?.publication.status === "published" && root.publication.teamId === owner.teamId
              ? "published"
              : "unpublished",
        });
      }
      return summaries.sort((a, b) => a.threadId.localeCompare(b.threadId));
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
