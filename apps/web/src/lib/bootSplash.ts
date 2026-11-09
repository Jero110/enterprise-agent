// The boot screen (#boot-shell in index.html) sits above #root and shows the Norai logo while the
// app loads. Once the app has mounted, it fades away.
const FADE_MS = 300;

export function dismissBootSplash(): void {
  const shell = document.getElementById("boot-shell");
  // A boot error screen lives in the same element; never hide it.
  if (!shell || shell.dataset.splash || document.getElementById("boot-error")) return;
  shell.dataset.splash = "leaving";
  window.setTimeout(() => shell.remove(), FADE_MS);
}
