import {
  EnterpriseError,
  type EnterpriseIngestStartInput,
  EnterpriseIngestStartResult,
  type KnowledgeProposeInput,
  KnowledgeProposal,
  KnowledgeProposalInbox,
  type KnowledgeProposalDecision,
  type KnowledgeProposalInboxInput,
  type KnowledgeUploadInput,
  type KnowledgeAttachmentInput,
  KnowledgeAttachment,
  EnvironmentId,
  type EnterpriseAuthorizeMemberInput,
  type EnterpriseConnectInput,
  EnterpriseHubIdentity,
  type EnterpriseConnectResult,
  EnterpriseBootstrapResult,
  ExecutionEnvironmentDescriptor,
  EnterpriseMembers,
  EnterpriseOrg,
  type EnterpriseOrgFiles,
  EnterpriseOrgImportResult,
  type EnterpriseRevokeMemberInput,
  type EnterpriseStatus,
  KnowledgeDocument,
  KnowledgeDocumentList,
  KnowledgeGraph,
  KnowledgeSharing,
  type KnowledgeShareInput,
  type KnowledgeShareRevokeInput,
  type KnowledgeGetInput,
  type KnowledgeSearchInput,
  KnowledgeSearchResult,
  type OrchestratorMcpFailure,
  type RunRecordInput,
  type PeerLinkError,
  TeamThreadSummary,
  TeamThreadSnapshot,
  TeamPublicationResult,
  type TeamThreadPublishInput,
  type TeamThreadReference,
  type TeamThreadReport,
} from "@t3tools/contracts";
import { resolveEnterpriseHubOrigin } from "@t3tools/shared/remote";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import { hubResult } from "./EnterpriseToolkit.ts";

const decodeEnvironmentDescriptor = Schema.decodeUnknownEffect(ExecutionEnvironmentDescriptor);
const decodeBootstrapResult = Schema.decodeUnknownEffect(EnterpriseBootstrapResult);
const decodeBootstrapError = Schema.decodeUnknownEffect(
  Schema.Struct({ code: EnterpriseError.fields.code, message: Schema.String }),
);

/**
 * A member IDE's side of the enterprise: it links to the hub, binds that link's
 * session to an email with the enterprise token, and forwards admin calls.
 * Everything the IDE shows comes from the hub's answer, never from a cache.
 */
export class EnterpriseClient extends Context.Service<
  EnterpriseClient,
  {
    readonly ingestStart: (
      input: EnterpriseIngestStartInput,
    ) => Effect.Effect<EnterpriseIngestStartResult, EnterpriseError>;
    readonly knowledgePropose: (
      input: KnowledgeProposeInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly proposalUpload: (
      input: KnowledgeUploadInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly proposalAttachment: (
      input: KnowledgeAttachmentInput,
    ) => Effect.Effect<typeof KnowledgeAttachment.Type, EnterpriseError>;
    readonly proposalInbox: (
      input: KnowledgeProposalInboxInput,
    ) => Effect.Effect<KnowledgeProposalInbox, EnterpriseError>;
    readonly proposalDecide: (
      input: KnowledgeProposalDecision,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly status: Effect.Effect<EnterpriseStatus, EnterpriseError>;
    /** The linked hub, read locally so it answers while the hub is offline. */
    readonly hubEnvironmentId: Effect.Effect<EnvironmentId | null>;
    readonly runReport: (
      input: RunRecordInput,
    ) => Effect.Effect<TeamPublicationResult, EnterpriseError>;
    readonly connectionChanges: Stream.Stream<void>;
    readonly teamList: Effect.Effect<ReadonlyArray<TeamThreadSummary>, EnterpriseError>;
    readonly teamGet: (
      input: TeamThreadReference,
    ) => Effect.Effect<TeamThreadSnapshot, EnterpriseError>;
    readonly teamReport: (
      input: TeamThreadReport,
    ) => Effect.Effect<TeamPublicationResult, EnterpriseError>;
    readonly teamPublish: (
      input: TeamThreadPublishInput,
    ) => Effect.Effect<TeamPublicationResult, EnterpriseError>;
    readonly connect: (
      input: EnterpriseConnectInput,
    ) => Effect.Effect<EnterpriseConnectResult, EnterpriseError | PeerLinkError>;
    readonly disconnect: Effect.Effect<{ readonly disconnected: boolean }>;
    readonly listMembers: Effect.Effect<EnterpriseMembers, EnterpriseError>;
    readonly org: Effect.Effect<EnterpriseOrg, EnterpriseError>;
    /** Admin only on the hub: previews the org import, and writes it when `apply`. */
    readonly orgImport: (
      files: EnterpriseOrgFiles,
      apply: boolean,
    ) => Effect.Effect<EnterpriseOrgImportResult, EnterpriseError>;
    readonly authorize: (
      input: EnterpriseAuthorizeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    readonly revoke: (
      input: EnterpriseRevokeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    /** The hub's answer for this member; the IDE never filters or caches knowledge itself. */
    readonly knowledgeShare: (
      input: KnowledgeShareInput,
    ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
    readonly knowledgeShareRevoke: (
      input: KnowledgeShareRevokeInput,
    ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
    readonly knowledgeUnpublish: (
      input: KnowledgeGetInput,
    ) => Effect.Effect<KnowledgeSharing, EnterpriseError>;
    readonly knowledgeSharing: Effect.Effect<KnowledgeSharing, EnterpriseError>;
    readonly knowledgeGraph: Effect.Effect<KnowledgeGraph, EnterpriseError>;
    readonly knowledgeRequestAccess: (
      input: KnowledgeGetInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly knowledgeList: Effect.Effect<KnowledgeDocumentList, EnterpriseError>;
    readonly knowledgeSearch: (
      input: KnowledgeSearchInput,
    ) => Effect.Effect<KnowledgeSearchResult, EnterpriseError>;
    readonly knowledgeGet: (
      input: KnowledgeGetInput,
    ) => Effect.Effect<KnowledgeDocument, EnterpriseError>;
  }
>()("t3/enterprise/EnterpriseClient") {}

type HubResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly code: EnterpriseError["code"]; readonly message: string };

const Connection = Schema.Struct({ hubEnvironmentId: EnvironmentId });
const decodeConnection = Schema.decodeUnknownEffect(Schema.fromJsonString(Connection));

const CONNECTION_FILE = "enterprise-connection.json";
// Read-only: the hub authorizes by the member's role, so the link needs no more.
const LIMITS = { runtimeMode: "approval-required", interactionMode: "default" } as const;

const notConnected = new EnterpriseError({
  code: "not_connected",
  message: "Connect to your enterprise first.",
});

const unreachable = (failure: OrchestratorMcpFailure) =>
  new EnterpriseError({ code: "hub_unreachable", message: failure.message });

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const links = yield* PeerLinks.PeerLinks;
  const peer = yield* PeerMcpClient.PeerMcpClient;
  const connectionPath = path.join(config.stateDir, CONNECTION_FILE);
  const changes = yield* PubSub.unbounded<void>();

  const readConnection = fs.readFileString(connectionPath).pipe(
    Effect.flatMap(decodeConnection),
    Effect.map((connection) => connection.hubEnvironmentId),
    Effect.orElseSucceed(() => null),
  );
  const writeConnection = (hubEnvironmentId: EnvironmentId) =>
    fs
      .makeDirectory(config.stateDir, { recursive: true })
      .pipe(
        Effect.andThen(fs.writeFileString(connectionPath, JSON.stringify({ hubEnvironmentId }))),
        Effect.orDie,
      );
  const clearConnection = fs.remove(connectionPath, { force: true }).pipe(Effect.ignore);

  const callHub = <S extends Schema.Decoder<unknown>>(
    hubEnvironmentId: EnvironmentId,
    tool: string,
    args: Record<string, unknown>,
    success: S,
  ) =>
    peer.call({ environmentId: hubEnvironmentId, tool, arguments: args, limits: LIMITS, success });

  const callResult = <A>(
    hubEnvironmentId: EnvironmentId,
    tool: string,
    args: Record<string, unknown>,
    value: Schema.Decoder<A>,
  ) =>
    callHub(
      hubEnvironmentId,
      tool,
      args,
      hubResult(value as Schema.Top) as unknown as Schema.Decoder<HubResult<A>>,
    ).pipe(
      Effect.mapError(unreachable),
      Effect.flatMap((result) =>
        result.ok
          ? Effect.succeed(result.value)
          : Effect.fail(new EnterpriseError({ code: result.code, message: result.message })),
      ),
    );

  const withConnection = <A>(use: (hub: EnvironmentId) => Effect.Effect<A, EnterpriseError>) =>
    Effect.flatMap(readConnection, (hub) => (hub === null ? Effect.fail(notConnected) : use(hub)));

  const identityOf = (hubEnvironmentId: EnvironmentId) =>
    callResult(hubEnvironmentId, "enterprise_whoami", {}, EnterpriseHubIdentity).pipe(
      Effect.map((identity) => ({ ...identity, hubEnvironmentId })),
    );

  const status: EnterpriseClient["Service"]["status"] = Effect.gen(function* () {
    const hub = yield* readConnection;
    if (hub === null) return { identity: null };
    return yield* identityOf(hub).pipe(
      Effect.map((identity) => ({ identity })),
      // The hub forgot this session (a reset hub): nothing to show, not an error.
      Effect.catchIf(
        (error) => error.code === "not_connected",
        () => clearConnection.pipe(Effect.as({ identity: null })),
      ),
    );
  }).pipe(Effect.withSpan("EnterpriseClient.status"));

  const connect: EnterpriseClient["Service"]["connect"] = Effect.fn("EnterpriseClient.connect")(
    function* (input) {
      if ("hubUrl" in input) {
        const origin = yield* Effect.try({
          try: () =>
            resolveEnterpriseHubOrigin(input.hubUrl, { tokenless: input.token === undefined }),
          catch: () =>
            new EnterpriseError({
              code: "access_denied",
              message:
                "Enterprise sign-in requires an HTTPS, Tailscale or loopback environment URL. Plain HTTP LAN would expose the reusable token.",
            }),
        });
        const issued = yield* Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient;
          const descriptorResponse = yield* http.get(`${origin}/.well-known/t3/environment`);
          const descriptor = yield* descriptorResponse.json.pipe(
            Effect.flatMap(decodeEnvironmentDescriptor),
          );
          if (descriptor.capabilities.enterpriseOnboarding !== true) {
            return yield* new EnterpriseError({
              code: "hub_unreachable",
              message:
                "This server does not support unified Enterprise sign-in. Update and restart the Enterprise hub.",
            });
          }
          const request = yield* HttpClientRequest.bodyJson(
            HttpClientRequest.post(`${origin}/api/enterprise/connect`),
            { email: input.email, ...(input.token === undefined ? {} : { token: input.token }) },
          );
          const response = yield* http.execute(request);
          const body = yield* response.json;
          if (response.status === 403) {
            const error = yield* decodeBootstrapError(body);
            return yield* new EnterpriseError(error);
          }
          if (response.status !== 200) {
            return yield* new EnterpriseError({
              code: "hub_unreachable",
              message:
                "The Enterprise hub could not complete sign-in. Update and restart it, then try again.",
            });
          }
          return yield* decodeBootstrapResult(body);
        }).pipe(
          Effect.provide(FetchHttpClient.layer),
          Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
          Effect.timeout("15 seconds"),
          Effect.catchTags({
            HttpClientError: () =>
              Effect.fail(
                new EnterpriseError({
                  code: "hub_unreachable",
                  message: "Could not reach the Enterprise hub.",
                }),
              ),
            HttpBodyError: () =>
              Effect.fail(
                new EnterpriseError({
                  code: "hub_unreachable",
                  message: "Could not prepare Enterprise sign-in.",
                }),
              ),
            SchemaError: () =>
              Effect.fail(
                new EnterpriseError({
                  code: "hub_unreachable",
                  message: "The hub does not support this sign-in protocol. Update and restart it.",
                }),
              ),
            TimeoutError: () =>
              Effect.fail(
                new EnterpriseError({
                  code: "hub_unreachable",
                  message: "The Enterprise hub did not answer in time.",
                }),
              ),
          }),
        );
        yield* links.adoptEnterprise({
          url: origin,
          environmentId: issued.environmentId,
          token: issued.mcpToken,
          expiresAt: issued.mcpExpiresAt,
        });
        yield* writeConnection(issued.environmentId);
        yield* PubSub.publish(changes, undefined);
        return {
          ...issued.identity,
          hubEnvironmentId: issued.environmentId,
        };
      }
      if (!("link" in input)) {
        return yield* new EnterpriseError({
          code: "not_connected",
          message:
            "This environment has no Enterprise configured. Connect to your company's environment first, or enter its Enterprise URL.",
        });
      }
      const before = new Set((yield* links.list).map((link) => link.environmentId));
      const link = yield* links.link(input.link);
      const hub = link.environmentId;
      return yield* callResult(
        hub,
        "enterprise_enroll",
        { email: input.email, ...(input.token === undefined ? {} : { token: input.token }) },
        EnterpriseHubIdentity,
      ).pipe(
        Effect.tap(() => writeConnection(hub)),
        Effect.tap(() => PubSub.publish(changes, undefined)),
        Effect.map((identity) => ({ ...identity, hubEnvironmentId: hub })),
        // A refused login leaves no link behind, unless the hub was already linked for other work.
        Effect.tapError(() =>
          before.has(hub) ? Effect.void : links.unlink(hub).pipe(Effect.ignore),
        ),
      );
    },
  );

  const disconnect: EnterpriseClient["Service"]["disconnect"] = Effect.gen(function* () {
    const hub = yield* readConnection;
    if (hub === null) return { disconnected: false };
    // Best effort: the hub may be down, and the member must still be able to leave.
    yield* callHub(
      hub,
      "enterprise_disconnect",
      {},
      Schema.Struct({ disconnected: Schema.Boolean }),
    ).pipe(Effect.ignore);
    yield* links.unlink(hub).pipe(Effect.ignore);
    yield* clearConnection;
    yield* PubSub.publish(changes, undefined);
    return { disconnected: true };
  }).pipe(Effect.withSpan("EnterpriseClient.disconnect"));

  return EnterpriseClient.of({
    ingestStart: Effect.fn("EnterpriseClient.ingestStart")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_ingest_start", input, EnterpriseIngestStartResult),
      ),
    ),
    knowledgePropose: Effect.fn("EnterpriseClient.knowledgePropose")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_propose", input, KnowledgeProposal)),
    ),
    proposalUpload: Effect.fn("EnterpriseClient.proposalUpload")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_upload_files", input, KnowledgeProposal)),
    ),
    proposalAttachment: Effect.fn("EnterpriseClient.proposalAttachment")((input) =>
      withConnection((hub) =>
        callResult(hub, "knowledge_proposal_attachment", input, KnowledgeAttachment),
      ),
    ),
    proposalInbox: Effect.fn("EnterpriseClient.proposalInbox")((input) =>
      withConnection((hub) =>
        callResult(hub, "knowledge_proposals", input, KnowledgeProposalInbox),
      ),
    ),
    proposalDecide: Effect.fn("EnterpriseClient.proposalDecide")((input) =>
      withConnection((hub) =>
        callResult(hub, "knowledge_proposal_decide", input, KnowledgeProposal),
      ),
    ),
    status,
    hubEnvironmentId: readConnection,
    runReport: Effect.fn("EnterpriseClient.runReport")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_run_report", input, TeamPublicationResult),
      ),
    ),
    connectionChanges: Stream.fromPubSub(changes),
    teamList: withConnection((hub) =>
      callResult(hub, "enterprise_team_list", {}, Schema.Array(TeamThreadSummary)),
    ),
    teamGet: Effect.fn("EnterpriseClient.teamGet")((input) =>
      withConnection((hub) => callResult(hub, "enterprise_team_get", input, TeamThreadSnapshot)),
    ),
    teamReport: Effect.fn("EnterpriseClient.teamReport")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_team_report", input, TeamPublicationResult),
      ),
    ),
    teamPublish: Effect.fn("EnterpriseClient.teamPublish")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_team_publish", input, TeamPublicationResult),
      ),
    ),
    connect,
    disconnect,
    listMembers: withConnection((hub) =>
      callResult(hub, "enterprise_members", {}, EnterpriseMembers),
    ),
    org: withConnection((hub) => callResult(hub, "enterprise_org", {}, EnterpriseOrg)),
    orgImport: Effect.fn("EnterpriseClient.orgImport")((files, apply) =>
      withConnection((hub) =>
        callResult(
          hub,
          "enterprise_org_import",
          { ...files, mode: apply ? "apply" : "preview" },
          EnterpriseOrgImportResult,
        ),
      ),
    ),
    authorize: Effect.fn("EnterpriseClient.authorize")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_member_authorize", input, EnterpriseMembers),
      ),
    ),
    revoke: Effect.fn("EnterpriseClient.revoke")((input) =>
      withConnection((hub) =>
        callResult(hub, "enterprise_member_revoke", input, EnterpriseMembers),
      ),
    ),
    knowledgeShare: Effect.fn("EnterpriseClient.knowledgeShare")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_share", input, KnowledgeSharing)),
    ),
    knowledgeShareRevoke: Effect.fn("EnterpriseClient.knowledgeShareRevoke")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_share_revoke", input, KnowledgeSharing)),
    ),
    knowledgeUnpublish: Effect.fn("EnterpriseClient.knowledgeUnpublish")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_unpublish", input, KnowledgeSharing)),
    ),
    knowledgeSharing: withConnection((hub) =>
      callResult(hub, "knowledge_sharing", {}, KnowledgeSharing),
    ),
    knowledgeGraph: withConnection((hub) => callResult(hub, "knowledge_graph", {}, KnowledgeGraph)),
    knowledgeRequestAccess: Effect.fn("EnterpriseClient.knowledgeRequestAccess")((input) =>
      withConnection((hub) =>
        callResult(hub, "knowledge_request_access", input, KnowledgeProposal),
      ),
    ),
    knowledgeList: withConnection((hub) =>
      callResult(hub, "knowledge_list", {}, KnowledgeDocumentList),
    ),
    knowledgeSearch: Effect.fn("EnterpriseClient.knowledgeSearch")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_search", input, KnowledgeSearchResult)),
    ),
    knowledgeGet: Effect.fn("EnterpriseClient.knowledgeGet")((input) =>
      withConnection((hub) => callResult(hub, "knowledge_get", input, KnowledgeDocument)),
    ),
  });
});

export const layer = Layer.effect(EnterpriseClient, make);
