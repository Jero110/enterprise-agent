import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Result from "effect/Result";
import { makePublicLookup, IngestionSources, layer } from "./IngestionSources.ts";

const commit = "a".repeat(40);
const fake = (
  responses: Record<string, { body: string; status?: number; type?: string }>,
  requests: string[],
) =>
  layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          requests.push(request.url);
          const response = responses[request.url];
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response(response?.body ?? "missing", {
                status: response?.status ?? (response ? 200 : 404),
                headers: { "content-type": response?.type ?? "application/json" },
              }),
            ),
          );
        }),
      ),
    ),
  );

it.effect(
  "imports an immutable GitHub raw tree, excludes build/demo and reports unsupported binary sources",
  () => {
    const requests: string[] = [];
    const root = "https://api.github.com/repos/acme/knowledge";
    return Effect.gen(function* () {
      const sources = yield* IngestionSources;
      const loaded = yield* sources.load("https://github.com/acme/knowledge");
      expect(loaded.files.map((file) => file.path)).toEqual([
        `github/acme/knowledge/${commit}/raw/meet/planning.txt`,
      ]);
      expect(new TextDecoder().decode(loaded.files[0]!.bytes)).toContain("ACORDADA");
      expect(loaded.skipped.map((file) => file.path)).toEqual([
        "raw/data/tables.sqlite",
        "raw/docs/policy.pdf",
        "raw/sheets/forecast.xlsx",
      ]);
      expect(requests).not.toContain("https://github.com/acme/knowledge");
      expect(
        requests.filter((url) => url.startsWith("https://raw.githubusercontent.com/")),
      ).toEqual([
        `https://raw.githubusercontent.com/acme/knowledge/${commit}/raw/meet/planning.txt`,
      ]);
    }).pipe(
      Effect.provide(
        fake(
          {
            [root]: { body: JSON.stringify({ default_branch: "main" }) },
            [`${root}/commits/main`]: { body: JSON.stringify({ sha: commit }) },
            [`${root}/git/trees/${commit}?recursive=1`]: {
              body: JSON.stringify({
                truncated: false,
                tree: [
                  { path: "demo/result.md", type: "blob", mode: "100644", size: 3 },
                  { path: "raw/_build/generated.md", type: "blob", mode: "100644", size: 3 },
                  { path: "raw/demo/result.md", type: "blob", mode: "100644", size: 3 },
                  { path: "raw/meet/planning.txt", type: "blob", mode: "100644", size: 200 },
                  { path: "raw/docs/policy.pdf", type: "blob", mode: "100644", size: 10 },
                  { path: "raw/sheets/forecast.xlsx", type: "blob", mode: "100644", size: 10 },
                  { path: "raw/data/tables.sqlite", type: "blob", mode: "100644", size: 10 },
                ],
              }),
            },
            [`https://raw.githubusercontent.com/acme/knowledge/${commit}/raw/meet/planning.txt`]: {
              body: "Decisiones\nACORDADA: revisar borrador\nPendiente: aprobar presupuesto",
              type: "text/plain",
            },
          },
          requests,
        ),
      ),
    );
  },
);

it.effect(
  "respects raw manifest area boundaries instead of routing restricted files into general knowledge",
  () => {
    const root = "https://api.github.com/repos/acme/knowledge";
    const requests: string[] = [];
    return Effect.gen(function* () {
      const sources = yield* IngestionSources;
      const loaded = yield* sources.load("https://github.com/acme/knowledge", "global");
      expect(loaded.files.map((file) => file.path)).toEqual([
        `github/acme/knowledge/${commit}/raw/public.txt`,
      ]);
      expect(loaded.skipped).toContainEqual({
        path: "raw/restricted.txt",
        reason: "Source belongs to another destination.",
      });
      expect(requests.some((url) => url.endsWith("/restricted.txt"))).toBe(false);
      const personal = yield* Effect.result(
        sources.load("https://github.com/acme/knowledge", "personal"),
      );
      expect(personal).toMatchObject({
        _tag: "Failure",
        failure: { code: "ingestion_empty_destination" },
      });
      if (Result.isFailure(personal)) {
        expect(personal.failure.message).toContain("destination");
        expect(personal.failure.message).not.toContain("Binary");
      }
    }).pipe(
      Effect.provide(
        fake(
          {
            [root]: { body: JSON.stringify({ default_branch: "main" }) },
            [`${root}/commits/main`]: { body: JSON.stringify({ sha: commit }) },
            [`${root}/git/trees/${commit}?recursive=1`]: {
              body: JSON.stringify({
                truncated: false,
                tree: [
                  { path: "raw/_manifest.csv", type: "blob", mode: "100644", size: 100 },
                  { path: "raw/public.txt", type: "blob", mode: "100644", size: 5 },
                  { path: "raw/restricted.txt", type: "blob", mode: "100644", size: 10 },
                ],
              }),
            },
            [`https://raw.githubusercontent.com/acme/knowledge/${commit}/raw/_manifest.csv`]: {
              body: "path,tipo_fuente,area_acceso,descripcion\npublic.txt,documento,general,Public notes\nrestricted.txt,documento,ventas,Restricted notes\n",
              type: "text/plain",
            },
            [`https://raw.githubusercontent.com/acme/knowledge/${commit}/raw/public.txt`]: {
              body: "hello",
              type: "text/plain",
            },
          },
          requests,
        ),
      ),
    );
  },
);

it.effect(
  "rejects truncated trees, unsafe paths, redirects and oversized content instead of claiming a complete import",
  () => {
    const root = "https://api.github.com/repos/acme/knowledge";
    return Effect.gen(function* () {
      for (const body of [
        { truncated: true, tree: [] },
        {
          truncated: false,
          tree: [{ path: "raw/../secret.txt", type: "blob", mode: "100644", size: 1 }],
        },
        {
          truncated: false,
          tree: Array.from({ length: 201 }, (_, i) => ({
            path: `raw/${i}.txt`,
            type: "blob",
            mode: "100644",
            size: 1,
          })),
        },
      ]) {
        const result = yield* Effect.result(
          Effect.flatMap(IngestionSources, (service) =>
            service.load("https://github.com/acme/knowledge"),
          ).pipe(
            Effect.provide(
              fake(
                {
                  [root]: { body: JSON.stringify({ default_branch: "main" }) },
                  [`${root}/commits/main`]: { body: JSON.stringify({ sha: commit }) },
                  [`${root}/git/trees/${commit}?recursive=1`]: { body: JSON.stringify(body) },
                },
                [],
              ),
            ),
          ),
        );
        expect(Result.isFailure(result)).toBe(true);
      }
      for (const response of [
        { body: "redirect", status: 302, type: "text/plain" },
        { body: "a".repeat(1_000_001), type: "text/plain" },
        { body: "<html>login</html>", type: "text/html" },
        { body: "%PDF-1.4 synthetic binary document", type: "application/octet-stream" },
        { body: "SQLite format 3\u0000synthetic", type: "text/plain" },
      ]) {
        const result = yield* Effect.result(
          Effect.flatMap(IngestionSources, (service) =>
            service.load("https://example.com/notes.txt"),
          ).pipe(Effect.provide(fake({ "https://example.com/notes.txt": response }, []))),
        );
        expect(Result.isFailure(result)).toBe(true);
      }
    });
  },
);

it("validates DNS in the socket lookup and returns only the validated numeric addresses", async () => {
  let resolutions = 0;
  const lookup = makePublicLookup((_hostname, done) => {
    resolutions++;
    done(null, [{ address: "93.184.216.34", family: 4 }]);
  });
  const result = await new Promise<unknown>((resolve, reject) =>
    lookup("example.com", { all: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses),
    ),
  );
  expect(result).toEqual([{ address: "93.184.216.34", family: 4 }]);
  expect(resolutions).toBe(1);
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "10.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "64:ff9b::7f00:1",
  ]) {
    const unsafe = makePublicLookup((_hostname, done) =>
      done(null, [{ address, family: address.includes(":") ? 6 : 4 }]),
    );
    const error = await new Promise<Error | null>((resolve) =>
      unsafe("example.com", { all: true }, (failure) => resolve(failure)),
    );
    expect(error).toBeInstanceOf(Error);
  }
});
