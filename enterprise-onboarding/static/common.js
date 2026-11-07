/** Calls the API. GET when body is undefined, otherwise a JSON POST. Throws Error with .code and .status. */
export async function api(path, body, headers = {}) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? headers : { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data.message || `Request failed (${res.status})`), {
      code: data.error,
      status: res.status,
    });
  }
  return data;
}

/** Builds DOM nodes. Text always goes in as text, never HTML, so names and emails can't inject markup. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && typeof value !== "string") node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replaces target's content, skipping empty slots (null, undefined, false) the way el() does. */
export function mount(target, ...children) {
  target.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
}

export function when(ms) {
  if (!ms) return "never";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function notice(kind, message) {
  return el("div", { class: `notice ${kind}`, role: kind === "bad" ? "alert" : "status" }, message);
}

/** Runs an async action from a button, disabling it meanwhile and showing failures next to it. */
export function action(button, run, errorSlot) {
  return async () => {
    button.disabled = true;
    errorSlot?.replaceChildren();
    try {
      await run();
    } catch (err) {
      if (errorSlot) errorSlot.replaceChildren(notice("bad", err.message));
      else alert(err.message);
    } finally {
      button.disabled = false;
    }
  };
}

export async function copy(text, button) {
  await navigator.clipboard.writeText(text);
  const label = button.textContent;
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = label), 1500);
}
