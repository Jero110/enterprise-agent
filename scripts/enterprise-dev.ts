// Starts one enterprise hub plus one dev instance per member, each through scripts/dev-runner.ts.
import * as NodeChildProcess from "node:child_process";
import * as NodeReadline from "node:readline";
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
  },
});
const members = [...new Set(values.members.split(",").map((m) => m.trim().toLowerCase()))].filter(
  Boolean,
);
const unknown = members.filter((m) => !(m in EMAILS));
if (unknown.length > 0 || members.length === 0) {
  console.error(`Unknown members: ${unknown.join(", ")}. Known: ${Object.keys(EMAILS).join(", ")}`);
  process.exit(1);
}

type Instance = {
  name: string;
  email: string;
  child: NodeChildProcess.ChildProcess;
  url?: string;
  home?: string;
};
const instances: Instance[] = [];
let stopping = false;

const LINE = /\[dev-runner\] mode=\S+ .*serverPort=(\d+) webPort=(\d+) baseDir=(\S+)/;

const start = (name: string, email: string, mode: string, env: Record<string, string>) => {
  // Detached gives the runner its own process group, so one signal reaches its whole tree.
  const child = NodeChildProcess.spawn(
    process.execPath,
    [runner, mode, "--no-browser", "--no-seed"],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, T3CODE_DEV_INSTANCE: name, T3CODE_DEV_SEED: "0" },
    },
  );
  const instance: Instance = { name, email, child };
  instances.push(instance);
  const onLine = (line: string) => {
    const match = LINE.exec(line);
    if (match && !instance.url) {
      const port = mode === "dev:server" ? match[1] : match[2];
      instance.url = `http://localhost:${port}`;
      instance.home = match[3];
      console.log(`[${name}] pid=${child.pid} ${instance.url} home=${instance.home}`);
    }
    if (/error|failed/i.test(line)) console.error(`[${name}] ${line}`);
  };
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) NodeReadline.createInterface({ input: stream }).on("line", onLine);
  }
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`[${name}] exited with ${code}; stopping the fleet`);
      void shutdown(1);
    }
  });
  return instance;
};

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const shutdown = async (code: number) => {
  if (stopping) return;
  stopping = true;
  const pids = instances.flatMap((i) => (i.child.pid ? [i.child.pid] : []));
  console.log(`\nStopping spawned PIDs: ${pids.join(" ")}`);
  const signal = (sig: NodeJS.Signals) => {
    for (const pid of pids) {
      try {
        process.kill(-pid, sig); // group created by our own spawn
      } catch {}
    }
  };
  signal("SIGINT");
  for (let i = 0; i < 100 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 100));
  if (pids.some(alive)) signal("SIGKILL");
  console.log(`Still alive after stop: ${pids.filter(alive).join(" ") || "none"}`);
  process.exit(code);
};
process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

start("hub", "-", "dev:server", {
  T3CODE_ENTERPRISE_HUB: "1",
  T3CODE_ENTERPRISE_SEED: seedPath,
});
for (const name of members) start(name, EMAILS[name]!, values.desktop ? "dev:desktop" : "dev", {});

const timer = setInterval(() => {
  if (stopping || !instances.every((i) => i.url)) return;
  clearInterval(timer);
  const rows = instances.map((i) => [i.name, i.email, i.url!]);
  const widths = [0, 1, 2].map((c) => Math.max(...rows.map((r) => r[c]!.length)));
  console.log("\nname  → email → URL");
  for (const r of rows) console.log(r.map((cell, c) => cell.padEnd(widths[c]!)).join("  "));
  console.log("\nCtrl-C stops exactly these PIDs:", instances.map((i) => i.child.pid).join(" "));
}, 250);
