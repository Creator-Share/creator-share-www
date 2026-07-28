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
const playwrightCli = resolve(workspace, "node_modules/@playwright/test/cli.js")
if (!existsSync(playwrightCli)) {
  console.error(
    "The pinned Playwright CLI is missing. Install the repository dependencies first.",
  )
  process.exit(2)
}
/**
 * Whether the dev port is free, decided in a child process so the answer is
 * synchronous. Any probe failure is reported as "free" rather than "busy": a
 * probe that cannot run is not evidence that somebody else holds the port, and
 * refusing on that basis would block every lane for an unrelated reason.
 */
function devPortIsFree(port) {
  const probe = spawnSync(
    process.execPath,
    [
      "-e",
      'const n=require("node:net");const s=n.createServer();' +
        's.once("error",()=>process.exit(1));' +
        `s.listen(${Number(port)},"127.0.0.1",()=>s.close(()=>process.exit(0)));`,
    ],
    { stdio: "ignore", timeout: 5_000 },
  )
  // A probe that could not run at all is not evidence that somebody else holds
  // the port, and refusing on that basis would block every lane for an
  // unrelated reason.
  if (probe.error) return true
  return probe.status === 0
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

/**
 * Refuse to drive somebody else's application.
 *
 * Playwright adopts whatever answers the dev port, and `next dev` quietly moves
 * to the next free port when the configured one is taken while Playwright keeps
 * waiting on the original. A foreign process therefore answers every request
 * and the lane reports failures that say nothing about this repository. That
 * was observed once as thirty tests failing against an unrelated project.
 *
 * This check belongs here rather than in playwright.config.ts. The config is
 * evaluated twice, once in the main process and again in each worker, and the
 * worker's evaluation races dev server startup: measured locally the worker won
 * and saw a free port, while on CI it lost and refused to run against the very
 * server Playwright had just started. One process, once, before Playwright, is
 * the only placement that cannot misread our own server.
 *
 * The wait exists because a previous lane in the same job may still be
 * releasing the port. Only a port still held after that is treated as foreign.
 */
if (!env.PW_NO_WEBSERVER) {
  const devPort = env.PLAYWRIGHT_DEV_PORT ?? "3000"
  const waitDeadline = Date.now() + 15_000
  let free = devPortIsFree(devPort)
  while (!free && Date.now() < waitDeadline) {
    sleepSync(500)
    free = devPortIsFree(devPort)
  }
  if (!free) {
    console.error(
      `Port ${devPort} is still in use after waiting, so lane "${lane}" would ` +
        `drive whatever is listening there instead of this application. Stop ` +
        `that process, or set PLAYWRIGHT_DEV_PORT to a free port, or set ` +
        `PW_NO_WEBSERVER=1 to deliberately test a server you started yourself.`,
    )
    process.exit(2)
  }
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
