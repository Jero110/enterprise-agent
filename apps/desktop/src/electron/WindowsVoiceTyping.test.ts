import { assert, describe, it } from "@effect/vitest";
import { vi } from "vite-plus/test";

import { pressVoiceTypingShortcutWithApi, type WindowsKeyboardApi } from "./WindowsVoiceTyping.ts";

function nativeHandle(value: bigint): Buffer {
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(value);
  return handle;
}

function makeApi(input: { readonly foregroundWindow: bigint; readonly failOnKey?: number }) {
  return {
    getForegroundWindow: vi.fn(() => input.foregroundWindow),
    keyEvent: vi.fn((virtualKey: number, flags: number) => {
      if (virtualKey === input.failOnKey && flags === 0) throw new Error("press failed");
    }),
  } satisfies WindowsKeyboardApi;
}

describe("Windows voice typing shortcut", () => {
  it("presses and releases Win+H while the app window is in front", () => {
    const api = makeApi({ foregroundWindow: 41n });

    assert.isTrue(pressVoiceTypingShortcutWithApi(nativeHandle(41n), api));

    assert.deepEqual(api.keyEvent.mock.calls, [
      [0x5b, 0x1],
      [0x48, 0],
      [0x48, 0x2],
      [0x5b, 0x3],
    ]);
  });

  it("sends no keys when another window is in front", () => {
    const api = makeApi({ foregroundWindow: 99n });

    assert.isFalse(pressVoiceTypingShortcutWithApi(nativeHandle(41n), api));

    assert.lengthOf(api.keyEvent.mock.calls, 0);
  });

  it("still releases both keys when a press fails", () => {
    const api = makeApi({ foregroundWindow: 41n, failOnKey: 0x48 });

    assert.throws(() => pressVoiceTypingShortcutWithApi(nativeHandle(41n), api), "press failed");

    assert.deepEqual(api.keyEvent.mock.calls.slice(-2), [
      [0x48, 0x2],
      [0x5b, 0x3],
    ]);
  });
});
