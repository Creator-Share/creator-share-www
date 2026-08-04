import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { discoverLocalSupabase } from "./support/local-supabase.mjs"

const RUNNER_PATH = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "postgrest-role-claim-http.mjs",
)
const MAXIMUM_CHILD_OUTPUT_BYTES = 16 * 1024
const READY_TIMEOUT_MILLISECONDS = 15_000
const EXIT_TIMEOUT_MILLISECONDS = 25_000
const READY_POLL_MILLISECONDS = 50
const FIXED_ERROR_PATTERN = /^[a-z0-9_]{1,180}$/

function fixedError(code, cause) {
  return cause === undefined ? new Error(code) : new Error(code, { cause })
}

function safeFailureCode(error) {
  return typeof error?.message === "string" &&
    FIXED_ERROR_PATTERN.test(error.message)
    ? error.message
    : "postgrest_role_termination_gate_failed"
}

async function sleep(milliseconds) {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}

function captureBoundedOutput(stream, child) {
  let output = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    output += chunk
    if (Buffer.byteLength(output, "utf8") > MAXIMUM_CHILD_OUTPUT_BYTES) {
      child.kill("SIGKILL")
    }
  })
  return () => output
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error?.code === "ENOENT") return false
    throw fixedError("postgrest_role_termination_path_inspection_failed", error)
  }
}

async function waitForReady(child, readyPath, expectedPhase) {
  const deadline = Date.now() + READY_TIMEOUT_MILLISECONDS
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw fixedError("postgrest_role_termination_child_exited_before_ready")
    }
    if (await pathExists(readyPath)) {
      let marker
      try {
        marker = JSON.parse(await readFile(readyPath, "utf8"))
      } catch (error) {
        throw fixedError("postgrest_role_termination_marker_invalid", error)
      }
      if (
        marker?.schemaVersion !== 1 ||
        marker?.state !== expectedPhase ||
        Object.keys(marker).length !== 2
      ) {
        throw fixedError("postgrest_role_termination_marker_invalid")
      }
      return
    }
    await sleep(READY_POLL_MILLISECONDS)
  }
  throw fixedError("postgrest_role_termination_child_not_ready")
}

async function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode }
  }
  return new Promise((resolveExit, rejectExit) => {
    let settled = false
    const finish = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    const timeout = setTimeout(() => {
      child.kill("SIGKILL")
      finish(
        rejectExit,
        fixedError("postgrest_role_termination_child_exit_timed_out"),
      )
    }, EXIT_TIMEOUT_MILLISECONDS)
    child.once("error", (error) => {
      finish(
        rejectExit,
        fixedError("postgrest_role_termination_child_unavailable", error),
      )
    })
    child.once("close", (code, signal) => {
      finish(resolveExit, { code, signal })
    })
  })
}

function authFixtureResidueCount(database, fixtureNamespace) {
  if (!/^[0-9a-f]{24}$/.test(fixtureNamespace)) {
    throw fixedError("postgrest_role_termination_fixture_namespace_invalid")
  }
  const result = spawnSync(
    "docker",
    [
      "exec",
      database.containerName,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database.sourceDatabaseName,
      "-c",
      `SELECT count(*) FROM auth.users WHERE email LIKE 'postgrest-role-claim-${fixtureNamespace}-%@example.test'`,
    ],
    {
      cwd: database.workspace,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    },
  )
  if (result.error || result.status !== 0 || result.stdout.trim() !== "0") {
    throw fixedError("postgrest_role_termination_fixture_residue_detected")
  }
}

async function runSignalScenario(
  database,
  root,
  signal,
  expectedExitCode,
  terminationPhase,
) {
  const label = `${signal.toLowerCase()}-${terminationPhase}`
  const fixtureNamespace = randomBytes(12).toString("hex")
  const evidencePath = join(root, `${label}-evidence.json`)
  const staleTemporaryEvidencePath = `${evidencePath}.tmp-424242`
  const readyPath = join(root, `${label}-ready.json`)
  await Promise.all(
    [evidencePath, staleTemporaryEvidencePath].map((path) =>
      writeFile(path, '{"stale":true}\n', {
        encoding: "utf8",
        mode: 0o600,
      }),
    ),
  )
  const child = spawn(process.execPath, [RUNNER_PATH], {
    cwd: database.workspace,
    env: {
      ...process.env,
      ADVOCATE_POSTGREST_ROLE_HTTP_EVIDENCE_PATH: evidencePath,
      ADVOCATE_POSTGREST_ROLE_HTTP_TERMINATION_PROBE_PATH: readyPath,
      ADVOCATE_POSTGREST_ROLE_HTTP_TERMINATION_PROBE_PHASE: terminationPhase,
      ADVOCATE_POSTGREST_ROLE_HTTP_FIXTURE_NAMESPACE: fixtureNamespace,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const readOutput = captureBoundedOutput(child.stdout, child)
  const readError = captureBoundedOutput(child.stderr, child)
  try {
    await waitForReady(child, readyPath, terminationPhase)
    if (!child.kill(signal)) {
      throw fixedError("postgrest_role_termination_signal_failed")
    }
    if (terminationPhase === "auth_fixture_ready") {
      await sleep(25)
      if (!child.kill(signal)) {
        throw fixedError("postgrest_role_termination_repeat_signal_failed")
      }
    }
    const result = await waitForExit(child)
    if (result.code !== expectedExitCode) {
      throw fixedError("postgrest_role_termination_exit_code_invalid")
    }
    if (result.signal !== null) {
      throw fixedError("postgrest_role_termination_exit_signal_invalid")
    }
    if (readOutput().length !== 0) {
      throw fixedError("postgrest_role_termination_stdout_not_empty")
    }
    if (readError().length !== 0) {
      throw fixedError("postgrest_role_termination_stderr_not_empty")
    }
    for (const path of [
      evidencePath,
      `${evidencePath}.tmp-${child.pid}`,
      staleTemporaryEvidencePath,
      readyPath,
    ]) {
      if (await pathExists(path)) {
        throw fixedError("postgrest_role_termination_artifact_survived")
      }
    }
    authFixtureResidueCount(database, fixtureNamespace)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL")
      await waitForExit(child).catch(() => undefined)
    }
  }
}

export async function runPostgrestRoleClaimTerminationGate(options = {}) {
  const workspace = resolve(options.workspace ?? process.cwd())
  const database = await discoverLocalSupabase({ workspace })
  const root = await mkdtemp(join(tmpdir(), "postgrest-role-termination-"))
  try {
    for (const terminationPhase of [
      "auth_fixture_ready",
      "evidence_write_started",
    ]) {
      await runSignalScenario(database, root, "SIGINT", 130, terminationPhase)
      await runSignalScenario(database, root, "SIGTERM", 143, terminationPhase)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function main() {
  try {
    await runPostgrestRoleClaimTerminationGate()
    process.stdout.write(
      "PostgREST role claim forced termination cleanup passed\n",
    )
  } catch (error) {
    process.stderr.write(
      `PostgREST role claim forced termination cleanup failed: ${safeFailureCode(error)}\n`,
    )
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
