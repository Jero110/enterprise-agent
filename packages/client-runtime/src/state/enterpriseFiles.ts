import type { KnowledgeProposal, KnowledgeUploadInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/reactivity";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as RemoteAuthorization from "../authorization/service.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as Supervisor from "../connection/supervisor.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { createEnvironmentCommand } from "./runtime.ts";

const path = "/api/enterprise/proposals/files";
class EnterpriseFileError extends Data.TaggedError("EnterpriseFileError")<{
  readonly message: string;
}> {}

const enterpriseFileRequest = Effect.fn("enterprise.fileRequest")(function* (input: {
  readonly method: "GET" | "POST";
  readonly suffix?: string;
  readonly body?: KnowledgeUploadInput;
}) {
  const supervisor = yield* Supervisor.EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared).pipe(
    Effect.flatMap((value) =>
      Effect.fromOption(value).pipe(
        Effect.mapError(
          () => new EnterpriseFileError({ message: "Environment is not connected." }),
        ),
      ),
    ),
  );
  const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
  const remoteAuthorization = yield* Effect.serviceOption(
    RemoteAuthorization.RemoteEnvironmentAuthorization,
  );
  return yield* requestEnterpriseFile({ ...input, prepared, signer, remoteAuthorization });
});

export const requestEnterpriseFile = Effect.fn("enterprise.requestFile")(function* (input: {
  readonly method: "GET" | "POST";
  readonly suffix?: string;
  readonly body?: KnowledgeUploadInput;
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization: Option.Option<
    RemoteAuthorization.RemoteEnvironmentAuthorization["Service"]
  >;
}) {
  const http = yield* HttpClient.HttpClient;
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "auth",
    method: input.method,
    url: (urls) =>
      new URL(
        `${path}${input.suffix ?? ""}`,
        urls.webSocketTicketFor({ params: { use: "media" } }),
      ).toString(),
    timeoutMs: 60_000,
    request: ({ headers, requestUrl }) => {
      const request = (
        input.method === "POST"
          ? HttpClientRequest.post(requestUrl).pipe(HttpClientRequest.bodyJsonUnsafe(input.body))
          : HttpClientRequest.get(requestUrl)
      ).pipe(HttpClientRequest.setHeaders({ ...headers }));
      return http.execute(request);
    },
    isUnauthorizedResponse: (response) => response.status === 401,
  }).pipe(
    Effect.flatMap((response) =>
      Effect.gen(function* () {
        if (response.status !== 200) {
          const message = yield* response.text;
          return yield* new EnterpriseFileError({
            message: message || `Request failed (${response.status}).`,
          });
        }
        if (input.method === "POST") return (yield* response.json) as KnowledgeProposal;
        return yield* response.arrayBuffer;
      }),
    ),
  );
});

export function createEnterpriseFileCommands<R, E>(
  runtime: Atom.AtomRuntime<
    | import("../connection/registry.ts").EnvironmentRegistry
    | HttpClient.HttpClient
    | ManagedRelay.ManagedRelayDpopSigner
    | RemoteAuthorization.RemoteEnvironmentAuthorization
    | R,
    E
  >,
) {
  return {
    upload: createEnvironmentCommand(runtime, {
      label: "enterprise:upload-files",
      execute: (input: KnowledgeUploadInput) =>
        enterpriseFileRequest({ method: "POST", body: input }).pipe(
          Effect.map((value) => value as KnowledgeProposal),
        ),
    }),
    download: createEnvironmentCommand(runtime, {
      label: "enterprise:download-file",
      execute: (input: { proposalId: string; fileId: string }) =>
        enterpriseFileRequest({
          method: "GET",
          suffix: `/${encodeURIComponent(input.proposalId)}/${encodeURIComponent(input.fileId)}`,
        }).pipe(Effect.map((value) => value as ArrayBuffer)),
    }),
  };
}
