#!/usr/bin/env node
/**
 * Fails when the repository and the release manifest disagree.
 *
 * The manifest classifies every test-shaped file. Required lanes run in CI,
 * optional lanes need an external provider, and support lanes contain imported
 * harness modules rather than independently executable tests.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

const workspace = resolve(import.meta.dirname, "..")
const manifestPath = resolve(workspace, "tests/release-manifest.json")

/** Exclusive classifications. Every discovered file belongs to exactly one. */
const CLASSIFICATION_LANES = [
  "offline-playwright",
  "dev-server-playwright",
  "seeded-database-playwright",
  "opt-in-integration",
  "pgtap",
  "database-harness",
  "provider-canary",
  "harness-support",
]

/** Lanes that add an extra runtime for files already assigned elsewhere. */
const OVERLAY_LANES = ["webkit-browser", "local-supabase-integration"]

function trackedFiles(...paths) {
  // --others --exclude-standard includes new, not-yet-committed test files.
  // Without it a brand-new spec passes this gate locally and only fails after
  // it has been committed, which defeats the point of catching it in the same
  // change that introduces it. Ignored files stay excluded.
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...paths],
    { cwd: workspace, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
}

function discoverTestFiles() {
  // Scan the whole repository, not a fixed set of directories. Restricting the
  // scan to tests/ and supabase/tests/ made this gate correct only for the
  // current layout: a spec added under src/, or a pgTAP file placed outside
  // supabase/tests/, would simply never be discovered and would look assigned
  // when it was not. Recognising test-shaped files anywhere means a future
  // layout change surfaces as a gate failure rather than as silent coverage
  // loss.
  const everything = trackedFiles()
  return everything.filter((file) => {
    if (/\.(spec|test)\.(ts|tsx|js|jsx)$/.test(file)) return true
    if (/\.test\.sql$/.test(file)) return true
    if (file.startsWith("supabase/tests/") && file.endsWith(".sql")) return true
    // Node harnesses under tests/, excluding fixture application config such as
    // a fixture's own next.config.mjs, which is scaffolding rather than a test.
    if (
      file.startsWith("tests/") &&
      !file.startsWith("tests/fixtures/") &&
      file.endsWith(".mjs")
    ) {
      return true
    }
    return false
  })
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const problems = []

const knownLanes = new Set([...CLASSIFICATION_LANES, ...OVERLAY_LANES])
for (const lane of Object.keys(manifest.lanes)) {
  if (!knownLanes.has(lane)) {
    problems.push(
      `Manifest declares lane "${lane}", which this gate does not know how ` +
        `to classify. Add it to CLASSIFICATION_LANES or OVERLAY_LANES.`,
    )
  }
}
for (const lane of knownLanes) {
  if (!manifest.lanes[lane]) {
    problems.push(`Manifest is missing expected lane "${lane}".`)
  }
}
for (const [lane, definition] of Object.entries(manifest.lanes)) {
  if (typeof definition.required !== "boolean") {
    problems.push(`Lane "${lane}" must declare a boolean "required" value.`)
  }
}

const assignment = new Map()
for (const lane of CLASSIFICATION_LANES) {
  for (const file of manifest.lanes[lane]?.files ?? []) {
    const existing = assignment.get(file)
    if (existing) {
      problems.push(
        `"${file}" is assigned to both "${existing}" and "${lane}". A test ` +
          `file must have exactly one classification lane.`,
      )
      continue
    }
    assignment.set(file, lane)
  }
}

for (const [lane, definition] of Object.entries(manifest.lanes)) {
  for (const file of definition.files ?? []) {
    if (!existsSync(resolve(workspace, file))) {
      problems.push(`"${file}" is in lane "${lane}" but does not exist.`)
    }
  }
}

for (const lane of OVERLAY_LANES) {
  for (const file of manifest.lanes[lane]?.files ?? []) {
    if (!assignment.has(file)) {
      problems.push(
        `"${file}" is in overlay lane "${lane}" but has no execution lane.`,
      )
    }
  }
}

const unassigned = discoverTestFiles().filter((file) => !assignment.has(file))
for (const file of unassigned) {
  problems.push(
    `"${file}" is a test file with no lane in tests/release-manifest.json. ` +
      `Classify it in the same change that adds it.`,
  )
}

if (problems.length > 0) {
  console.error("Release manifest verification failed:\n")
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error(
    `\n${problems.length} problem(s). Every repository test-shaped file must ` +
      `have exactly one classification lane.`,
  )
  process.exit(1)
}

const counts = Object.entries(manifest.lanes)
  .map(([lane, definition]) => `${lane}=${definition.files.length}`)
  .join(" ")
const requiredAssignments = [...assignment.values()].filter(
  (lane) => manifest.lanes[lane].required,
).length
console.log(
  `Release manifest verified: ${assignment.size} test-shaped files classified, ` +
    `${requiredAssignments} in required lanes. ${counts}`,
)
