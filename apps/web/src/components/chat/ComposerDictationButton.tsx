import { MicIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getLocale, t } from "~/i18n";
import { useStableCallback } from "../../hooks/useStableCallback";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  applyDictatedText,
  type DictationMode,
  resolveDictationMode,
  speechRecognitionLanguage,
} from "./composerDictation.logic";

// The Web Speech API is not in every TypeScript DOM lib yet; only what the button uses.
interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: { readonly 0: { readonly transcript: string } };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { readonly results: SpeechRecognitionResultListLike }) => void) | null;
  onerror: ((event: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

/** Dictation ends after this long without new speech. */
const SILENCE_TIMEOUT_MS = 6_000;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidates = window as unknown as {
    readonly SpeechRecognition?: SpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidates.SpeechRecognition ?? candidates.webkitSpeechRecognition ?? null;
}

function currentDictationMode(): DictationMode {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  return resolveDictationMode({
    desktopPlatform: bridge ? bridge.getClientPlatform() : null,
    desktopCanStartSystemDictation: typeof bridge?.startSystemDictation === "function",
    hasSpeechRecognition: speechRecognitionConstructor() !== null,
  });
}

function reportSpeechError(error: string) {
  // "no-speech" and "aborted" are ordinary endings: silence, or the user stopped it.
  if (error === "no-speech" || error === "aborted") return;
  if (error === "not-allowed" || error === "service-not-allowed" || error === "audio-capture") {
    toastManager.add({
      type: "error",
      title: t("Microphone access is blocked"),
      description: t("Allow the microphone for this site in your browser to dictate."),
    });
    return;
  }
  toastManager.add({
    type: "error",
    title: t("Dictation stopped"),
    description: t("The browser's speech service is unavailable. Try again or type your message."),
  });
}

/**
 * The composer's microphone. On Windows desktop it opens Windows voice typing (Win+H) over the
 * focused editor; in a browser with the Web Speech API it streams the transcript into the prompt.
 * Hidden everywhere else.
 */
export function ComposerDictationButton(props: {
  readonly disabled: boolean;
  /** Focuses the editor synchronously, so typed or dictated text lands in it. */
  readonly focusEditor: () => void;
  readonly editPrompt: (edit: (prompt: string) => string) => void;
}) {
  const [mode] = useState(currentDictationMode);
  const [listening, setListening] = useState(false);
  const [starting, setStarting] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const insertionRef = useRef("");
  const silenceTimerRef = useRef<number | null>(null);
  const editPrompt = useStableCallback(props.editPrompt);
  const focusEditor = useStableCallback(props.focusEditor);

  const clearSilenceTimer = () => {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = null;
  };
  const armSilenceTimer = () => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(
      () => recognitionRef.current?.stop(),
      SILENCE_TIMEOUT_MS,
    );
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- ends the browser's speech recognition session and its silence timer when the composer turns busy or unmounts
  useEffect(() => {
    if (props.disabled) return;
    return () => {
      if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      setListening(false);
    };
  }, [props.disabled]);

  if (mode === "unavailable") return null;

  const startWebSpeech = () => {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.lang = speechRecognitionLanguage(getLocale());
    recognition.continuous = true;
    recognition.interimResults = true;
    insertionRef.current = "";
    recognition.onresult = (event) => {
      let transcript = "";
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index]?.[0].transcript ?? "";
      }
      const spoken = transcript.replace(/\s+/g, " ");
      editPrompt((prompt) => {
        const next = applyDictatedText(prompt, insertionRef.current, spoken);
        insertionRef.current = next.insertion;
        return next.prompt;
      });
      armSilenceTimer();
    };
    recognition.onerror = (event) => reportSpeechError(event.error);
    recognition.onend = () => {
      clearSilenceTimer();
      if (recognitionRef.current === recognition) recognitionRef.current = null;
      setListening(false);
    };
    try {
      recognition.start();
    } catch {
      reportSpeechError("start-failed");
      return;
    }
    recognitionRef.current = recognition;
    setListening(true);
    armSilenceTimer();
    focusEditor();
  };

  const startWindowsVoiceTyping = async () => {
    const startSystemDictation = window.desktopBridge?.startSystemDictation;
    // Voice typing writes into whatever has focus, so the editor must have it first.
    focusEditor();
    setStarting(true);
    const started = startSystemDictation ? await startSystemDictation().catch(() => false) : false;
    setStarting(false);
    if (started) return;
    toastManager.add({
      type: "error",
      title: t("Couldn't start voice typing"),
      description: t("Press Windows + H to dictate, or turn on voice typing in Windows Settings."),
    });
  };

  const onClick = () => {
    if (mode === "windows-voice-typing") {
      if (!starting) void startWindowsVoiceTyping();
      return;
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }
    startWebSpeech();
  };

  const label =
    mode === "windows-voice-typing"
      ? t("Dictate (Windows voice typing)")
      : listening
        ? t("Stop dictation")
        : t("Dictate");
  const tooltip = listening ? t("Listening… click to stop") : label;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={listening ? "ghost-destructive" : "ghost"}
            size="icon-sm"
            className="relative"
            // Keep focus in the editor so voice typing and the transcript land there.
            onPointerDown={(event) => event.preventDefault()}
            onClick={onClick}
            disabled={props.disabled || starting}
            aria-label={label}
            {...(mode === "web-speech" ? { "aria-pressed": listening } : {})}
            aria-busy={starting || undefined}
            data-composer-dictation={mode}
          />
        }
      >
        <MicIcon />
        {listening ? (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-1.5 animate-pulse rounded-full bg-destructive"
          />
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>{tooltip}</TooltipPopup>
    </Tooltip>
  );
}
