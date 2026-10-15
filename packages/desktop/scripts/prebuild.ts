#!/usr/bin/env bun
import { $ } from "bun"

import { copyBuiltCliToResources, downloadCliToResources, resolveChannel } from "./utils"

const channel = resolveChannel()

if (channel === "prod" && !Bun.env.OPENCODE_CLI_DIST) {
  throw new Error("OPENCODE_CLI_DIST is required for production desktop builds")
}

await $`bun ./scripts/copy-icons.ts ${channel}`

await $`bun ./scripts/copy-metainfo.ts ${channel}`

// When a locally-built CLI distribution is provided (e.g. a Big Sur-compatible
// build), use it for every channel instead of downloading the published binary.
// This keeps the desktop build self-contained and free of post-build patching.
if (Bun.env.OPENCODE_CLI_DIST) {
  await copyBuiltCliToResources(Bun.env.OPENCODE_CLI_DIST)
} else if (channel === "dev") {
  await downloadCliToResources()
} else if (channel === "beta") {
  await downloadCliToResources("beta")
}
