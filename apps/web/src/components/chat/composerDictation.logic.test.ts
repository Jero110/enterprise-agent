import { describe, expect, it } from "vite-plus/test";

import {
  applyDictatedText,
  resolveDictationMode,
  speechRecognitionLanguage,
} from "./composerDictation.logic";

describe("resolveDictationMode", () => {
  it.each([
    [
      { desktopPlatform: "win32", desktopCanStartSystemDictation: true },
      true,
      "windows-voice-typing",
    ],
    // A desktop build whose preload predates the bridge method.
    [{ desktopPlatform: "win32", desktopCanStartSystemDictation: false }, true, "unavailable"],
    // Electron's Web Speech API has no Google key, so desktop never uses it.
    [{ desktopPlatform: "darwin", desktopCanStartSystemDictation: true }, true, "unavailable"],
    [{ desktopPlatform: "linux", desktopCanStartSystemDictation: true }, true, "unavailable"],
    [{ desktopPlatform: null, desktopCanStartSystemDictation: false }, true, "web-speech"],
    [{ desktopPlatform: null, desktopCanStartSystemDictation: false }, false, "unavailable"],
  ] as const)("%o with speech recognition %s is %s", (desktop, hasSpeechRecognition, mode) => {
    expect(resolveDictationMode({ ...desktop, hasSpeechRecognition })).toBe(mode);
  });
});

describe("speechRecognitionLanguage", () => {
  it("maps the app locale to a recognition language", () => {
    expect(speechRecognitionLanguage("es")).toBe("es-MX");
    expect(speechRecognitionLanguage("en")).toBe("en-US");
  });
});

describe("applyDictatedText", () => {
  it("separates dictation from existing text with one space", () => {
    expect(applyDictatedText("Hola", "", "qué tal")).toEqual({
      prompt: "Hola qué tal",
      insertion: " qué tal",
    });
    expect(applyDictatedText("Hola\n", "", "qué tal").prompt).toBe("Hola\nqué tal");
    expect(applyDictatedText("", "", "  hola ").prompt).toBe("hola");
  });

  it("replaces the previous interim result in place", () => {
    const first = applyDictatedText("Hola", "", "qué");
    expect(applyDictatedText(first.prompt, first.insertion, "qué tal estás")).toEqual({
      prompt: "Hola qué tal estás",
      insertion: " qué tal estás",
    });
  });

  it("removes the interim text when the transcript becomes empty", () => {
    expect(applyDictatedText("Hola qué", " qué", "")).toEqual({ prompt: "Hola", insertion: "" });
  });

  it("appends instead of overwriting when the user edited the prompt meanwhile", () => {
    expect(applyDictatedText("Hola qué! ", " qué", "tal").prompt).toBe("Hola qué! tal");
  });
});
