// Windows voice typing (the Win+H panel) is free, needs no API key, speaks Spanish, and types
// into whatever text field has focus. Electron can only synthesize input inside its own page,
// so the shortcut is sent to the OS with user32 `keybd_event`.

export interface WindowsKeyboardApi {
  readonly getForegroundWindow: () => bigint;
  readonly keyEvent: (virtualKey: number, flags: number) => void;
}

const VK_LWIN = 0x5b;
const VK_H = 0x48;
const KEYEVENTF_EXTENDEDKEY = 0x1;
const KEYEVENTF_KEYUP = 0x2;

function nativeWindowHandle(buffer: Buffer): bigint {
  if (buffer.length === 8) return buffer.readBigUInt64LE();
  if (buffer.length === 4) return BigInt(buffer.readUInt32LE());
  throw new Error(`Unsupported Windows window handle size: ${String(buffer.length)} bytes.`);
}

/**
 * Presses Win+H only while `handleBuffer` is the foreground window, so the keys can never land
 * in another app. Both keys are always released, even if a press throws.
 */
export function pressVoiceTypingShortcutWithApi(
  handleBuffer: Buffer,
  api: WindowsKeyboardApi,
): boolean {
  if (api.getForegroundWindow() !== nativeWindowHandle(handleBuffer)) return false;
  try {
    api.keyEvent(VK_LWIN, KEYEVENTF_EXTENDEDKEY);
    api.keyEvent(VK_H, 0);
  } finally {
    api.keyEvent(VK_H, KEYEVENTF_KEYUP);
    api.keyEvent(VK_LWIN, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP);
  }
  return true;
}

let windowsKeyboardApiPromise: Promise<WindowsKeyboardApi> | undefined;

function loadWindowsKeyboardApi(): Promise<WindowsKeyboardApi> {
  windowsKeyboardApiPromise ??= import("ffi-rs").then(({ DataType, load, open }) => {
    const user32 = "t3-user32-keyboard";
    open({ library: user32, path: "user32.dll" });
    return {
      getForegroundWindow: () =>
        load({
          library: user32,
          funcName: "GetForegroundWindow",
          retType: DataType.BigInt,
          paramsType: [],
          paramsValue: [],
        }) as bigint,
      keyEvent: (virtualKey, flags) => {
        load({
          library: user32,
          funcName: "keybd_event",
          retType: DataType.Void,
          paramsType: [DataType.I32, DataType.I32, DataType.U32, DataType.BigInt],
          paramsValue: [virtualKey, 0, flags, 0n],
        });
      },
    } satisfies WindowsKeyboardApi;
  });
  return windowsKeyboardApiPromise;
}

export async function pressWindowsVoiceTypingShortcut(handleBuffer: Buffer): Promise<boolean> {
  return pressVoiceTypingShortcutWithApi(handleBuffer, await loadWindowsKeyboardApi());
}
