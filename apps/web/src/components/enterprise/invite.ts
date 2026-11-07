import type { PeerLinkCreateInput } from "@t3tools/contracts";
import { isLocalLoopbackHost, isTailnetHost } from "@t3tools/shared/hostClassification";

const PREFIX = "t3-enterprise-v1.";

export type EnterpriseInvite = {
  readonly link: PeerLinkCreateInput;
  readonly token: string;
};

export function createEnterpriseInvite(url: string, pairingCode: string, token: string): string {
  const value = {
    url: url.trim(),
    pairingCode: pairingCode.trim(),
    token: token.trim(),
  };
  if (Object.values(value).some((part) => !part) || !validHubUrl(value.url)) {
    throw new Error("Enter a valid hub address and credentials.");
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return PREFIX + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function validHubUrl(url: string): boolean {
  const address = URL.parse(url);
  return (
    !!address &&
    (address.protocol === "https:" ||
      (address.protocol === "http:" &&
        (isLocalLoopbackHost(address.hostname) || isTailnetHost(address.hostname)))) &&
    !address.username &&
    !address.password &&
    address.pathname === "/" &&
    !address.search &&
    !address.hash
  );
}

export function parseEnterpriseInvite(input: string): EnterpriseInvite | null {
  const value = input.trim();
  if (!value.startsWith(PREFIX)) return null;
  const encoded = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { url, pairingCode, token } = parsed as Record<string, unknown>;
    if (
      typeof url !== "string" ||
      typeof pairingCode !== "string" ||
      typeof token !== "string" ||
      !url.trim() ||
      !pairingCode.trim() ||
      !token.trim()
    )
      return null;
    if (!validHubUrl(url)) return null;
    return { link: { url, pairingCode, access: "read-only" }, token };
  } catch {
    return null;
  }
}
