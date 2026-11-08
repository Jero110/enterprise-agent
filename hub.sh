#!/bin/sh
# Enterprise hub as a desktop app, with its own data in ~/.t3-hub. Pass --share for Tailscale.
cd "$(dirname "$0")" && exec node_modules/.bin/vp run dev:hub:desktop "$@"
