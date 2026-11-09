import { EnterpriseError, type EnterpriseIdentity } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as TeamPublication from "../team/TeamPublication.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import { EnterpriseSession, HOST_AGENT_SESSION } from "./EnterpriseSession.ts";
import * as RunRecords from "./RunRecords.ts";

const make = Effect.gen(function* () {
  const hub = yield* EnterpriseHub.EnterpriseHub;
  const publication = yield* TeamPublication.TeamPublication;
  const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
  const runs = yield* RunRecords.RunRecords;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const environmentId = yield* environment.getEnvironmentId;
  const changes = yield* PubSub.unbounded<void>();
  const session = EnterpriseSession.pipe(
    Effect.filterOrFail(
      (id) => id !== null,
      () =>
        new EnterpriseError({
          code: "not_connected",
          message: "Connect with your email and Enterprise token first.",
        }),
    ),
  );
  const identity = Effect.fn("EnterpriseHubClient.identity")(function* (): Effect.fn.Return<
    EnterpriseIdentity,
    EnterpriseError
  > {
    return { ...(yield* hub.whoami(yield* session)), hubEnvironmentId: environmentId };
  });

  return EnterpriseClient.EnterpriseClient.of({
    status: identity().pipe(
      Effect.tap((member) =>
        member.role !== "admin"
          ? Effect.void
          : hub.whoami(HOST_AGENT_SESSION).pipe(
              Effect.filterOrFail(
                (current) => current.email === member.email,
                () =>
                  new EnterpriseError({ code: "not_connected", message: "Stale agent session." }),
              ),
              Effect.catch(() => hub.enroll(HOST_AGENT_SESSION, { email: member.email })),
              Effect.ignore,
            ),
      ),
      Effect.map((identity) => ({ configured: true, identity })),
      Effect.catchIf(
        (error) => error.code === "not_connected",
        () => Effect.succeed({ configured: true, identity: null }),
      ),
    ),
    hubEnvironmentId: Effect.succeed(environmentId),
    connectionChanges: Stream.fromPubSub(changes),
    connect: Effect.fn("EnterpriseHubClient.connect")(function* (input) {
      const id = yield* session;
      const member = yield* hub.enroll(id, input);
      // Only an admin speaks for this hub's own agents; paired members must not become them.
      if (member.role === "admin") yield* hub.enroll(HOST_AGENT_SESSION, { email: member.email });
      yield* PubSub.publish(changes, undefined);
      return { ...member, hubEnvironmentId: environmentId };
    }),
    disconnect: Effect.gen(function* () {
      const id = yield* EnterpriseSession;
      const disconnected = id !== null && (yield* hub.disconnect(id));
      yield* hub.disconnect(HOST_AGENT_SESSION).pipe(Effect.ignore);
      yield* PubSub.publish(changes, undefined);
      return { disconnected };
    }),
    listMembers: Effect.flatMap(session, hub.listMembers),
    connector: Effect.fn("EnterpriseHubClient.connector")(function* (input) {
      return yield* hub.connector(yield* session, input);
    }),
    org: Effect.flatMap(session, hub.org),
    orgImport: Effect.fn("EnterpriseHubClient.orgImport")(function* (files, apply) {
      return yield* hub.orgImport(yield* session, files, apply);
    }),
    authorize: Effect.fn("EnterpriseHubClient.authorize")(function* (input) {
      return yield* hub.authorize(yield* session, input);
    }),
    revoke: Effect.fn("EnterpriseHubClient.revoke")(function* (input) {
      return yield* hub.revoke(yield* session, input);
    }),
    knowledgeList: Effect.flatMap(session, hub.knowledgeList),
    knowledgeGet: Effect.fn("EnterpriseHubClient.knowledgeGet")(function* (input) {
      return yield* hub.knowledgeGet(yield* session, input);
    }),
    knowledgeSearch: Effect.fn("EnterpriseHubClient.knowledgeSearch")(function* (input) {
      return yield* hub.knowledgeSearch(yield* session, input);
    }),
    knowledgePropose: Effect.fn("EnterpriseHubClient.knowledgePropose")(function* (input) {
      return yield* hub.knowledgePropose(yield* session, input);
    }),
    proposalUpload: Effect.fn("EnterpriseHubClient.proposalUpload")(function* (input) {
      return yield* hub.proposalUpload(yield* session, input);
    }),
    proposalAttachment: Effect.fn("EnterpriseHubClient.proposalAttachment")(function* (input) {
      return yield* hub.proposalAttachment(yield* session, input);
    }),
    proposalInbox: Effect.fn("EnterpriseHubClient.proposalInbox")(function* (input) {
      return yield* hub.proposalInbox(yield* session, input);
    }),
    proposalDecide: Effect.fn("EnterpriseHubClient.proposalDecide")(function* (input) {
      return yield* hub.proposalDecide(yield* session, input);
    }),
    ingestStart: Effect.fn("EnterpriseHubClient.ingestStart")(function* (input) {
      return yield* ingestion.start(yield* session, input);
    }),
    teamList: Effect.flatMap(session, publication.list),
    teamGet: Effect.fn("EnterpriseHubClient.teamGet")(function* (input) {
      return yield* publication.get(yield* session, input);
    }),
    teamPublish: Effect.fn("EnterpriseHubClient.teamPublish")(function* (input) {
      return yield* publication.publish(yield* session, input);
    }),
    teamReport: Effect.fn("EnterpriseHubClient.teamReport")(function* (input) {
      return yield* publication.report(yield* session, input);
    }),
    runReport: Effect.fn("EnterpriseHubClient.runReport")(function* (input) {
      return yield* runs.report(yield* session, input);
    }),
  });
});

export const layer = Layer.effect(EnterpriseClient.EnterpriseClient, make);
