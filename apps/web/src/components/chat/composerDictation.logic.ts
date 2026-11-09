import type { Locale } from "~/i18n";

/**
 * How the composer's mic dictates: Windows desktop opens system voice typing (Win+H); a browser
 * with the Web Speech API streams into the prompt. Electron's Web Speech API has no Google key,
 * so desktop never uses it. "unavailable" hides the button.
 */
export type DictationMode = "windows-voice-typing" | "web-speech" | "unavailable";

export function resolveDictationMode(input: {
  /** `desktopBridge.getClientPlatform()` in the desktop app, null in a browser. */
  readonly desktopPlatform: string | null;
  readonly desktopCanStartSystemDictation: boolean;
  readonly hasSpeechRecognition: boolean;
}): DictationMode {
  if (input.desktopPlatform !== null) {
    return input.desktopPlatform === "win32" && input.desktopCanStartSystemDictation
      ? "windows-voice-typing"
      : "unavailable";
  }
  return input.hasSpeechRecognition ? "web-speech" : "unavailable";
}

export function speechRecognitionLanguage(locale: Locale): string {
  return locale === "es" ? "es-MX" : "en-US";
}

/**
 * Replaces the text this dictation session inserted last (`previous`) with the latest
 * transcript, so interim results update in place. If the prompt no longer ends with the
 * previous insertion (the user edited it meanwhile), the transcript is appended instead.
 * Returns the new prompt and the insertion to remember for the next update.
 */
export function applyDictatedText(
  prompt: string,
  previous: string,
  transcript: string,
): { readonly prompt: string; readonly insertion: string } {
  const base =
    previous.length > 0 && prompt.endsWith(previous)
      ? prompt.slice(0, prompt.length - previous.length)
      : prompt;
  const text = transcript.trim();
  if (text.length === 0) return { prompt: base, insertion: "" };
  const insertion = base.length === 0 || /\s$/.test(base) ? text : ` ${text}`;
  return { prompt: base + insertion, insertion };
}
