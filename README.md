# Enterprise Agent

Enterprise Agent is our collaborative, customizable desktop IDE for working with coding agents. This repository is based on [T3 Code](https://github.com/pingdotgg/t3code), an open-source agent control surface, and retains its MIT license and required attribution. The product branding and development experience are being customized here.

## Run the desktop app in development

This is the version to use while we build and change the IDE. It runs the Electron desktop app from this checkout; it is separate from any packaged app you may already have installed.

### Requirements

- macOS, Windows, or Linux
- Node.js `26.12.1` (see `engines` in `package.json`)
- pnpm `12.14.0` (see `packageManager` in `package.json`)

### Start it

```bash
git clone https://github.com/Jero110/enterprise-agent.git
cd enterprise-agent
pnpm install
pnpm dev:desktop
```

The first start can take a few minutes while dependencies and the desktop bundle are prepared. Keep the terminal open while using the app. Stop the development server with **Ctrl+C**. Frontend edits usually appear through hot reload; if the window does not update, reload it with **⌘R** on macOS or **Ctrl+R** on Windows/Linux.

To work on the web client without the Electron shell, use `pnpm dev:web`. To run the regular server and web development stack, use `pnpm dev`.

### Make changes with your team

Create a branch for each change and open a pull request so teammates can review it before merging to `main`:

```bash
git switch -c feature/your-change
# edit and test
git add .
git commit -m "feat: describe your change"
git push -u origin feature/your-change
```

Do not commit credentials, `.env` files, local databases, or generated user data. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md) before making larger changes.

## Architecture and guides

The app has desktop (Electron), web, and mobile clients. The original project documentation in [`docs/`](./docs) remains useful for providers, permissions, keyboard shortcuts, remote access, settings, and development internals. Start with [the development overview](./docs/internals/overview.md).

For agents, the upstream project supports Codex, Claude Code, Cursor, Grok Build, OpenCode, Google Antigravity, and fx. Provider setup guidance is in [`docs/user/`](./docs/user).

## Attribution and license

Enterprise Agent is derived from T3 Code, copyright T3 Tools Inc. The original MIT license is in [`LICENSE`](./LICENSE); preserve its copyright and license notices in copies and distributions. See [`third-party-licenses/`](./third-party-licenses) for additional dependency notices.
