#!/usr/bin/env node
/**
 * Runs the public catalog lane against the already-running local Supabase
 * stack.
 *
 * The lane needs the stack's URL and anonymous key. Those are read here rather
 * than named in the workflow, because the FF-029 contract forbids the database
 * gate workflow from ever mentioning a Supabase key variable, so that a later
 * edit cannot quietly point it at a real project.
 *
 * Values are passed straight into the child process and are never printed.
 */

import { execFileSync, spawnSync } from "node:child_process"
import { resolve } from "node:path"

const workspace = resolve(import.meta.dirname, "..")

function localStackEnvironment() {
  const raw = execFileSync(
    resolve(workspace, "node_modules/.bin/supabase"),
    ["status", "-o", "env"],
    { cwd: workspace, encoding: "utf8" },
  )

  const values = new Map()
  for (const line of raw.split("\n")) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) values.set(match[1], match[2])
  }
  return values
}

const stack = localStackEnvironment()
const apiUrl = stack.get("API_URL")
const anonKey = stack.get("ANON_KEY")
// The public catalog route reads the catalog through the service role, so the
// lane cannot run on the anonymous key alone.
const serviceRoleKey = stack.get("SERVICE_ROLE_KEY")

if (!apiUrl || !anonKey || !serviceRoleKey) {
  console.error(
    "Could not read the local Supabase stack. Start it before this lane.",
  )
  process.exit(1)
}
console.log(`Local Supabase API reachable at ${apiUrl}`)

const result = spawnSync(
  process.execPath,
  [
    resolve(workspace, "scripts/run-release-lane.mjs"),
    "seeded-database-playwright",
    "--retries=0",
  ],
  {
    cwd: workspace,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: apiUrl,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      NEXT_SERVICE_ROLE_KEY: serviceRoleKey,
    },
    stdio: "inherit",
  },
)
process.exit(result.status ?? 1)
