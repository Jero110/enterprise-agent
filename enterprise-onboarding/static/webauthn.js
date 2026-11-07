// Converts between the server's JSON passkey options and the browser's WebAuthn API.

const toB64url = (buffer) => {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (value) => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
};

export function passkeysSupported() {
  return typeof window.PublicKeyCredential === "function" && window.isSecureContext;
}

export async function createPasskey(options) {
  const publicKey = {
    ...options,
    challenge: fromB64url(options.challenge),
    user: { ...options.user, id: fromB64url(options.user.id) },
    excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: fromB64url(c.id) })),
  };
  const credential = await navigator.credentials.create({ publicKey });
  const response = credential.response;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      attestationObject: toB64url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

export async function usePasskey(options) {
  const publicKey = {
    ...options,
    challenge: fromB64url(options.challenge),
    allowCredentials: (options.allowCredentials ?? []).map((c) => ({ ...c, id: fromB64url(c.id) })),
  };
  const credential = await navigator.credentials.get({ publicKey });
  const response = credential.response;
  return {
    id: credential.id,
    rawId: toB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: toB64url(response.clientDataJSON),
      authenticatorData: toB64url(response.authenticatorData),
      signature: toB64url(response.signature),
      userHandle: response.userHandle ? toB64url(response.userHandle) : undefined,
    },
    clientExtensionResults: credential.getClientExtensionResults(),
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  };
}

/**
 * Turns WebAuthn's terse browser errors into something a person can act on, keeping the
 * browser's own words at the end: NotAllowedError covers everything from a cancel to an
 * unsupported browser, and only the raw message tells them apart.
 */
export function passkeyError(err) {
  const raw = err?.name ? ` (Browser said: ${err.name}${err.message ? `: ${err.message}` : ""})` : "";
  if (err?.name === "NotAllowedError") {
    return `The passkey prompt was cancelled, timed out, or isn't supported in this browser. Try again, or open the link in Chrome or Edge.${raw}`;
  }
  if (err?.name === "InvalidStateError") return `This device already has a passkey for this account.${raw}`;
  if (err?.name === "SecurityError") return `Passkeys only work on the service's own address (https or localhost).${raw}`;
  return (err?.message ?? "Something went wrong with the passkey.") + raw;
}
