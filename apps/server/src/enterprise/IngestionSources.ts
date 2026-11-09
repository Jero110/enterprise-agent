// @effect-diagnostics nodeBuiltinImport:off -- DNS validation must run inside the Node socket lookup to prevent rebinding.
import * as NodeDns from "node:dns";
import * as NodeNet from "node:net";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import { EnterpriseError } from "@t3tools/contracts";
import { isPublicFaviconHost } from "@t3tools/shared/hostClassification";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

const MAX_FILE_BYTES = 1_000_000;
const MAX_FILES = 200;
const MAX_REPO_BYTES = 16_000_000;
const fail = (message: string) => new EnterpriseError({ code: "ingestion_failed", message });
type Address = { address: string; family: number };
type Resolve = (
  host: string,
  done: (error: NodeJS.ErrnoException | null, addresses: Address[]) => void,
) => void;
const resolve: Resolve = (host, done) => NodeDns.lookup(host, { all: true, verbatim: true }, done);

export const makePublicLookup =
  (lookup: Resolve = resolve): NodeNet.LookupFunction =>
  (host, options, done) => {
    lookup(host, (error, addresses) => {
      if (
        error ||
        addresses.length === 0 ||
        addresses.some(({ address }) => !NodeNet.isIP(address) || !isPublicFaviconHost(address))
      ) {
        done(new Error("Public source DNS resolution denied."), []);
        return;
      }
      if (options.all) done(null, addresses);
      else done(null, addresses[0]!.address, addresses[0]!.family);
    });
  };

const Repo = Schema.Struct({ default_branch: Schema.String });
const Commit = Schema.Struct({ sha: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)) });
const Tree = Schema.Struct({
  truncated: Schema.Boolean,
  tree: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      type: Schema.String,
      mode: Schema.String,
      size: Schema.optionalKey(Schema.Number),
    }),
  ),
});
const textExtensions = new Set([
  "md",
  "txt",
  "vtt",
  "srt",
  "csv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "sql",
  "py",
  "ts",
  "tsx",
  "js",
  "jsx",
  "toml",
  "ini",
  "sh",
  "xml",
]);
const safePath = (path: string) =>
  !path.includes("\\") &&
  !/[\u0000-\u001f]/.test(path) &&
  path.split("/").every((part) => part && part !== "." && part !== "..");

const manifestAreas = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += char;
    } else if (char === '"' && field === "" && !closed) quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
    } else if (char === "\r" && text[index + 1] === "\n") continue;
    else if (closed || char === '"') throw new Error("Invalid CSV quoting");
    else field += char;
  }
  if (quoted) throw new Error("Unclosed CSV field");
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  const pathColumn = header.indexOf("path"),
    areaColumn = header.indexOf("area_acceso");
  if (pathColumn < 0 || areaColumn < 0 || rows.length > MAX_FILES)
    throw new Error("Invalid manifest header or size");
  const areas = new Map<string, string>();
  for (const fields of rows) {
    if (fields.length === 1 && fields[0] === "") continue;
    const path = fields[pathColumn]?.trim(),
      area = fields[areaColumn]?.trim();
    if (fields.length !== header.length || !path || !area || !safePath(path))
      throw new Error("Invalid manifest row");
    const key = path.startsWith("raw/") ? path : `raw/${path}`;
    if (areas.has(key)) throw new Error("Duplicate manifest path");
    areas.set(key, area);
  }
  return areas;
};

export class IngestionSources extends Context.Service<
  IngestionSources,
  {
    readonly load: (
      url: string,
      destination?: string,
    ) => Effect.Effect<
      {
        files: Array<{ path: string; bytes: Uint8Array }>;
        skipped: Array<{ path: string; reason: string }>;
      },
      EnterpriseError
    >;
  }
>()("t3/enterprise/IngestionSources") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const get = Effect.fn("IngestionSources.get")(function* (
    url: string,
    kind: "json" | "text",
    limit = MAX_FILE_BYTES,
  ) {
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("user-agent", "T3-knowledge-ingestion"),
          HttpClientRequest.setHeader(
            "accept",
            kind === "json" ? "application/vnd.github+json" : "text/plain",
          ),
        ),
      )
      .pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError(() => fail("Could not fetch a public source.")),
      );
    if (response.status !== 200)
      return yield* fail(
        "Public source unavailable. Redirects and authenticated pages are not supported.",
      );
    const contentType = response.headers["content-type"]?.split(";")[0]?.trim().toLowerCase();
    if (
      !contentType ||
      !(kind === "json"
        ? ["application/json"].includes(contentType)
        : [
            "text/plain",
            "text/markdown",
            "text/x-markdown",
            "text/csv",
            "application/json",
            "application/octet-stream",
          ].includes(contentType))
    )
      return yield* fail("Source is not a supported text document.");
    if (Number(response.headers["content-length"] ?? 0) > limit)
      return yield* fail("Public source exceeds the byte limit.");
    const result = yield* response.stream.pipe(
      Stream.runFoldEffect(
        () => ({ size: 0, chunks: [] as Uint8Array[] }),
        (acc, chunk) =>
          acc.size + chunk.byteLength > limit
            ? fail("Public source exceeds the byte limit.")
            : Effect.succeed({ size: acc.size + chunk.byteLength, chunks: [...acc.chunks, chunk] }),
      ),
      Effect.timeout("10 seconds"),
      Effect.mapError(() => fail("Could not read a bounded public source.")),
    );
    const bytes = new Uint8Array(result.size);
    let offset = 0;
    for (const chunk of result.chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    yield* Effect.try({
      try: () => {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (
          text.includes("\0") ||
          text.startsWith("%PDF-") ||
          text.startsWith("SQLite format 3") ||
          (bytes[0] === 0x50 && bytes[1] === 0x4b && [3, 5, 7].includes(bytes[2] ?? -1))
        )
          throw new Error("binary");
      },
      catch: () => fail("Binary sources require an extractor and were not read as text."),
    });
    return bytes;
  });
  const json = Effect.fn("IngestionSources.json")(function* <A, I>(
    url: string,
    schema: Schema.Codec<A, I>,
  ) {
    const bytes = yield* get(url, "json", 2_000_000);
    return yield* Schema.decodeEffect(Schema.fromJsonString(schema))(
      new TextDecoder().decode(bytes),
    ).pipe(Effect.mapError(() => fail("Invalid repository metadata.")));
  });
  const load = Effect.fn("IngestionSources.load")(
    function* (raw: string, destination = "global") {
      const url = yield* Effect.try({
        try: () => new URL(raw),
        catch: () => fail("Choose a valid public HTTPS URL."),
      });
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.port ||
        url.search ||
        url.hash ||
        NodeNet.isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
        !url.hostname.includes(".") ||
        !isPublicFaviconHost(url.hostname)
      )
        return yield* fail("Choose a public HTTPS URL without credentials, query or fragment.");
      if (url.hostname !== "github.com") {
        if (/\.(pdf|xlsx?|sqlite3?|db|zip|docx?|pptx?)$/i.test(url.pathname))
          return yield* fail("Binary sources require an extractor; use a text document instead.");
        const bytes = yield* get(url.toString(), "text");
        return { files: [{ path: "source.txt", bytes }], skipped: [] };
      }
      const parts = url.pathname.replace(/\/$/, "").split("/").slice(1);
      if (
        parts.length !== 2 ||
        parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === "." || part === "..")
      )
        return yield* fail("Use a GitHub repository root URL, not a page or branch URL.");
      const owner = parts[0]!;
      const repo = parts[1]!.replace(/\.git$/, "");
      const api = `https://api.github.com/repos/${owner}/${repo}`;
      const metadata = yield* json(api, Repo);
      const commit = yield* json(
        `${api}/commits/${encodeURIComponent(metadata.default_branch)}`,
        Commit,
      );
      const tree = yield* json(`${api}/git/trees/${commit.sha}?recursive=1`, Tree);
      if (tree.truncated)
        return yield* fail("Repository tree is truncated; import a smaller raw bucket.");
      const candidates = tree.tree.filter(
        (entry) =>
          entry.type === "blob" &&
          entry.path.startsWith("raw/") &&
          !entry.path
            .split("/")
            .some((part) => ["demo", "_build", ".git", "node_modules"].includes(part)),
      );
      if (candidates.length > MAX_FILES || candidates.some((entry) => !safePath(entry.path)))
        return yield* fail(
          "Repository raw bucket exceeds the file limit or contains unsafe paths.",
        );
      const manifest = candidates.find((entry) => entry.path === "raw/_manifest.csv");
      const areas =
        manifest === undefined
          ? undefined
          : yield* Effect.try({
              try: () => {
                if (manifest.mode !== "100644") throw new Error("Invalid manifest");
              },
              catch: () => fail("Invalid raw manifest."),
            }).pipe(
              Effect.andThen(
                get(
                  `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/raw/_manifest.csv`,
                  "text",
                ),
              ),
              Effect.flatMap((bytes) =>
                Effect.try({
                  try: () => manifestAreas(new TextDecoder().decode(bytes)),
                  catch: () => fail("Invalid raw manifest; no source areas were inferred."),
                }),
              ),
            );
      const files: Array<{ path: string; bytes: Uint8Array }> = [];
      const skipped: Array<{ path: string; reason: string }> = [];
      let total = 0;
      for (const entry of candidates.toSorted((a, b) => a.path.localeCompare(b.path))) {
        if (entry.path === "raw/_manifest.csv") continue;
        if (
          !["100644", "100755"].includes(entry.mode) ||
          !textExtensions.has(entry.path.split(".").at(-1)!.toLowerCase())
        ) {
          skipped.push({
            path: entry.path,
            reason: "Unsupported format or symlink; no extraction performed.",
          });
          continue;
        }
        if (
          areas !== undefined &&
          areas.get(entry.path) !== (destination === "global" ? "general" : destination)
        ) {
          skipped.push({ path: entry.path, reason: "Source belongs to another destination." });
          continue;
        }
        if ((entry.size ?? 0) > MAX_FILE_BYTES)
          return yield* fail("Repository source exceeds the per-file byte limit.");
        total += entry.size ?? 0;
        if (total > MAX_REPO_BYTES)
          return yield* fail("Repository raw bucket exceeds the total byte limit.");
        const bytes = yield* get(
          `https://raw.githubusercontent.com/${owner}/${repo}/${commit.sha}/${entry.path.split("/").map(encodeURIComponent).join("/")}`,
          "text",
        );
        total += bytes.byteLength - (entry.size ?? 0);
        if (total > MAX_REPO_BYTES)
          return yield* fail("Repository raw bucket exceeds the total byte limit.");
        files.push({ path: `github/${owner}/${repo}/${commit.sha}/${entry.path}`, bytes });
      }
      if (files.length === 0)
        return yield* fail(
          "Repository raw bucket has no supported text sources. Binary PDF, spreadsheet and database extraction is not available.",
        );
      return { files, skipped };
    },
    Effect.timeoutOrElse({
      duration: "1 minute",
      orElse: () => fail("Public source import exceeded its time limit."),
    }),
  );
  return IngestionSources.of({ load });
});

export const layer = Layer.effect(IngestionSources, make);
export const layerPinned = layer.pipe(
  Layer.provide(
    NodeHttpClient.layerNodeHttpOptions({ lookup: makePublicLookup(), keepAlive: false }),
  ),
);
