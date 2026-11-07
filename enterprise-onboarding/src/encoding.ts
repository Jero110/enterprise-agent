const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export function utf8(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value);
}

/** A random URL-safe secret. 32 bytes = 256 bits, far beyond guessing range. */
export function randomSecret(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(value)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A secret plus the hash we store. The plain secret is returned to the caller once and never saved. */
export async function secretPair(prefix: string): Promise<{ secret: string; hash: string }> {
  const secret = prefix + randomSecret(32);
  return { secret, hash: await sha256Hex(secret) };
}

export const newId = (): string => crypto.randomUUID();
