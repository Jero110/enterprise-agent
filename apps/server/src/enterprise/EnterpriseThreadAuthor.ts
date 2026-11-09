import type * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";

type Session = Pick<EnvironmentAuth.AuthenticatedSession, "sessionId" | "subject" | "client">;

export class EnterpriseThreadAuthor extends Context.Service<
  EnterpriseThreadAuthor,
  {
    readonly author: (
      session: Session,
    ) => Effect.Effect<{ readonly email: string; readonly displayName: string } | null>;
  }
>()("t3/enterprise/EnterpriseThreadAuthor") {}

const layerHub = Layer.effect(
  EnterpriseThreadAuthor,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    return EnterpriseThreadAuthor.of({
      author: Effect.fn("EnterpriseThreadAuthor.author")(function* (session) {
        const enrollment = yield* store.getEnrollment(session.sessionId);
        // Earlier unified sessions kept their email in the server-issued session label.
        const legacyEmail =
          session.subject === "cli-issued-session" &&
          session.client.label?.startsWith("Enterprise · ")
            ? session.client.label.slice("Enterprise · ".length)
            : null;
        const email = enrollment?.email ?? legacyEmail;
        if (email === null || !(yield* store.canEnter(email))) return null;
        const member = yield* store.getMember(email);
        return member === null ? null : { email: member.email, displayName: member.displayName };
      }),
    });
  }),
);

const layerMember = Layer.effect(
  EnterpriseThreadAuthor,
  Effect.gen(function* () {
    const client = yield* EnterpriseClient.EnterpriseClient;
    return EnterpriseThreadAuthor.of({
      author: Effect.fn("EnterpriseThreadAuthor.author")((_session) =>
        client.status.pipe(
          Effect.map((status) =>
            status.identity === null
              ? null
              : { email: status.identity.email, displayName: status.identity.displayName },
          ),
          Effect.orElseSucceed(() => null),
        ),
      ),
    });
  }),
);

const layerHubWithStore = layerHub.pipe(Layer.provide(EnterpriseStore.layerHub));

export const layer = Layer.unwrap(
  Effect.map(
    ServerConfig.ServerConfig,
    (
      config,
    ): Layer.Layer<
      EnterpriseThreadAuthor,
      never,
      Layer.Services<typeof layerHubWithStore> | Layer.Services<typeof layerMember>
    > => (config.enterpriseHub === true ? layerHubWithStore : layerMember),
  ),
);
