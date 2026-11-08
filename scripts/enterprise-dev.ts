// Starts one enterprise hub plus one dev instance per member, each through scripts/dev-runner.ts.
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, type ChildProcessSpawner } from "effect/process";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

const root = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const runner = NodeURL.fileURLToPath(new URL("./dev-runner.ts", import.meta.url));
const seedPath = NodeURL.fileURLToPath(
  new URL("../apps/server/src/enterprise/fixtures/acme-bank.seed.json", import.meta.url),
);

const EMAILS: Record<string, string> = {
  jero: "jeronimo.deli@gmail.com",
  ana: "ent.test.ana@gmail.com",
  bruno: "ent.test.bruno@gmail.com",
  carla: "ent.test.carla@gmail.com",
  diego: "ent.test.diego@gmail.com",
  elena: "ent.test.elena@gmail.com",
  fede: "ent.test.fede@gmail.com",
  gerry: "ent.test.gerry@gmail.com",
  hugo: "ent.test.hugo@gmail.com",
  ines: "ent.test.ines@gmail.com",
  juan: "ent.test.juan@gmail.com",
  karla: "ent.test.karla@gmail.com",
  luis: "ent.test.luis@gmail.com",
  mara: "ent.test.mara@gmail.com",
  nico: "ent.test.nico@gmail.com",
  olga: "ent.test.olga@gmail.com",
  pablo: "ent.test.pablo@gmail.com",
  quique: "ent.test.quique@gmail.com",
  rosa: "ent.test.rosa@gmail.com",
  sofi: "ent.test.sofi@gmail.com",
};

const { values } = NodeUtil.parseArgs({
  options: {
    members: { type: "string", default: "jero,ana,gerry,rosa" },
    desktop: { type: "boolean", default: false },
    prefix: { type: "string", default: "" },
  },
});
const members = [...new Set(values.members.split(",").map((m) => m.trim().toLowerCase()))].filter(
  Boolean,
);
const unknown = members.filter((m) => !(m in EMAILS));

type Instance = {
  name: string;
  email: string;
  child: ChildProcessSpawner.ChildProcessHandle;
  url?: string;
  ready: Deferred.Deferred<void>;
  serverPort?: string;
};
const instances: Instance[] = [];
let stopping = false;

const LINE = /\[dev-runner\] mode=\S+ .*serverPort=(\d+) webPort=(\d+) baseDir=(\S+)/;

const start = Effect.fn("enterprise-dev.start")(function* (
  name: string,
  email: string,
  mode: string,
  env: Record<string, string>,
  stopped: Deferred.Deferred<number>,
) {
  // Detached gives the runner its own process group, so one signal reaches its whole tree.
  const child = yield* ChildProcess.make(
    process.execPath,
    [runner, mode, "--no-browser", "--no-seed"],
    {
      cwd: root,
      detached: true,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ...env,
        T3CODE_DEV_INSTANCE: `${values.prefix}${name}`,
        T3CODE_DEV_SEED: "0",
      },
      extendEnv: false,
      forceKillAfter: "10 seconds",
    },
  );
  const ready = yield* Deferred.make<void>();
  const instance: Instance = { name, email, child, ready };
  instances.push(instance);
  const onLine = Effect.fn("enterprise-dev.onLine")(function* (line: string) {
    const match = LINE.exec(line);
    if (match && !instance.url) {
      const port = mode === "dev:server" ? match[1] : match[2];
      instance.url = `http://localhost:${port}`;
      instance.serverPort = match[1]!;
      yield* Console.log(`[${name}] pid=${child.pid} ${instance.url} home=${match[3]}`);
    }
    if (/Local:.*http/.test(line)) yield* Deferred.succeed(ready, undefined);
    if (/error|failed/i.test(line)) yield* Console.error(`[${name}] ${line}`);
  });
  for (const stream of [child.stdout, child.stderr]) {
    yield* stream.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach(onLine),
      Effect.forkScoped,
    );
  }
  yield* child.exitCode.pipe(
    Effect.flatMap((code) =>
      stopping
        ? Effect.void
        : Console.error(`[${name}] exited with ${code}; stopping the fleet`).pipe(
            Effect.andThen(Deferred.succeed(stopped, 1)),
          ),
    ),
    Effect.forkScoped,
  );
  return instance;
});

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const shutdown = Effect.fn("enterprise-dev.shutdown")(function* () {
  if (stopping) return;
  stopping = true;
  const pids = instances.flatMap((i) => (i.child.pid ? [i.child.pid] : []));
  yield* Console.log(`\nStopping spawned PIDs: ${pids.join(" ")}`);
  const signal = (sig: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(-pid, sig); // group created by our own spawn
      } catch {}
    }
  };
  signal("SIGINT");
  for (let i = 0; i < 100 && pids.some(alive); i++) yield* Effect.sleep("100 millis");
  if (pids.some(alive)) signal("SIGKILL");
  yield* Console.log(`Still alive after stop: ${pids.filter(alive).join(" ") || "none"}`);
});

const printTable = Effect.fn("enterprise-dev.printTable")(function* () {
  do {
    yield* Effect.sleep("250 millis");
  } while (!instances.every((i) => i.url));
  if (stopping) return;
  const rows = instances.map((i) => [i.name, i.email, i.url!]);
  const widths = [0, 1, 2].map((c) => Math.max(...rows.map((r) => r[c]!.length)));
  yield* Console.log("\nname  → email → URL");
  for (const r of rows) yield* Console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join("  "));
  yield* Console.log(
    "\nCtrl-C stops exactly these PIDs:",
    instances.map((i) => i.child.pid).join(" "),
  );
});

// The hub has no web UI to flip Labs → Linked environments, and members cannot link without it.
const SettingsJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
const decodeSettings = Schema.decodeEffect(SettingsJson);
const encodeSettings = Schema.encodeUnknownEffect(SettingsJson);
const enableHubLinks = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = `${root}.t3/instances/${values.prefix}hub/userdata/settings.json`;
  const current = (yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => "{}"))) || "{}";
  const settings = yield* decodeSettings(current).pipe(
    Effect.orElseSucceed((): Record<string, unknown> => ({})),
  );
  yield* fs.makeDirectory(`${root}.t3/instances/${values.prefix}hub/userdata`, { recursive: true });
  yield* fs.writeFileString(
    file,
    yield* encodeSettings({
      ...settings,
      linkedEnvironmentsEnabled: true,
    }),
  );
});

const main = Effect.gen(function* () {
  if (unknown.length > 0 || members.length === 0) {
    yield* Console.error(
      `Unknown members: ${unknown.join(", ")}. Known: ${Object.keys(EMAILS).join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }
  yield* Effect.gen(function* () {
    const stopped = yield* Deferred.make<number>();
    yield* enableHubLinks;
    if (values.desktop) {
      const build = yield* ChildProcess.make(
        `${root}node_modules/.bin/vp`,
        ["run", "--filter", "@t3tools/desktop", "build"],
        { cwd: root, stdout: "ignore", stderr: "inherit" },
      );
      const code = yield* build.exitCode;
      if (code !== 0) return yield* Effect.die(`Desktop build failed (${code}).`);
    }
    yield* start(
      "hub",
      "-",
      "dev:server",
      {
        T3CODE_ENTERPRISE_HUB: "1",
        T3CODE_ENTERPRISE_SEED: seedPath,
      },
      stopped,
    );
    for (const name of members) {
      const instance = yield* start(
        name,
        EMAILS[name]!,
        values.desktop ? "dev:web" : "dev",
        {},
        stopped,
      );
      if (values.desktop) {
        yield* Deferred.await(instance.ready);
        const child = yield* ChildProcess.make(
          process.execPath,
          [`${root}apps/desktop/scripts/start-electron.mjs`],
          {
            cwd: root,
            detached: true,
            stdin: "ignore",
            stdout: "ignore",
            stderr: "inherit",
            env: {
              ...process.env,
              VITE_DEV_SERVER_URL: instance.url!,
              T3CODE_DEV_INSTANCE: `${values.prefix}${name}`,
              T3CODE_HOME: `${root}.t3/instances/${values.prefix}${name}`,
              T3CODE_PORT: instance.serverPort!,
              T3CODE_DEV_SEED: "0",
              T3CODE_TELEMETRY_ENABLED: "false",
            },
            extendEnv: false,
          },
        );
        instances.push({
          name: `${name}-desktop`,
          email: EMAILS[name]!,
          child,
          url: instance.url!,
          ready: instance.ready,
        });
      }
    }
    yield* printTable().pipe(Effect.forkScoped);
    process.exitCode = yield* Deferred.await(stopped);
  }).pipe(Effect.ensuring(shutdown()));
});

main.pipe(
  Effect.scoped,
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain({
    teardown: (exit, onExit) => {
      // A requested fleet stop is a successful exit, including SIGINT and SIGTERM.
      Runtime.defaultTeardown(exit, (code) =>
        onExit(code === 130 ? 0 : code || Number(process.exitCode ?? 0)),
      );
    },
  }),
);
