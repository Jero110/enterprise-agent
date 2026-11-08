import { EnterpriseLoginInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import * as EnterpriseBootstrap from "./EnterpriseBootstrap.ts";

export const layer = Layer.unwrap(
  Effect.map(EnterpriseBootstrap.EnterpriseBootstrap, (bootstrap) =>
    HttpRouter.add(
      "POST",
      "/api/enterprise/connect",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const input = yield* request.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(EnterpriseLoginInput)),
        );
        const result = yield* bootstrap.connect(input);
        return HttpServerResponse.jsonUnsafe(result, { headers: { "cache-control": "no-store" } });
      }).pipe(
        Effect.catchTags({
          EnterpriseError: (error) =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe(
                { code: error.code, message: error.message },
                { status: 403 },
              ),
            ),
          SchemaError: () =>
            Effect.succeed(
              HttpServerResponse.jsonUnsafe({ message: "Enter your email." }, { status: 400 }),
            ),
        }),
        Effect.orElseSucceed(() =>
          HttpServerResponse.jsonUnsafe(
            { message: "The Enterprise hub could not complete sign-in." },
            { status: 500 },
          ),
        ),
      ),
    ),
  ),
);
