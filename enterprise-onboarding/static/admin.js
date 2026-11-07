import { action, api, copy, el, mount, notice, when } from "./common.js";
import { passkeyError, passkeysSupported, usePasskey } from "./webauthn.js";

const app = document.getElementById("app");
// A token or link is shown once, right after it's created, until the admin dismisses it.
let shownOnce = null;

async function load() {
  try {
    render(await api("/api/admin/overview"));
  } catch (err) {
    if (err.status === 401) renderSignIn();
    else mount(app, notice("bad", err.message));
  }
}

async function post(path, body = {}) {
  const result = await api(path, body);
  await load();
  return result;
}

function renderSignIn() {
  const errors = el("div");
  const button = el("button", { class: "primary", text: "Sign in with passkey" });
  button.addEventListener(
    "click",
    action(button, async () => {
      try {
        const { loginId, options } = await api("/api/admin/login/options", {});
        const response = await usePasskey(options);
        await api("/api/admin/login/verify", { loginId, response });
      } catch (err) {
        throw new Error(err.code ? err.message : passkeyError(err));
      }
      await load();
    }, errors),
  );
  mount(app,
    el("div", { class: "narrow" },
      el("h1", { text: "Enterprise Agent admin" }),
      el("div", { class: "card stack" },
        el("p", {}, "Sign in with the passkey you created from your admin link."),
        passkeysSupported() ? button : notice("bad", "This browser can't use passkeys."),
        errors,
        el("p", { class: "small muted" }, "New admin? Open the one-time link you were sent instead."),
      ),
    ),
  );
}

function render(data) {
  const activeAdmins = data.admins.filter((a) => a.status === "active");
  mount(app,
    el("div", { class: "row spread" },
      el("div", {}, el("h1", { text: "Admin console" }), el("p", { class: "muted", text: `Signed in as ${data.me.email}` })),
      signOutButton(),
    ),
    shownOnce ? secretCard() : null,
    data.notifications.length ? notificationsCard(data, activeAdmins) : null,
    issueTokenCard(data),
    peopleCard(data),
    adminsCard(data, activeAdmins),
    auditCard(data),
  );
}

function signOutButton() {
  const button = el("button", { text: "Sign out" });
  button.addEventListener("click", action(button, async () => {
    await api("/api/admin/logout", {});
    shownOnce = null;
    renderSignIn();
  }));
  return button;
}

function secretCard() {
  const copyButton = el("button", { class: "small", text: "Copy" });
  copyButton.addEventListener("click", () => copy(shownOnce.value, copyButton));
  const dismiss = el("button", { class: "small", text: "Done, hide it" });
  dismiss.addEventListener("click", () => {
    shownOnce = null;
    load();
  });
  return el("div", { class: "card stack" },
    el("h2", { text: shownOnce.title }),
    el("div", { class: "secret", text: shownOnce.value }),
    el("div", { class: "row" }, copyButton, dismiss),
    el("p", { class: "small muted", text: shownOnce.help }),
  );
}

function notificationsCard(data, activeAdmins) {
  const items = data.notifications.slice(0, 8).map((n) => {
    const target = n.ref?.kind === "admin" ? activeAdmins.find((a) => a.id === n.ref.id) : null;
    const revoke = target && target.id !== data.me.id && activeAdmins.length > 1
      ? revokeAdminButton(target, "Not expected? Revoke")
      : null;
    return el("li", { class: "row spread" },
      el("div", {}, n.message, el("div", { class: "small muted", text: when(n.createdAt) })),
      revoke,
    );
  });
  return el("div", { class: "card" }, el("h2", { text: "Notifications" }), el("ul", { class: "plain" }, items));
}

function issueTokenCard(data) {
  const errors = el("div");
  const people = el("select", { id: "person" },
    data.people.map((p) =>
      el("option", { value: p.email, text: `${p.name} · ${p.email}${p.status === "not_invited" ? "" : ` (${p.status})`}` })
    ),
  );
  const boxes = data.areas.map((a) =>
    el("label", { class: "check" },
      el("input", { type: "checkbox", value: a.id, checked: a.id === "general", disabled: a.id === "general" }),
      a.restricted ? `${a.name} (restricted)` : a.name,
    )
  );
  const button = el("button", { class: "primary", text: "Create personal token" });
  button.addEventListener("click", action(button, async () => {
    const areas = boxes.map((b) => b.querySelector("input")).filter((i) => i.checked).map((i) => i.value);
    const result = await api("/api/admin/user-tokens", { email: people.value, areas });
    shownOnce = {
      title: `Personal token for ${result.email}`,
      value: result.token,
      help: `Shown only once. Send it to them privately. It works on up to ${result.maxDevices} devices until ${
        when(result.expiresAt)
      }. Its first use creates their passkey, and every later use needs that same passkey, so the token alone is useless to anyone else. Issuing another token for them cancels this one.`,
    };
    await load();
  }, errors));
  return el("div", { class: "card stack" },
    el("h2", { text: "Give someone access" }),
    el("div", {}, el("label", { for: "person", text: "Person" }), people),
    el("div", {}, el("label", { text: "Areas" }), el("div", {}, boxes)),
    el("p", { class: "small muted" }, "Everyone gets Enterprise general. Restricted areas still ask that area's admin at session start."),
    button,
    errors,
  );
}

function peopleCard(data) {
  if (!data.users.length) {
    return el("div", { class: "card" }, el("h2", { text: "People" }), el("p", { class: "muted", text: "No one has a token yet." }));
  }
  const areaName = (id) => data.areas.find((a) => a.id === id);
  const rows = data.users.map((u) =>
    el("tr", {},
      el("td", {}, el("div", { text: u.name }), el("div", { class: "small muted", text: u.email })),
      el("td", {},
        el("span", { class: `status ${u.status}`, text: u.status }),
        el("div", { class: "small muted", text: u.passkeys ? `${u.passkeys} passkey${u.passkeys > 1 ? "s" : ""}` : "no passkey yet" }),
      ),
      el("td", {}, u.areas.map((id) => el("span", { class: `chip${areaName(id)?.restricted ? " lock" : ""}`, text: areaName(id)?.name ?? id }))),
      el("td", {},
        u.devices.length
          ? u.devices.map((d) =>
            el("div", { class: "row" },
              el("span", {}, d.name, el("span", { class: "small muted", text: ` · seen ${when(d.lastSeenAt)}` })),
              buttonFor("Remove", "small danger", () => post(`/api/admin/devices/${d.id}/revoke`), `Remove "${d.name}"?`),
            )
          )
          : el("span", { class: "muted", text: "none" }),
        u.openTokens.map((t) =>
          el("div", { class: "small muted", text: `${t.kind === "transfer" ? "Transfer code" : "Token"} unused: ${t.usesLeft} left, expires ${when(t.expiresAt)}` })
        ),
      ),
      el("td", {},
        u.status === "active"
          ? buttonFor("Deactivate", "small danger", () => post(`/api/admin/users/${u.id}/deactivate`), `Deactivate ${u.email}? Every device they have is removed right away.`)
          : buttonFor("Reactivate", "small", () => post(`/api/admin/users/${u.id}/reactivate`)),
      ),
    )
  );
  return el("div", { class: "card" },
    el("h2", { text: "People" }),
    el("div", { class: "table-scroll" },
      el("table", {},
        el("thead", {}, el("tr", {}, ["Person", "Status", "Areas", "Devices", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows),
      ),
    ),
  );
}

function adminsCard(data, activeAdmins) {
  const adminRows = data.admins.map((a) =>
    el("tr", {},
      el("td", { text: a.email + (a.id === data.me.id ? " (you)" : "") }),
      el("td", {}, el("span", { class: `status ${a.status}`, text: a.status })),
      el("td", { text: when(a.createdAt) }),
      el("td", {}, a.status === "active" && activeAdmins.length > 1 ? revokeAdminButton(a, "Revoke") : null),
    )
  );

  const candidates = data.people.filter((p) => !activeAdmins.some((a) => a.email === p.email));
  const errors = el("div");
  const pick = el("select", { id: "new-admin" }, candidates.map((p) => el("option", { value: p.email, text: `${p.name} · ${p.email}` })));
  const create = el("button", { class: "primary", text: "Create one-time admin link" });
  create.addEventListener("click", action(create, async () => {
    const invite = await api("/api/admin/admin-invites", { email: pick.value });
    shownOnce = {
      title: `One-time admin link for ${pick.value}`,
      value: invite.link,
      help: invite.status === "awaiting_approval"
        ? "Shown only once. It won't work until another admin approves it below; then it works once, for 60 minutes."
        : `Shown only once. It works once and expires ${when(invite.expiresAt)}. Opening it changes nothing until they confirm and create a passkey.`,
    };
    await load();
  }, errors));

  const open = data.invites.filter((i) => i.status === "awaiting_approval" || i.status === "ready");
  const inviteRows = open.map((i) =>
    el("tr", {},
      el("td", { text: i.email }),
      el("td", {}, el("span", { class: `status ${i.status}`, text: i.status.replace("_", " ") })),
      el("td", { text: i.createdBy + (i.breakGlass ? " (emergency)" : "") }),
      el("td", { text: i.expiresAt ? when(i.expiresAt) : "after approval" }),
      el("td", { class: "row" },
        i.status === "awaiting_approval" && !i.createdByMe
          ? buttonFor("Approve", "small", () => post(`/api/admin/admin-invites/${i.id}/approve`), `Approve the admin link for ${i.email}?`)
          : null,
        buttonFor("Revoke", "small danger", () => post(`/api/admin/admin-invites/${i.id}/revoke`)),
      ),
    )
  );

  return el("div", { class: "card stack" },
    el("h2", { text: "Admins" }),
    el("div", { class: "table-scroll" },
      el("table", {},
        el("thead", {}, el("tr", {}, ["Admin", "Status", "Since", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, adminRows),
      ),
    ),
    el("div", {}, el("label", { for: "new-admin", text: "Invite an admin" }), pick),
    el("p", { class: "small muted" },
      data.rules.twoPersonRule
        ? "There are 2+ admins, so a second admin must approve every new admin link."
        : "With fewer than 2 admins, new links work straight away. Keep at least 2 admins so nobody gets locked out.",
    ),
    candidates.length ? create : el("p", { class: "muted", text: "Everyone on the people list is already an admin." }),
    errors,
    open.length
      ? el("div", { class: "table-scroll" },
        el("table", {},
          el("thead", {}, el("tr", {}, ["Open link for", "Status", "Created by", "Expires", ""].map((h) => el("th", { text: h })))),
          el("tbody", {}, inviteRows),
        ),
      )
      : null,
  );
}

function auditCard(data) {
  const rows = data.audit.slice(0, 40).map((r) =>
    el("tr", {},
      el("td", { class: "small", text: when(r.at) }),
      el("td", { text: r.actor }),
      el("td", { text: r.action }),
      el("td", { class: "small", text: r.target ?? "" }),
    )
  );
  return el("div", { class: "card" },
    el("h2", { text: "Audit log" }),
    el("div", { class: "table-scroll" },
      el("table", {},
        el("thead", {}, el("tr", {}, ["When", "Who", "What", "Target"].map((h) => el("th", { text: h })))),
        el("tbody", {}, rows),
      ),
    ),
  );
}

function revokeAdminButton(admin, label) {
  return buttonFor(label, "small danger", () => post(`/api/admin/admins/${admin.id}/revoke`), `Revoke admin ${admin.email}?`);
}

function buttonFor(label, cls, run, confirmText) {
  const button = el("button", { class: cls, text: label });
  button.addEventListener("click", action(button, async () => {
    if (confirmText && !confirm(confirmText)) return;
    await run();
  }));
  return button;
}

load();
