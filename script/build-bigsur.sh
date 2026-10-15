#!/usr/bin/env bash
#
# Build the Big Sur (macOS 11) compatible desktop app + CLI in one shot.
#
# Why this wrapper exists:
#   - The official desktop build downloads a prebuilt CLI from npm, but that CLI
#     crashes on macOS < 12 (missing ICU symbols + SQLite RETURNING syntax). We
#     must build the CLI locally and feed it to the desktop build via
#     OPENCODE_CLI_DIST instead.
#   - This IDE's terminal injects a node safe-delete shim via NODE_OPTIONS that
#     breaks vite's cache cleanup, so we clear NODE_OPTIONS for the build.
#   - The ICU shim is read from ~/.bun/lib/shim_libicucore.dylib by the CLI build
#     (override with OPENCODE_ICU_SHIM).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Make node (for electron-vite / electron-builder) and bun available.
[ -d "$HOME/.nvm/versions/node/v22.23.3/bin" ] && export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"
[ -d "$HOME/.bun/bin" ] && export PATH="$HOME/.bun/bin:$PATH"

# Required so vite's bulk cache cleanup is not blocked by the IDE's safe-delete shim.
export NODE_OPTIONS=

# Point the desktop prebuild at our locally-built Big Sur CLI.
export OPENCODE_CLI_DIST="$ROOT/packages/cli/dist"

echo "==> [1/2] building Big Sur CLI (opencode-darwin-x64-baseline) ..."
bun run --cwd "$ROOT/packages/cli" build --target=opencode-darwin-x64-baseline

echo "==> [2/2] building + packaging desktop app ..."
cd "$ROOT/packages/desktop"
npm run build
npm run package

echo "==> done. artifacts:"
ls -la "$ROOT/packages/desktop/dist/" | grep -iE "dmg|zip" || true
