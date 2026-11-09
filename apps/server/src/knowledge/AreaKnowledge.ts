import {
  PREAUTHORIZED_ADMIN_EMAIL,
  type VerifiedIdentity,
  type KnowledgeDocument,
  type KnowledgeGraph,
  type KnowledgeDocumentSummary,
  type KnowledgeSearchHit,
  type AreaRequest,
  type TeamPrincipal,
  type AreaId,
  AreaKnowledgeError,
  EnterpriseError,
  KnowledgeShareInput,
  KnowledgePublishPersonalInput,
  type KnowledgeShareRevokeInput,
  type KnowledgeSharing,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import * as ServerConfig from "../config.ts";
import * as KnowledgeProposals from "../enterprise/KnowledgeProposals.ts";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import { GENERAL_AREA, KnowledgeRepo } from "./KnowledgeRepo.ts";

export interface AreaKnowledgeService {
  readonly getPrincipal: (identity: VerifiedIdentity) => Effect.Effect<TeamPrincipal>;

  /** The principal of an enrolled member's email, or null when the email cannot enter. */
  readonly getMemberPrincipal: (email: string) => Effect.Effect<TeamPrincipal | null>;

  readonly initializeLocalPersonalSkills: (
    principal: TeamPrincipal,
  ) => Effect.Effect<void, EnterpriseError>;
  readonly graph: (principal: TeamPrincipal) => Effect.Effect<KnowledgeGraph>;
  readonly sharing: (principal: TeamPrincipal) => Effect.Effect<KnowledgeSharing>;
  readonly publishPersonal: (
    principal: TeamPrincipal,
    input: KnowledgePublishPersonalInput,
  ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
  readonly share: (
    principal: TeamPrincipal,
    input: KnowledgeShareInput,
  ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
  readonly revokeShare: (
    principal: TeamPrincipal,
    input: KnowledgeShareRevokeInput,
  ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
  readonly unpublish: (
    principal: TeamPrincipal,
    path: string,
  ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;

  readonly listDocuments: (
    principal: TeamPrincipal,
  ) => Effect.Effect<ReadonlyArray<KnowledgeDocumentSummary>>;

  /** Text over path, headings and body, among the documents the principal may read. */
  readonly searchDocuments: (
    principal: TeamPrincipal,
    query: string,
  ) => Effect.Effect<ReadonlyArray<KnowledgeSearchHit>>;

  readonly readDocument: (
    principal: TeamPrincipal,
    documentId: string,
  ) => Effect.Effect<KnowledgeDocument, AreaKnowledgeError>;

  readonly requestAreaAccess: (
    principal: TeamPrincipal,
    areaId: AreaId,
  ) => Effect.Effect<AreaRequest, AreaKnowledgeError>;

  readonly resolveRequest: (
    adminPrincipal: TeamPrincipal,
    requestId: string,
    status: "approved" | "denied",
  ) => Effect.Effect<AreaRequest, AreaKnowledgeError>;

  readonly revokeAreaAccess: (
    adminPrincipal: TeamPrincipal,
    email: string,
    areaId: AreaId,
  ) => Effect.Effect<void, AreaKnowledgeError>;
}

export class AreaKnowledge extends Context.Service<AreaKnowledge, AreaKnowledgeService>()(
  "t3/knowledge/AreaKnowledge",
) {}

const MAX_HITS = 20;
const SNIPPET_CHARS = 160;
const PERSONAL_PATH = /^personal\/([a-f0-9]{64})\/[a-z0-9][a-z0-9-]{0,79}\.md$/;
const decodeShare = Schema.decodeUnknownEffect(KnowledgeShareInput);
const decodePublish = Schema.decodeUnknownEffect(KnowledgePublishPersonalInput);

/** Path matches outrank headings, which outrank body text. */
const scoreDocument = (doc: KnowledgeDocument, terms: ReadonlyArray<string>) => {
  const path = doc.id.toLowerCase();
  const lines = doc.content.split("\n");
  const headings = lines
    .filter((line) => line.startsWith("#"))
    .join("\n")
    .toLowerCase();
  const body = doc.content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!path.includes(term) && !body.includes(term)) return null;
    score += (path.includes(term) ? 3 : 0) + (headings.includes(term) ? 2 : 0) + 1;
  }
  const first = terms[0]!;
  const line = lines.find((l) => l.toLowerCase().includes(first)) ?? doc.title;
  return { score, snippet: line.trim().slice(0, SNIPPET_CHARS) };
};

const canReadDocument = (principal: TeamPrincipal, areaId: AreaId): boolean =>
  principal.isAdmin || areaId === GENERAL_AREA || principal.areaIds.includes(areaId);

export const layer = Layer.effect(
  AreaKnowledge,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const proposals = yield* KnowledgeProposals.KnowledgeProposals;

    const repo = yield* KnowledgeRepo;
    const random = yield* SecureRandom.SecureRandom;
    const sharingMutex = yield* Semaphore.make(1);
    const fs = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const skillsInitialized = yield* Ref.make(false);

    const principalOf = Effect.fn("AreaKnowledge.principalOf")(function* (
      email: string,
      displayName: string,
      isAnonymousDev: boolean,
    ) {
      const member = (yield* store.canEnter(email)) ? yield* store.getMember(email) : null;
      const isAdmin = member?.role === "admin";

      const areaIds: AreaId[] = [];
      if (isAdmin) {
        areaIds.push(...(yield* store.listTeams).map((team) => team.id));
      } else if (member) {
        if (member.teamId !== null) areaIds.push(member.teamId);
        areaIds.push(...(yield* store.listGrants(member.email)).map((grant) => grant.areaId));
      }

      return {
        email,
        displayName,
        isAdmin,
        areaIds: [...new Set(areaIds)],
        isAnonymousDev,
      } satisfies TeamPrincipal;
    });

    const getPrincipal: AreaKnowledgeService["getPrincipal"] = (identity) =>
      principalOf(identity.email, identity.displayName, identity.source === "anonymous-dev");

    const getMemberPrincipal: AreaKnowledgeService["getMemberPrincipal"] = Effect.fn(
      "AreaKnowledge.getMemberPrincipal",
    )(function* (email) {
      const member = (yield* store.canEnter(email)) ? yield* store.getMember(email) : null;
      return member === null ? null : yield* principalOf(member.email, member.displayName, false);
    });

    const accessFor = Effect.fn("AreaKnowledge.accessFor")(function* (principal: TeamPrincipal) {
      const current = yield* getMemberPrincipal(principal.email);
      const shares = yield* store.listKnowledgeShares;
      const activeKeys = new Set(
        (yield* store.listMembers)
          .filter((member) => member.authorized && !member.revoked)
          .map((member) => teamMemberKey(member.email)),
      );
      return (doc: KnowledgeDocument) => {
        if (!doc.id.startsWith("personal/"))
          return canReadDocument(
            current ?? { ...principal, isAdmin: false, areaIds: [] },
            doc.areaId,
          );
        if (current === null) return false;
        const owner = PERSONAL_PATH.exec(doc.id)?.[1];
        if (owner === undefined) return false;
        if (!activeKeys.has(owner)) return false;
        const key = teamMemberKey(current.email);
        return (
          owner === key ||
          shares.some(
            (share) =>
              share.path === doc.id &&
              (share.kind === "member"
                ? share.target === key
                : current.areaIds.includes(share.target)),
          )
        );
      };
    });

    const readable = Effect.fn("AreaKnowledge.readable")(function* (principal: TeamPrincipal) {
      const canRead = yield* accessFor(principal);
      return (yield* repo.documents).filter(canRead);
    });

    const sharing = Effect.fn("AreaKnowledge.sharing")(function* (
      principal: TeamPrincipal,
    ): Effect.fn.Return<KnowledgeSharing> {
      const shares = yield* store.listKnowledgeShares;
      const key = teamMemberKey(principal.email);
      const member = yield* store.getMember(principal.email);
      const areas = new Set([
        member?.teamId,
        ...(yield* store.listGrants(principal.email)).map((grant) => grant.areaId),
      ]);
      const summary = (doc: KnowledgeDocument) => ({
        id: doc.id,
        areaId: doc.areaId,
        title: doc.title,
        ...(doc.itemKind === undefined ? {} : { itemKind: doc.itemKind }),
      });
      const docs = (yield* readable(principal)).filter((doc) => PERSONAL_PATH.test(doc.id));
      return {
        sharedByMe: docs
          .filter((doc) => PERSONAL_PATH.exec(doc.id)?.[1] === key)
          .map((doc) => ({
            ...summary(doc),
            grants: shares
              .filter((share) => share.path === doc.id)
              .map(({ kind, target }) => ({ kind, target })),
          })),
        sharedWithMe: docs
          .filter(
            (doc) =>
              PERSONAL_PATH.exec(doc.id)?.[1] !== key &&
              shares.some(
                (share) =>
                  share.path === doc.id &&
                  (share.kind === "member" ? share.target === key : areas.has(share.target)),
              ),
          )
          .map(summary),
      };
    });

    const ownedPersonal = Effect.fn("AreaKnowledge.ownedPersonal")(function* (
      principal: TeamPrincipal,
      path: string,
    ) {
      const owner = PERSONAL_PATH.exec(path)?.[1];
      if (owner === undefined)
        return yield* new EnterpriseError({
          code: "invalid_proposal",
          message: "Choose a personal item path: personal/<member key>/<slug>.md.",
        });
      const current = yield* getMemberPrincipal(principal.email);
      if (current === null || (!current.isAdmin && teamMemberKey(current.email) !== owner))
        return yield* new EnterpriseError({
          code: "access_denied",
          message: "Only the owner or an admin can manage this personal item.",
        });
      return { current, owner, existing: (yield* repo.documents).find((doc) => doc.id === path) };
    });

    const writePersonal = Effect.fn("AreaKnowledge.writePersonal")(function* (
      principal: TeamPrincipal,
      path: string,
      content: string | null,
      exists: boolean,
    ) {
      yield* repo.apply(
        {
          id: yield* random.uuidV4(),
          kind: content === null ? "delete" : exists ? "update" : "create",
          scope: "personal",
          path,
          ...(content === null ? {} : { content }),
          reason: content === null ? "Unpublish personal item" : "Publish personal item copy",
          evidence: [],
          proposedBy: principal.email,
          createdAt: DateTime.formatIso(yield* DateTime.now),
          status: "pending",
          baseContentHash: yield* repo.contentHash(path),
          baseVersion: yield* repo.version(path),
          targetVersion: "",
        },
        principal.email,
      );
    });

    const publishPersonal = Effect.fn("AreaKnowledge.publishPersonal")(function* (
      principal: TeamPrincipal,
      raw: KnowledgePublishPersonalInput,
    ) {
      const { path, item } = yield* decodePublish(raw).pipe(
        Effect.mapError(
          () =>
            new EnterpriseError({
              code: "invalid_proposal",
              message: "Invalid personal item.",
            }),
        ),
      );
      const { current, owner, existing } = yield* ownedPersonal(principal, path);
      if (teamMemberKey(current.email) !== owner)
        return yield* new EnterpriseError({
          code: "access_denied",
          message: "Only the owner can publish a personal item.",
        });
      if ((item.kind === "skill" && item.layer !== "ai") || !item.content.trim())
        return yield* new EnterpriseError({
          code: "invalid_proposal",
          message: "Choose nonempty personal content; skills belong to the AI layer.",
        });
      // A repeated initialization never replaces the owner's changes or alters grants.
      if (!existing) {
        const content = `---\n${stringifyYaml({ title: item.title, description: item.description, area: "personal", layer: item.layer, private: true, links: [], itemKind: item.kind })}---\n${item.content}`;
        yield* writePersonal(current, path, content, false);
      }
      return yield* sharing(current);
    }, sharingMutex.withPermits(1));

    const initializeLocalPersonalSkills = Effect.fn("AreaKnowledge.initializeLocalPersonalSkills")(
      function* (principal: TeamPrincipal) {
        if (
          config.devUrl === undefined ||
          principal.email !== PREAUTHORIZED_ADMIN_EMAIL ||
          (yield* Ref.get(skillsInitialized))
        )
          return;
        const current = yield* getMemberPrincipal(principal.email);
        if (current === null) return;
        const root = pathService.join(config.cwd, ".agents", "skills");
        if (!(yield* fs.exists(root))) return;
        const realRoot = yield* fs.realPath(root);
        if (realRoot !== pathService.join(yield* fs.realPath(config.cwd), ".agents", "skills"))
          return;
        const names = yield* fs.readDirectory(root);
        for (const name of names.slice(0, 100)) {
          if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(name)) continue;
          const source = pathService.join(root, name, "SKILL.md");
          if (!(yield* fs.exists(source))) continue;
          const realSource = yield* fs.realPath(source);
          if (!realSource.startsWith(realRoot + pathService.sep)) continue;
          const size = (yield* fs.stat(realSource)).size;
          if (size > 200_000) continue;
          const content = yield* fs.readFileString(realSource);
          const metadata = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
          if (!metadata) continue;
          const parsed: unknown = yield* Effect.try(() => parseYaml(metadata[1]!)).pipe(
            Effect.orElseSucceed(() => null),
          );
          if (
            typeof parsed !== "object" ||
            parsed === null ||
            !("name" in parsed) ||
            parsed.name !== name
          )
            continue;
          const description =
            "description" in parsed && typeof parsed.description === "string"
              ? parsed.description
              : "";
          yield* publishPersonal(current, {
            path: `personal/${teamMemberKey(current.email)}/${name}.md`,
            item: { kind: "skill", title: name, description, layer: "ai", content },
          });
        }
        yield* Ref.set(skillsInitialized, true);
      },
      Effect.catch(() => Effect.logWarning("Could not initialize local personal skills.")),
    );

    const share = Effect.fn("AreaKnowledge.share")(function* (
      principal: TeamPrincipal,
      raw: KnowledgeShareInput,
    ) {
      const input = yield* decodeShare(raw).pipe(
        Effect.mapError(
          () =>
            new EnterpriseError({
              code: "invalid_proposal",
              message: "Invalid personal item or recipient.",
            }),
        ),
      );
      const { current, owner, existing } = yield* ownedPersonal(principal, input.path);
      const { grantee } = input;
      if (teamMemberKey(current.email) !== owner)
        return yield* new EnterpriseError({
          code: "access_denied",
          message: "Only the owner can share a personal item.",
        });
      const recipientExists =
        grantee.kind === "area"
          ? (yield* store.getTeam(grantee.target)) !== null
          : (yield* store.listMembers).some(
              (member) =>
                member.authorized &&
                !member.revoked &&
                teamMemberKey(member.email) === grantee.target,
            );
      if (!recipientExists)
        return yield* new EnterpriseError({
          code: "invalid_proposal",
          message: "Choose an active member or area.",
        });
      if (!existing)
        return yield* new EnterpriseError({
          code: "document_not_found",
          message: "Choose an existing personal item before sharing it.",
        });
      yield* store.grantKnowledgeShare(input.path, grantee, current.email);
      return yield* sharing(current);
    }, sharingMutex.withPermits(1));

    const revokeShare = Effect.fn("AreaKnowledge.revokeShare")(function* (
      principal: TeamPrincipal,
      input: KnowledgeShareRevokeInput,
    ) {
      const { current } = yield* ownedPersonal(principal, input.path);
      yield* store.revokeKnowledgeShare(input.path, input.grantee);
      return yield* sharing(current);
    }, sharingMutex.withPermits(1));

    const unpublish = Effect.fn("AreaKnowledge.unpublish")(function* (
      principal: TeamPrincipal,
      path: string,
    ) {
      const { current, existing } = yield* ownedPersonal(principal, path);
      yield* store.revokeKnowledgeShare(path);
      if (existing !== undefined) yield* writePersonal(current, path, null, true);
      return yield* sharing(current);
    }, sharingMutex.withPermits(1));

    const graph = Effect.fn("AreaKnowledge.graph")(function* (principal: TeamPrincipal) {
      const current = yield* getMemberPrincipal(principal.email);
      if (current === null) return { nodes: [] };
      const canRead = yield* accessFor(current);
      return {
        nodes: (yield* repo.documents)
          .filter((doc) => !doc.id.startsWith("personal/") || canRead(doc))
          .map((doc) => {
            const accessible = canRead(doc);
            return {
              id: doc.id,
              areaId: doc.areaId,
              title: doc.title,
              description: doc.description ?? "",
              layer: doc.layer ?? ("business" as const),
              private: doc.private ?? doc.areaId !== GENERAL_AREA,
              links: doc.links ?? [],
              accessible,
              ...(doc.itemKind === undefined ? {} : { itemKind: doc.itemKind }),
              ...(accessible ? { content: doc.content } : {}),
            };
          }),
      };
    });

    const listDocuments: AreaKnowledgeService["listDocuments"] = (principal) =>
      Effect.map(readable(principal), (docs) =>
        docs.map(({ id, areaId, title }) => ({ id, areaId, title })),
      );

    const searchDocuments: AreaKnowledgeService["searchDocuments"] = (principal, query) =>
      Effect.map(readable(principal), (docs) => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return [];
        return docs
          .flatMap((doc) => {
            const match = scoreDocument(doc, terms);
            return match === null
              ? []
              : [
                  {
                    score: match.score,
                    hit: {
                      id: doc.id,
                      areaId: doc.areaId,
                      title: doc.title,
                      snippet: match.snippet,
                    },
                  },
                ];
          })
          .toSorted((a, b) => b.score - a.score || a.hit.id.localeCompare(b.hit.id))
          .slice(0, MAX_HITS)
          .map((entry) => entry.hit);
      });

    const readDocument: AreaKnowledgeService["readDocument"] = Effect.fn(
      "AreaKnowledge.readDocument",
    )(function* (principal, documentId) {
      const doc = (yield* repo.documents).find((d) => d.id === documentId);

      if (!doc) {
        return yield* new AreaKnowledgeError({
          code: "document_not_found",
          message: "Document not found.",
        });
      }

      if (!(yield* accessFor(principal))(doc)) {
        return yield* new AreaKnowledgeError({
          code: doc.id.startsWith("personal/") ? "document_not_found" : "access_denied",
          message: "You do not have access to this document.",
        });
      }

      return doc;
    });

    const requestAreaAccess: AreaKnowledgeService["requestAreaAccess"] = Effect.fn(
      "AreaKnowledge.requestAreaAccess",
    )(function* (principal, areaId) {
      const current = yield* getMemberPrincipal(principal.email);
      if (current?.areaIds.includes(areaId))
        return yield* new AreaKnowledgeError({
          code: "already_has_access",
          message: "You already have access to this area.",
        });
      const proposal = yield* proposals
        .propose(principal.email, {
          kind: "area-access",
          scope: areaId,
          path: "",
          reason: "Request area knowledge access",
          evidence: [],
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new AreaKnowledgeError({
                code: error.code === "conflict" ? "request_already_exists" : "access_denied",
                message: error.message,
              }),
          ),
        );
      return {
        id: proposal.id,
        email: proposal.proposedBy,
        areaId: proposal.scope,
        status: "pending",
        requestedAt: DateTime.makeUnsafe(proposal.createdAt),
      };
    });

    const resolveRequest: AreaKnowledgeService["resolveRequest"] = Effect.fn(
      "AreaKnowledge.resolveRequest",
    )(function* (principal, requestId, status) {
      const request = (yield* store.listProposals).find(
        (p) => p.id === requestId && p.kind === "area-access",
      );
      if (!request)
        return yield* new AreaKnowledgeError({
          code: "request_not_found",
          message: "Request not found.",
        });
      const proposal = yield* proposals
        .decide(principal.email, {
          id: requestId,
          action: status === "approved" ? "approve" : "reject",
          reason: "Area access request denied",
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new AreaKnowledgeError({
                code: error.code === "access_denied" ? "admin_required" : "request_not_found",
                message: error.message,
              }),
          ),
        );
      return {
        id: proposal.id,
        email: proposal.proposedBy,
        areaId: proposal.scope,
        status,
        requestedAt: DateTime.makeUnsafe(proposal.createdAt),
        resolvedAt: DateTime.makeUnsafe(proposal.resolvedAt!),
        resolvedBy: proposal.resolvedBy!,
      };
    });

    const revokeAreaAccess: AreaKnowledgeService["revokeAreaAccess"] = Effect.fn(
      "AreaKnowledge.revokeAreaAccess",
    )(function* (adminPrincipal, email, areaId) {
      if (!adminPrincipal.isAdmin) {
        return yield* new AreaKnowledgeError({
          code: "admin_required",
          message: "Only administrators can revoke area access.",
        });
      }

      yield* store.revokeArea(email, areaId);
    });

    return {
      getPrincipal,
      getMemberPrincipal,
      graph,
      sharing,
      publishPersonal,
      initializeLocalPersonalSkills,
      share,
      revokeShare,
      unpublish,
      listDocuments,
      searchDocuments,
      readDocument,
      requestAreaAccess,
      resolveRequest,
      revokeAreaAccess,
    } satisfies AreaKnowledgeService;
  }),
);
