import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { access, rm, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import pg from "pg"

import { discoverLocalSupabase } from "./support/local-supabase.mjs"

const { Client } = pg

const WORKSPACE = resolve(import.meta.dirname, "../..")
const HARNESS_PATH = resolve(
  WORKSPACE,
  "tests/database/advocate-branding-authority-concurrency.mjs",
)
const READY_OUTPUT = "FF-048 termination probe ready\n"
const DATABASE_PREFIX_PATTERN = /^[a-z][a-z0-9]{1,15}$/
const MAXIMUM_CAPTURED_OUTPUT_BYTES = 64 * 1024
const READY_TIMEOUT_MILLISECONDS = 30_000
const EXIT_TIMEOUT_MILLISECONDS = 25_000
const CLEANUP_TIMEOUT_MILLISECONDS = 10_000
const POLL_INTERVAL_MILLISECONDS = 25

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}

function captureBoundedOutput(stream) {
  let value = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    if (value.length >= MAXIMUM_CAPTURED_OUTPUT_BYTES) return
    value += chunk.slice(0, MAXIMUM_CAPTURED_OUTPUT_BYTES - value.length)
  })
  return () => value
}

function observeChild(child) {
  return new Promise((resolveChild, rejectChild) => {
    let settled = false
    child.once("error", (error) => {
      if (settled) return
      settled = true
      rejectChild(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      resolveChild({ code, signal })
    })
  })
}

async function withTimeout(promise, timeoutMilliseconds, label) {
  let timeout
  try {
    return await Promise.race([
      promise,
      new Promise((_, rejectTimeout) => {
        timeout = setTimeout(
          () => rejectTimeout(new Error(`${label}_timed_out`)),
          timeoutMilliseconds,
        )
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

function databaseNamePattern(databasePrefix) {
  assert.match(databasePrefix, DATABASE_PREFIX_PATTERN)
  return new RegExp(`^${databasePrefix}_[0-9a-f]{24}$`)
}

async function listBrandingAuthorityDatabases(observer, databasePrefix) {
  const namePattern = databaseNamePattern(databasePrefix)
  const result = await observer.query(
    `SELECT datname
       FROM pg_catalog.pg_database
      WHERE LEFT(datname, LENGTH($1) + 1) = $1 || '_'
      ORDER BY datname`,
    [databasePrefix],
  )
  const names = result.rows.map((row) => row.datname)
  assert.equal(
    names.every((name) => namePattern.test(name)),
    true,
  )
  return names
}

async function waitForCondition(callback, timeoutMilliseconds, label) {
  const deadline = Date.now() + timeoutMilliseconds
  while (Date.now() < deadline) {
    if (await callback()) return
    await delay(POLL_INTERVAL_MILLISECONDS)
  }
  throw new Error(`${label}_timed_out`)
}

async function removeResidualDatabases(observer, databasePrefix) {
  const namePattern = databaseNamePattern(databasePrefix)
  for (const databaseName of await listBrandingAuthorityDatabases(
    observer,
    databasePrefix,
  )) {
    assert.match(databaseName, namePattern)
    await observer.query(
      `SELECT pg_catalog.pg_terminate_backend(pid)
         FROM pg_catalog.pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_catalog.pg_backend_pid()`,
      [databaseName],
    )
    await observer.query(`DROP DATABASE "${databaseName}"`)
  }
}

async function assertEvidenceWasNotPublished(evidencePath) {
  await assert.rejects(
    access(evidencePath),
    (error) => error?.code === "ENOENT",
  )
}

async function runTerminationScenario(observer, signal, expectedExitCode) {
  const databasePrefix = `bat${process.pid.toString(36)}${
    signal === "SIGINT" ? "i" : "t"
  }`
  assert.match(databasePrefix, DATABASE_PREFIX_PATTERN)
  const evidencePath = resolve(
    "/tmp",
    `advocate-branding-authority-${process.pid}-${signal.toLowerCase()}.json`,
  )
  await writeFile(evidencePath, '{"stale":true}\n', {
    encoding: "utf8",
    mode: 0o600,
  })

  const child = spawn(process.execPath, [HARNESS_PATH], {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      ADVOCATE_BRANDING_AUTHORITY_DATABASE_PREFIX: databasePrefix,
      ADVOCATE_BRANDING_AUTHORITY_CONCURRENCY_EVIDENCE_PATH: evidencePath,
      ADVOCATE_BRANDING_AUTHORITY_TERMINATION_PROBE: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const readStandardOutput = captureBoundedOutput(child.stdout)
  const readStandardError = captureBoundedOutput(child.stderr)
  const childResult = observeChild(child)

  try {
    await waitForCondition(
      () => {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`branding_authority_${signal}_exited_before_ready`)
        }
        return readStandardOutput().includes(READY_OUTPUT)
      },
      READY_TIMEOUT_MILLISECONDS,
      `branding_authority_${signal}_ready`,
    )

    const activeDatabases = await listBrandingAuthorityDatabases(
      observer,
      databasePrefix,
    )
    assert.equal(activeDatabases.length, 1)
    await assertEvidenceWasNotPublished(evidencePath)
    assert.equal(child.kill(signal), true)

    const result = await withTimeout(
      childResult,
      EXIT_TIMEOUT_MILLISECONDS,
      `branding_authority_${signal}_exit`,
    )
    assert.deepEqual(result, { code: expectedExitCode, signal: null })
    assert.equal(
      readStandardError().includes(
        "transient database cleanup failed during termination",
      ),
      false,
      `branding authority ${signal} reported cleanup failure: ${readStandardError()}`,
    )

    await waitForCondition(
      async () =>
        (await listBrandingAuthorityDatabases(observer, databasePrefix))
          .length === 0,
      CLEANUP_TIMEOUT_MILLISECONDS,
      `branding_authority_${signal}_cleanup`,
    )
    await assertEvidenceWasNotPublished(evidencePath)
    process.stdout.write(
      `ok FF-048 ${signal} exits ${expectedExitCode} with no transient database or evidence\n`,
    )
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
    }
    await childResult.catch(() => undefined)
    await rm(evidencePath, { force: true })
    await removeResidualDatabases(observer, databasePrefix)
  }
}

async function main() {
  const discovery = await discoverLocalSupabase({ workspace: WORKSPACE })
  const observer = new Client({
    connectionString: discovery.sourceConnectionString,
    application_name: "ff048_termination_observer",
  })
  await observer.connect()
  try {
    await runTerminationScenario(observer, "SIGINT", 130)
    await runTerminationScenario(observer, "SIGTERM", 143)
    process.stdout.write("FF-048 forced termination cleanup gate passed\n")
  } finally {
    await observer.end()
  }
}

await main()
