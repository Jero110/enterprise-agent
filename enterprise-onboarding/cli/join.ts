// A stand-in for the IDE's "Join enterprise" step, for demos and testing from a terminal.
//
//   deno task join enroll --token ea_join_... --name "Work laptop"   (transfer codes only)
//   deno task join me
//   deno task join transfer
//
// A personal token needs the person's passkey, which a terminal can't create, so the
// CLI joins with transfer codes; personal tokens go through the join page in a browser.
//
// Demo only: the private key is kept in .ea-device.json. The real IDE keeps it in the
// OS keychain, as a non-extractable key.

import { b64url, utf8 } from "../src/encoding.ts";

const [command, ...rest] = Deno.args;
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const server = flag("server") ?? "http://localhost:8787";
const statePath = flag("state") ?? ".ea-device.json";

interface DeviceState {
  server: string;
  deviceId: string;
  privateJwk: JsonWebKey;
}

async function call(path: string, body?: unknown, token?: string) {
  const res = await fetch(`${server}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}

async function signIn(state: DeviceState): Promise<string> {
  const key = await crypto.subtle.importKey("jwk", state.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
  const { challengeId, challenge } = await call("/api/device/challenge", { deviceId: state.deviceId });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      utf8(`ea-device-auth:v1:${challengeId}:${challenge}`),
    ),
  );
  const { accessToken } = await call("/api/device/token", {
    deviceId: state.deviceId,
    challengeId,
    signature: b64url(signature),
  });
  return accessToken;
}

async function loadState(): Promise<DeviceState> {
  try {
    return JSON.parse(await Deno.readTextFile(statePath));
  } catch {
    throw new Error(`No device state in ${statePath}. Run "deno task join enroll --token ..." first.`);
  }
}

async function printMe(token: string) {
  const me = await call("/api/me", undefined, token);
  console.log(`\nConnected as ${me.name} <${me.email}>`);
  console.log(`Areas:   ${me.areas.map((a: { name: string; restricted: boolean }) => a.name + (a.restricted ? " (restricted)" : "")).join(", ")}`);
  console.log(`Devices: ${me.devices.map((d: { name: string; current: boolean }) => d.name + (d.current ? " (this one)" : "")).join(", ")}`);
}

try {
  if (command === "enroll") {
    const token = flag("token");
    if (!token) throw new Error('Usage: deno task join enroll --token <transfer code> [--name "Work laptop"]');
    const start = await call("/api/enroll/start", { token });
    if (start.mode !== "none") {
      throw new Error(
        `This is a personal token, so it needs ${start.person.name}'s passkey. Open ${server}/join in Chrome or Edge to join, then make a transfer code there for this terminal.`,
      );
    }
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const result = await call("/api/enroll", {
      token,
      deviceName: flag("name") ?? `CLI on ${Deno.build.os}`,
      publicKey: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y },
    });
    const state: DeviceState = {
      server,
      deviceId: result.deviceId,
      privateJwk: await crypto.subtle.exportKey("jwk", keys.privateKey),
    };
    await Deno.writeTextFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    await printMe(await signIn(state));
  } else if (command === "me") {
    await printMe(await signIn(await loadState()));
  } else if (command === "transfer") {
    const token = await signIn(await loadState());
    const { code, expiresAt } = await call("/api/me/transfer-code", {}, token);
    console.log(`\nTransfer code (works once, until ${new Date(expiresAt).toLocaleString()}):\n\n${code}\n`);
    console.log("Paste it into the Join screen on your new device.");
  } else {
    console.error("Usage: deno task join <enroll|me|transfer> [--server URL] [--state FILE]");
    Deno.exit(1);
  }
} catch (err) {
  console.error((err as Error).message);
  Deno.exit(1);
}
