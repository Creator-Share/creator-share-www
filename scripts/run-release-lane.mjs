#!/usr/bin/env node
/**
 * Runs one release-manifest lane.
 *
 * CI steps name a lane instead of repeating file lists, so adding a test file
 * to the manifest is the only action required to put it into required CI.
 * Hardcoded lists in workflow YAML are what allowed coverage to drift.
 *
 * Usage: node scripts/run-release-lane.mjs <lane> [extra playwright args]
 */

import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const workspace = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(
  readFileSync(resolve(workspace, "tests/release-manifest.json"), "utf8"),
)

const [lane, ...extraArgs] = process.argv.slice(2)
if (!lane) {
  console.error(
    `Usage: node scripts/run-release-lane.mjs <lane>\nLanes: ${Object.keys(
      manifest.lanes,
    ).join(", ")}`,
  )
  process.exit(2)
}

const definition = manifest.lanes[lane]
if (!definition) {
  console.error(
    `Unknown lane "${lane}". Lanes: ${Object.keys(manifest.lanes).join(", ")}`,
  )
  process.exit(2)
}
if (definition.files.length === 0) {
  console.log(`Lane "${lane}" has no files. Nothing to run.`)
  process.exit(0)
}

if (definition.runner === "supabase-test-db" || definition.runner === "node") {
  console.error(
    `Lane "${lane}" uses the "${definition.runner}" runner, which is executed ` +
      `by its own workflow step rather than this script.`,
  )
  process.exit(2)
}

const env = { ...process.env, ...(definition.env ?? {}) }
const playwrightCli = resolve(
  workspace,
  "node_modules/@playwright/test/cli.js",
)
if (!existsSync(playwrightCli)) {
  console.error(
    "The pinned Playwright CLI is missing. Install the repository dependencies first.",
  )
  process.exit(2)
}
const args = [playwrightCli, "test", ...definition.files, ...extraArgs]

console.log(
  `Lane "${lane}": ${definition.files.length} file(s). ${definition.description}`,
)

const result = spawnSync(process.execPath, args, {
  cwd: workspace,
  env,
  stdio: "inherit",
})
process.exit(result.status ?? 1)
