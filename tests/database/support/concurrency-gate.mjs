import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import {
  closePgClients,
  disposeActiveTransientLocalSupabaseDatabases,
} from "./local-supabase.mjs"

const GATE_PATTERN = /^FF-[0-9]{3}$/
const MIGRATION_FILE_PATTERN = /^[0-9]{14}_[a-z0-9_-]+\.sql$/
const MIGRATION_BOUNDARY_PATTERN = /^[0-9]{14}_[a-z0-9_-]+$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const SYNCHRONIZATION_PATTERN = /^[a-z][a-z0-9_]{0,119}$/
const TERMINATION_CLEANUP_TIMEOUT_MILLISECONDS = 20_000

function requireGate(gate) {
  if (typeof gate !== "string" || !GATE_PATTERN.test(gate)) {
    throw new Error("concurrency_gate_identifier_invalid")
  }
  return gate
}

function resolveOptionalEvidencePath(outputPath) {
  if (outputPath === null || outputPath === undefined) return null
  if (
    typeof outputPath !== "string" ||
    outputPath.length === 0 ||
    outputPath.includes("\0")
  ) {
    throw new Error("concurrency_gate_evidence_path_invalid")
  }
  return resolve(outputPath)
}

export async function withPgClients(database, labels, callback) {
  if (
    !database ||
    typeof database.createClient !== "function" ||
    !Array.isArray(labels) ||
    labels.length === 0 ||
    labels.some((label) => typeof label !== "string" || label.length === 0) ||
    typeof callback !== "function"
  ) {
    throw new Error("concurrency_gate_client_scope_invalid")
  }
  const clients = []
  try {
    for (const label of labels) {
      clients.push(await database.createClient(label))
    }
    return await callback(...clients)
  } finally {
    await closePgClients(clients)
  }
}

export async function loadConcurrencyGateProvenance(database, options = {}) {
  if (!database || !Array.isArray(database.sourceAppliedMigrationVersions)) {
    throw new Error("concurrency_gate_database_provenance_invalid")
  }
  const workspace = resolve(options.workspace ?? process.cwd())
  const migrationDirectory = resolve(workspace, "supabase/migrations")
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort()
  assert.equal(migrationFiles.length > 0, true)
  assert.equal(
    migrationFiles.every((fileName) => MIGRATION_FILE_PATTERN.test(fileName)),
    true,
  )
  const expectedMigrationVersions = migrationFiles.map((fileName) =>
    fileName.slice(0, 14),
  )
  assert.equal(
    new Set(expectedMigrationVersions).size,
    expectedMigrationVersions.length,
  )
  const migrationDigest = createHash("sha256")
  for (const fileName of migrationFiles) {
    migrationDigest.update(fileName, "utf8")
    migrationDigest.update("\0", "utf8")
    migrationDigest.update(
      await readFile(resolve(migrationDirectory, fileName)),
    )
    migrationDigest.update("\0", "utf8")
  }

  assert.deepEqual(
    database.sourceAppliedMigrationVersions,
    expectedMigrationVersions,
  )

  const postgresqlMajorVersion = await withPgClients(
    database,
    ["provenance_reader"],
    async (client) => {
      const result = await client.query(
        `SELECT current_setting('server_version_num')::integer AS version_num`,
      )
      assert.equal(result.rowCount, 1)
      return Math.trunc(result.rows[0].version_num / 10_000)
    },
  )
  assert.equal(postgresqlMajorVersion, 15)

  return Object.freeze({
    postgresqlMajorVersion,
    migrationBoundary: migrationFiles.at(-1).replace(/\.sql$/, ""),
    migrationSetSha256: migrationDigest.digest("hex"),
  })
}

export async function clearConcurrencyGateEvidence(outputPath) {
  const resolvedPath = resolveOptionalEvidencePath(outputPath)
  if (resolvedPath) await rm(resolvedPath, { force: true })
}

export function installConcurrencyGateTerminationCleanup({
  gate,
  getDatabase,
}) {
  const validatedGate = requireGate(gate)
  if (typeof getDatabase !== "function") {
    throw new Error("concurrency_gate_database_accessor_invalid")
  }

  const listeners = new Map()
  let handlingSignal = false
  for (const [signal, exitCode] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ]) {
    const listener = () => {
      if (handlingSignal) return
      handlingSignal = true
      const hardStop = setTimeout(
        () => process.exit(exitCode),
        TERMINATION_CLEANUP_TIMEOUT_MILLISECONDS,
      )
      const database = getDatabase()
      Promise.resolve(
        database
          ? database.dispose({ force: true })
          : disposeActiveTransientLocalSupabaseDatabases(),
      )
        .catch(() => {
          process.stderr.write(
            `${validatedGate} transient database cleanup failed during termination\n`,
          )
        })
        .finally(() => {
          clearTimeout(hardStop)
          process.exit(exitCode)
        })
    }
    listeners.set(signal, listener)
    process.once(signal, listener)
  }
  return () => {
    for (const [signal, listener] of listeners) {
      process.removeListener(signal, listener)
    }
  }
}

export async function writeConcurrencyGateEvidence({
  gate,
  outputPath,
  provenance,
  synchronization = "server_observed_blocking_pids",
  scenarios,
}) {
  const resolvedPath = resolveOptionalEvidencePath(outputPath)
  if (!resolvedPath) return
  const validatedGate = requireGate(gate)
  if (
    !provenance ||
    !Number.isSafeInteger(provenance.postgresqlMajorVersion) ||
    provenance.postgresqlMajorVersion < 1 ||
    typeof provenance.migrationBoundary !== "string" ||
    !MIGRATION_BOUNDARY_PATTERN.test(provenance.migrationBoundary) ||
    typeof provenance.migrationSetSha256 !== "string" ||
    !SHA256_PATTERN.test(provenance.migrationSetSha256) ||
    typeof synchronization !== "string" ||
    !SYNCHRONIZATION_PATTERN.test(synchronization) ||
    !Array.isArray(scenarios)
  ) {
    throw new Error("concurrency_gate_evidence_invalid")
  }

  const evidence = {
    schemaVersion: 1,
    gate: validatedGate,
    outcome: "passed",
    database: `disposable_local_supabase_postgresql_${provenance.postgresqlMajorVersion}`,
    synchronization,
    migrationBoundary: provenance.migrationBoundary,
    migrationSetSha256: provenance.migrationSetSha256,
    completedAt: new Date().toISOString(),
    scenarios,
  }
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  })
}
