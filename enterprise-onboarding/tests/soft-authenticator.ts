// A software passkey for tests: produces the same bytes a real authenticator would
// (CBOR attestation, authenticator data, DER signatures), so the real verifier runs.

import { b64url, fromB64url, utf8 } from "../src/encoding.ts";

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === "number") return new Uint8Array(value >= 0 ? head(0, value) : head(1, -1 - value));
  if (typeof value === "string") {
    const bytes = utf8(value);
    return concat(new Uint8Array(head(3, bytes.length)), bytes);
  }
  if (value instanceof Uint8Array) return concat(new Uint8Array(head(2, value.length)), value);
  const parts: Uint8Array[] = [new Uint8Array(head(5, value.size))];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return concat(...parts);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const sha256 = async (data: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);

// WebAuthn ES256 signatures are ASN.1 DER; WebCrypto produces raw r||s.
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (bytes: Uint8Array) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    let v = bytes.slice(i);
    if (v[0] & 0x80) v = concat(new Uint8Array([0]), v);
    return concat(new Uint8Array([0x02, v.length]), v);
  };
  const body = concat(int(raw.slice(0, 32)), int(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
}

interface Credential {
  id: Uint8Array<ArrayBuffer>;
  keys: CryptoKeyPair;
  counter: number;
  userHandle: string;
}

export class SoftAuthenticator {
  readonly credentials: Credential[] = [];

  constructor(private readonly origin: string, private readonly rpId: string) {}

  // deno-lint-ignore no-explicit-any
  async create(options: any) {
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const id = crypto.getRandomValues(new Uint8Array(16));
    const coseKey = new Map<Cbor, Cbor>([[1, 2], [3, -7], [-1, 1], [-2, fromB64url(jwk.x!)], [-3, fromB64url(jwk.y!)]]);
    const authData = concat(
      await sha256(utf8(this.rpId)),
      new Uint8Array([0x45]), // user present + user verified + attested credential data
      u32(0),
      new Uint8Array(16), // AAGUID
      new Uint8Array([0, id.length]),
      id,
      cbor(coseKey),
    );
    const attestationObject = cbor(new Map<Cbor, Cbor>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    const clientData = JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin: this.origin });
    this.credentials.push({ id, keys, counter: 0, userHandle: options.user.id });
    return {
      id: b64url(id),
      rawId: b64url(id),
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(utf8(clientData)),
        attestationObject: b64url(attestationObject),
        transports: ["internal" as const],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }

  // deno-lint-ignore no-explicit-any
  async get(options: any, which = 0) {
    const cred = this.credentials[which];
    cred.counter++;
    const authData = concat(await sha256(utf8(this.rpId)), new Uint8Array([0x05]), u32(cred.counter));
    const clientData = utf8(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin: this.origin }));
    const raw = new Uint8Array(
      await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" },
        cred.keys.privateKey,
        concat(authData, await sha256(clientData)),
      ),
    );
    return {
      id: b64url(cred.id),
      rawId: b64url(cred.id),
      type: "public-key" as const,
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(authData),
        signature: b64url(rawToDer(raw)),
        userHandle: cred.userHandle,
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform" as const,
    };
  }
}
