import { describe, expect, it } from "vite-plus/test";

import { createEnterpriseInvite, parseEnterpriseInvite } from "./invite";

describe("Enterprise invites", () => {
  it("carries a hub address and single-use pairing credentials in one secret", () => {
    const invite = createEnterpriseInvite(
      " https://hub.example.ts.net ",
      " pair-123 ",
      " secret-456 ",
    );
    expect(invite).not.toContain("secret-456");
    expect(parseEnterpriseInvite(invite)).toEqual({
      link: { url: "https://hub.example.ts.net", pairingCode: "pair-123", access: "read-only" },
      token: "secret-456",
    });
    expect(parseEnterpriseInvite(invite + "!")).toBeNull();
    expect(parseEnterpriseInvite("secret-456")).toBeNull();
    expect(() => createEnterpriseInvite("not a URL", "code", "token")).toThrow();
    expect(() => createEnterpriseInvite("http://192.168.1.10:3000", "code", "token")).toThrow();
  });
});
