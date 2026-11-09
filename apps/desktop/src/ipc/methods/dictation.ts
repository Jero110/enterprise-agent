import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { pressWindowsVoiceTypingShortcut } from "../../electron/WindowsVoiceTyping.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

/**
 * Opens Windows voice typing (Win+H) over the focused composer. Resolves false, never throws,
 * when it cannot: not Windows, a request from another page, or the app is not in front.
 */
export const startSystemDictation = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.START_SYSTEM_DICTATION_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.dictation.startSystemDictation")(function* (_input, event) {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "win32") return false;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.main;
    if (
      event === undefined ||
      Option.isNone(window) ||
      window.value.isDestroyed() ||
      window.value.webContents.id !== event.sender.id
    ) {
      return false;
    }
    const handle = window.value.getNativeWindowHandle();
    return yield* Effect.tryPromise(() => pressWindowsVoiceTypingShortcut(handle)).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("Could not send the Windows voice typing shortcut.", cause),
      ),
      Effect.orElseSucceed(() => false),
    );
  }),
});
