import { api, el, mount, notice, when } from "./common.js";
import { createPasskey, passkeyError, passkeysSupported } from "./webauthn.js";

const app = document.getElementById("app");

// Read the secret from the "#" part, then wipe it from the address bar and history.
const ref = new URLSearchParams(location.hash.slice(1)).get("invite");
history.replaceState(null, "", location.pathname);

function show(...children) {
  mount(app, el("h1", { text: "Become an admin" }), ...children);
}

async function start() {
  if (!ref) {
    show(notice("bad", "This page needs the full link you were sent. Open the link again from your message."));
    return;
  }
  if (!passkeysSupported()) {
    show(notice("bad", "This browser can't create passkeys. Open the link in an up-to-date Chrome, Edge, Safari or Firefox."));
    return;
  }
  let invite;
  try {
    invite = await api("/api/admin-invites/preview", { invite: ref });
  } catch (err) {
    show(notice("bad", err.message));
    return;
  }

  const errors = el("div");
  const confirm = el("button", { class: "primary", text: "Confirm and create passkey" });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    errors.replaceChildren();
    try {
      const options = await api("/api/admin-invites/registration-options", { invite: ref });
      const response = await createPasskey(options);
      await api("/api/admin-invites/redeem", { invite: ref, response });
      show(
        notice("good", `You're an admin now, signed in as ${invite.email}. Your passkey is how you sign in from now on.`),
        el("p", {}, el("a", { href: "/admin" }, "Open the admin console")),
      );
    } catch (err) {
      confirm.disabled = false;
      const message = err.code ? err.message : passkeyError(err);
      errors.replaceChildren(notice("bad", message));
    }
  });

  show(
    el("p", { class: "muted" }, "You were invited to administer Enterprise Agent."),
    el(
      "div",
      { class: "card stack" },
      el("div", {}, el("label", { text: "Invitation for" }), el("div", { text: invite.email })),
      el("div", {}, el("label", { text: "Link expires" }), el("div", { text: when(invite.expiresAt) })),
      invite.breakGlass ? notice("warn", "This is an emergency link created on the server itself.") : null,
      el(
        "p",
        { class: "small muted" },
        "Confirming uses up this link and creates a passkey on this device: your fingerprint, face or device PIN. ",
        "The other admins will be told you joined. If this invitation isn't for you, close this page: nothing has changed.",
      ),
      confirm,
      errors,
    ),
  );
}

start();
