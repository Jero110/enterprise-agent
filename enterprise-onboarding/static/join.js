// The "Join enterprise" screen, as the IDE would show it. The device's private key is
// generated here as non-extractable: even this page's own code can't read it back out.
import { action, api, copy, el, mount, notice, when } from "./common.js";
import { createPasskey, passkeyError, passkeysSupported, usePasskey } from "./webauthn.js";

const app = document.getElementById("app");

// --- Device key storage (IndexedDB keeps CryptoKey objects without exposing them) ---
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("enterprise-agent", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("device");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function store(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("device", mode);
    const req = fn(tx.objectStore("device"));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const loadDevice = () => store("readonly", (s) => s.get("current"));
const saveDevice = (device) => store("readwrite", (s) => s.put(device, "current"));
const forgetDevice = () => store("readwrite", (s) => s.delete("current"));

// --- Device sign-in: sign the server's challenge with the device key ---
const toB64url = (buffer) => {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let accessToken = null;

async function signIn(device) {
  const { challengeId, challenge } = await api("/api/device/challenge", { deviceId: device.deviceId });
  const message = new TextEncoder().encode(`ea-device-auth:v1:${challengeId}:${challenge}`);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, device.privateKey, message);
  const result = await api("/api/device/token", { deviceId: device.deviceId, challengeId, signature: toB64url(signature) });
  accessToken = result.accessToken;
}

async function authed(path, body) {
  return api(path, body, { authorization: `Bearer ${accessToken}` });
}

// --- Screens ---
async function start() {
  const device = await loadDevice().catch(() => undefined);
  if (!device) return renderJoin();
  try {
    await signIn(device);
    await renderHome(device);
  } catch (err) {
    if (["device_revoked", "device_unknown", "user_deactivated"].includes(err.code)) {
      await forgetDevice();
      return renderJoin(notice("bad", err.message));
    }
    mount(app,el("h1", { text: "Enterprise Agent" }), notice("bad", err.message));
  }
}

function renderJoin(banner) {
  const errors = el("div");
  const token = el("textarea", { id: "token", rows: 3, placeholder: "ea_join_…", autocomplete: "off", spellcheck: false });
  const name = el("input", { id: "device-name", type: "text", value: defaultDeviceName(), maxlength: 60 });
  const status = el("p", { class: "small muted", role: "status" });
  const button = el("button", { class: "primary", text: "Join" });
  button.addEventListener("click", action(button, async () => {
    const value = token.value.trim();
    // Step 1: check the token. A personal token needs the person's passkey: created on
    // first use and tied to the token, then required for every later use.
    const start = await api("/api/enroll/start", { token: value });
    let passkey;
    if (start.mode !== "none") {
      if (!passkeysSupported()) throw new Error("This browser can't use passkeys. Open this page in Chrome or Edge.");
      status.textContent = start.mode === "register"
        ? `Hi ${start.person.name}. Create your passkey with your fingerprint, face or PIN. It's tied to your token.`
        : `Hi ${start.person.name}. Confirm with the passkey you created when you first used this token.`;
      try {
        passkey = start.mode === "register" ? await createPasskey(start.options) : await usePasskey(start.options);
      } catch (err) {
        status.textContent = "";
        throw new Error(passkeyError(err));
      }
    }
    // Step 2: this computer makes its own key and joins.
    const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const publicKey = await crypto.subtle.exportKey("jwk", keys.publicKey);
    const result = await api("/api/enroll", {
      token: value,
      deviceName: name.value.trim(),
      publicKey: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y },
      enrollId: start.enrollId,
      passkey,
    });
    const device = { deviceId: result.deviceId, privateKey: keys.privateKey, email: result.user.email };
    await saveDevice(device);
    await signIn(device);
    await renderHome(device, notice("good", `Welcome, ${result.user.name}. This device is now connected.`));
  }, errors));

  mount(app,
    el("h1", { text: "Join your company" }),
    el("p", { class: "muted" },
      "Paste the personal token an admin sent you. The first time, you'll create a passkey with your fingerprint, face or PIN. It's tied to your token, so nobody else can use the token.",
    ),
    banner ?? null,
    el("div", { class: "card stack" },
      el("div", {}, el("label", { for: "token", text: "Personal token or transfer code" }), token),
      el("div", {}, el("label", { for: "device-name", text: "Name this device" }), name),
      button,
      status,
      errors,
    ),
    el("p", { class: "small muted" },
      "Second computer? Use the same token and the same passkey (from your phone or password manager), or make a transfer code on a computer you've already joined and paste it here.",
    ),
  );
}

async function renderHome(device, banner) {
  const me = await authed("/api/me");
  const errors = el("div");

  const transferSlot = el("div");
  const transfer = el("button", { text: "Create transfer code" });
  transfer.addEventListener("click", action(transfer, async () => {
    const { code, expiresAt } = await authed("/api/me/transfer-code", {});
    const copyButton = el("button", { class: "small", text: "Copy" });
    copyButton.addEventListener("click", () => copy(code, copyButton));
    transferSlot.replaceChildren(
      el("div", { class: "secret", text: code }),
      el("div", { class: "row" }, copyButton,
        el("span", { class: "small muted", text: `Works once, until ${when(expiresAt)}.` })),
    );
  }, errors));

  const devices = me.devices.map((d) => {
    const remove = el("button", { class: "small danger", text: d.current ? "Leave on this device" : "Remove" });
    remove.addEventListener("click", action(remove, async () => {
      if (!confirm(d.current ? "Disconnect this device? You'll need a new token or transfer code to join again." : `Remove "${d.name}"?`)) return;
      await authed(`/api/me/devices/${d.id}/remove`, {});
      if (d.current) {
        await forgetDevice();
        accessToken = null;
        return renderJoin(notice("good", "This device was disconnected."));
      }
      await renderHome(device);
    }, errors));
    return el("li", { class: "row spread" },
      el("div", {}, d.name + (d.current ? " (this device)" : ""),
        el("div", { class: "small muted", text: `Joined ${when(d.createdAt)}` })),
      remove,
    );
  });

  mount(app,
    el("h1", { text: "You're connected" }),
    el("p", { class: "muted", text: `${me.name} · ${me.email}` }),
    banner ?? null,
    el("div", { class: "card" },
      el("h2", { text: "Your areas" }),
      el("div", {}, me.areas.map((a) => el("span", { class: `chip${a.restricted ? " lock" : ""}`, text: a.name }))),
      el("p", { class: "small muted" }, "Restricted areas ask that area's admin the first time a session needs them."),
      el("p", { class: "small muted", text: me.passkeys ? `Passkey set up (${me.passkeys}).` : "No passkey on your account." }),
    ),
    el("div", { class: "card stack" },
      el("h2", { text: `Your devices (${me.devices.length} of ${me.maxDevices})` }),
      el("ul", { class: "plain" }, devices),
      el("div", {}, transfer, el("p", { class: "small muted" }, "Moving to a new computer? Make a one-use code here and paste it there.")),
      transferSlot,
      errors,
    ),
    el("div", { class: "card" },
      el("h2", { text: "Recent activity" }),
      me.notifications.length
        ? el("ul", { class: "plain" }, me.notifications.map((n) =>
          el("li", {}, n.message, el("div", { class: "small muted", text: when(n.createdAt) }))
        ))
        : el("p", { class: "muted", text: "Nothing yet." }),
    ),
  );
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "this computer";
  return `Browser on ${os}`;
}

start();
