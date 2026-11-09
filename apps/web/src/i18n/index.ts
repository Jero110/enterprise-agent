import { ES_DICTIONARY } from "./es";

// Norai speaks Spanish by default. Strings are written in English in the code and
// passed through `t()`, which returns the Spanish text when the locale is "es".
// Tests keep English so existing assertions on visible text stay valid.

export type Locale = "es" | "en";

export const LOCALE_OPTIONS: ReadonlyArray<{ readonly id: Locale; readonly label: string }> = [
  { id: "es", label: "Español" },
  { id: "en", label: "English" },
];

const STORAGE_KEY = "sequoia.locale";
const DEFAULT_LOCALE: Locale = import.meta.env.MODE === "test" ? "en" : "es";

function readStoredLocale(): Locale {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === "es" || stored === "en") return stored;
  } catch {
    // Storage can be blocked (private mode, sandboxed iframes); fall back to the default.
  }
  return DEFAULT_LOCALE;
}

let currentLocale: Locale = readStoredLocale();

if (typeof document !== "undefined") {
  document.documentElement.lang = currentLocale;
}

export function getLocale(): Locale {
  return currentLocale;
}

/** Saves the language for this device and reloads so every screen picks it up. */
export function setLocale(next: Locale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Not persisted; it still applies until the next reload.
  }
  currentLocale = next;
  if (typeof window !== "undefined") window.location.reload();
}

/**
 * Translates an English UI string. `{name}` placeholders are filled from `values`.
 * `context` picks a different translation when the same English word means different things
 * (dictionary key `"context::English"`, falling back to the plain key).
 * Unknown strings are returned unchanged, so a missing translation shows English, never a blank.
 */
export function t(
  text: string,
  values?: Readonly<Record<string, string | number>>,
  context?: string,
): string {
  const base =
    currentLocale === "es"
      ? ((context ? ES_DICTIONARY[`${context}::${text}`] : undefined) ??
        ES_DICTIONARY[text] ??
        text)
      : text;
  if (!values) return base;
  return base.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/** The server names fresh chats "New thread" until it picks a real title; show that in the user's language. */
export function threadTitleForDisplay(title: string): string {
  return title === "New thread" ? t("New thread") : title;
}
