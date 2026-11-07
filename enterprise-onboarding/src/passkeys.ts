import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";
import { utf8 } from "./encoding.ts";

export type RegistrationResponse = Parameters<typeof verifyRegistrationResponse>[0]["response"];
export type AuthenticationResponse = Parameters<typeof verifyAuthenticationResponse>[0]["response"];

export interface StoredPasskey {
  id: string;
  publicKey: Uint8Array<ArrayBuffer>;
  counter: number;
  transports: string[];
}

// Passkeys must be discoverable (no username to type) and must check the person
// (fingerprint, face or device PIN), so a stolen unlocked laptop isn't enough on its own.
// Used for both admins and people; the account id keeps their passkeys apart.
export function registrationOptions(config: Config, account: { id: string; email: string }) {
  return generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: account.email,
    userID: utf8(account.id),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
}

export async function verifyRegistration(
  config: Config,
  response: RegistrationResponse,
  expectedChallenge: string,
): Promise<StoredPasskey> {
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
    });
    if (!result.verified || !result.registrationInfo) throw new Error("not verified");
    const { credential } = result.registrationInfo;
    return {
      id: credential.id,
      publicKey: new Uint8Array(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
    };
  } catch {
    throw new AppError(400, "passkey_invalid", "The passkey couldn't be verified. Try again.");
  }
}

/** With allow set, only those passkeys are accepted; without it, any passkey for this site (admin sign-in). */
export function authenticationOptions(config: Config, allow?: { id: string; transports: string[] }[]) {
  return generateAuthenticationOptions({
    rpID: config.rpId,
    userVerification: "required",
    // deno-lint-ignore no-explicit-any
    allowCredentials: allow?.map((c) => ({ id: c.id, transports: c.transports as any })),
  });
}

/** Returns the authenticator's new signature counter. */
export async function verifyAuthentication(
  config: Config,
  response: AuthenticationResponse,
  expectedChallenge: string,
  passkey: StoredPasskey,
): Promise<number> {
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpId,
      requireUserVerification: true,
      credential: {
        id: passkey.id,
        publicKey: passkey.publicKey,
        counter: passkey.counter,
        // deno-lint-ignore no-explicit-any
        transports: passkey.transports as any,
      },
    });
    if (!result.verified) throw new Error("not verified");
    return result.authenticationInfo.newCounter;
  } catch {
    throw new AppError(401, "passkey_invalid", "That passkey couldn't be verified. Try again.");
  }
}
