// The boot screen (#boot-shell in index.html) sits above #root and draws the Sequoia logo while the
// app loads. Once the app has mounted, it stays until the logo has finished drawing, then fades away.
// It is never moved in the page: re-inserting it would restart the drawing.

/** When the logo is fully drawn, measured from page start (see the #boot-logo animations in index.html). */
const LOGO_DRAWN_MS = 1_900;
const FADE_MS = 300;

export function dismissBootSplash(): void {
  const shell = document.getElementById("boot-shell");
  // A boot error screen lives in the same element; never hide it.
  if (!shell || shell.dataset.splash || document.getElementById("boot-error")) return;
  shell.dataset.splash = "waiting";

  const wait = Math.max(0, LOGO_DRAWN_MS - performance.now());
  window.setTimeout(() => {
    if (document.getElementById("boot-error")) return;
    shell.dataset.splash = "leaving";
    window.setTimeout(() => shell.remove(), FADE_MS);
  }, wait);
}
