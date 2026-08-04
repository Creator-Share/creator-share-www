import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"

import pg from "pg"

const { Client } = pg

// The Supabase CLI shells out to Docker, so a status probe on a loaded CI
// runner can take well over ten seconds. This budget only bounds a hang: a
// stack that is genuinely down exits non-zero quickly and raises
// local_supabase_status_failed instead, so a larger value cannot mask a real
// outage. Ten seconds failed the required gate at b4d6db5.
const DEFAULT_DISCOVERY_TIMEOUT_MILLISECONDS = 30_000
const DEFAULT_CLONE_TIMEOUT_MILLISECONDS = 180_000
const DEFAULT_CONNECTION_TIMEOUT_MILLISECONDS = 5_000
const DEFAULT_QUERY_TIMEOUT_MILLISECONDS = 20_000
const DEFAULT_LOCK_TIMEOUT_MILLISECONDS = 15_000
const DEFAULT_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS = 30_000
const DEFAULT_PROCESS_TERMINATION_GRACE_MILLISECONDS = 2_000
const DEFAULT_CLIENT_CLOSE_TIMEOUT_MILLISECONDS = 5_000
const DEFAULT_DATABASE_CREATE_TIMEOUT_MILLISECONDS = 5_000
const DEFAULT_DATABASE_DROP_TIMEOUT_MILLISECONDS = 4_000
const DATABASE_LIFECYCLE_TERMINATION_GRACE_MILLISECONDS = 500
const MAXIMUM_CAPTURED_PROCESS_OUTPUT_BYTES = 1024 * 1024
const POSTGRES_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
const TRANSIENT_DATABASE_PREFIX_PATTERN = /^[a-z][a-z0-9]{1,15}$/
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_.-]{1,63}$/
const CONTAINER_NAME_PATTERN = /^supabase_db_[A-Za-z0-9_.-]+$/
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])

const transientDatabaseStates = new WeakMap()
const clientTransientStates = new WeakMap()
const activeTransientDatabaseCleanups = new Set()

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function boundedInteger(value, fallback, minimum, maximum, label) {
  const candidate = value ?? fallback
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error(`${label}_invalid`)
  }
  return candidate
}

function parseJson(value, label) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`${label}_invalid_json`, { cause: error })
  }
}

function requireString(record, key, label) {
  const value = record[key]
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}_${key.toLowerCase()}_missing`)
  }
  return value
}

function parseProjectConfiguration(source) {
  const projectId = /^project_id\s*=\s*"([A-Za-z0-9_.-]+)"\s*$/m.exec(
    source,
  )?.[1]
  const databaseHeader = /^\[db\]\s*$/m.exec(source)
  const afterDatabaseHeader = databaseHeader
    ? source.slice(databaseHeader.index + databaseHeader[0].length)
    : ""
  const nextSectionOffset = /^\[[^\]]+\]\s*$/m.exec(afterDatabaseHeader)?.index
  const databaseSection =
    nextSectionOffset === undefined
      ? afterDatabaseHeader
      : afterDatabaseHeader.slice(0, nextSectionOffset)
  const databasePort = databaseSection
    ? /^port\s*=\s*([0-9]+)\s*$/m.exec(databaseSection)?.[1]
    : undefined

  if (!projectId || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error("local_supabase_project_id_invalid")
  }
  const parsedPort = Number(databasePort)
  if (
    !Number.isSafeInteger(parsedPort) ||
    parsedPort < 1 ||
    parsedPort > 65_535
  ) {
    throw new Error("local_supabase_database_port_invalid")
  }
  return { projectId, databasePort: parsedPort }
}

function parseLoopbackDatabaseUrl(value, expected = {}) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw new Error("local_supabase_database_url_invalid", { cause: error })
  }

  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !LOOPBACK_HOSTS.has(url.hostname) ||
    url.username !== "postgres" ||
    url.password.length === 0 ||
    url.search.length !== 0 ||
    url.hash.length !== 0
  ) {
    throw new Error("local_supabase_database_url_not_safe")
  }

  const port = Number(url.port)
  const databaseName = decodeURIComponent(url.pathname.slice(1))
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !POSTGRES_IDENTIFIER_PATTERN.test(databaseName)
  ) {
    throw new Error("local_supabase_database_url_not_safe")
  }
  if (expected.port !== undefined && port !== expected.port) {
    throw new Error("local_supabase_database_port_mismatch")
  }
  if (
    expected.databaseName !== undefined &&
    databaseName !== expected.databaseName
  ) {
    throw new Error("local_supabase_database_name_mismatch")
  }

  return { url, port, databaseName }
}

function requireLoopbackDatabaseContainerBinding(
  inspection,
  expectedProjectId,
  expectedPort,
) {
  if (!Array.isArray(inspection) || inspection.length !== 1) {
    throw new Error("local_supabase_database_container_inspection_invalid")
  }
  const container = inspection[0]
  const labels = container?.Config?.Labels
  const bindings = container?.NetworkSettings?.Ports?.["5432/tcp"]
  if (
    !isRecord(labels) ||
    labels["com.supabase.cli.project"] !== expectedProjectId
  ) {
    throw new Error("local_supabase_database_container_project_mismatch")
  }
  if (
    !Array.isArray(bindings) ||
    bindings.length < 1 ||
    bindings.some(
      (binding) =>
        !isRecord(binding) ||
        !LOOPBACK_HOSTS.has(binding.HostIp) ||
        binding.HostPort !== String(expectedPort),
    )
  ) {
    throw new Error("local_supabase_database_container_not_loopback_bound")
  }
}

function runSynchronousProcess(executable, args, options) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: MAXIMUM_CAPTURED_PROCESS_OUTPUT_BYTES,
    timeout: options.timeoutMilliseconds,
  })
  if (result.error) {
    throw new Error(`${options.label}_unavailable`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`${options.label}_failed`)
  }
  return result.stdout
}

function waitForProcess(child, options) {
  const graceMilliseconds = boundedInteger(
    options.terminationGraceMilliseconds,
    DEFAULT_PROCESS_TERMINATION_GRACE_MILLISECONDS,
    100,
    10_000,
    `${options.label}_termination_grace`,
  )

  return new Promise((resolveProcess, rejectProcess) => {
    let timedOut = false
    let settled = false
    let timeout
    let forceKillTimeout
    let abandonmentTimeout

    const settle = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(forceKillTimeout)
      clearTimeout(abandonmentTimeout)
      callback(value)
    }
    const terminate = () => {
      timedOut = true
      child.kill("SIGTERM")
      forceKillTimeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL")
        }
      }, graceMilliseconds)
      abandonmentTimeout = setTimeout(() => {
        settle(
          rejectProcess,
          new Error(`${options.label}_termination_timed_out`),
        )
      }, graceMilliseconds * 2)
    }

    child.once("error", (error) => {
      settle(
        rejectProcess,
        new Error(`${options.label}_unavailable`, { cause: error }),
      )
    })
    child.once("close", (code, signal) => {
      settle(resolveProcess, { code, signal, timedOut })
    })
    timeout = setTimeout(terminate, options.timeoutMilliseconds)
  })
}

function captureBoundedStream(stream) {
  let value = ""
  stream?.setEncoding("utf8")
  stream?.on("data", (chunk) => {
    if (value.length >= MAXIMUM_CAPTURED_PROCESS_OUTPUT_BYTES) return
    value += chunk.slice(
      0,
      MAXIMUM_CAPTURED_PROCESS_OUTPUT_BYTES - value.length,
    )
  })
  return () => value
}

async function runProcess(executable, args, options) {
  const child = spawn(executable, args, {
    cwd: options.cwd,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  })
  const readStandardError = captureBoundedStream(child.stderr)
  const readStandardOutput = captureBoundedStream(child.stdout)
  if (options.input !== undefined) {
    child.stdin.end(options.input)
  }

  const result = await waitForProcess(child, options)
  if (result.timedOut) throw new Error(`${options.label}_timed_out`)
  if (result.code !== 0) {
    const diagnostic = (readStandardError() || readStandardOutput()).trim()
    const error = new Error(`${options.label}_failed`)
    if (diagnostic.length > 0) error.diagnostic = diagnostic
    throw error
  }
}

async function streamPlainDatabaseDump({
  cwd,
  containerName,
  sourceDatabaseName,
  targetDatabaseName,
  timeoutMilliseconds,
  dumpArguments,
  targetDatabaseUser,
  label,
}) {
  if (targetDatabaseUser !== "supabase_admin") {
    throw new Error("transient_supabase_restore_user_invalid")
  }
  const dump = spawn(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      sourceDatabaseName,
      ...dumpArguments,
    ],
    { cwd, stdio: ["ignore", "pipe", "pipe"] },
  )
  const restore = spawn(
    "docker",
    [
      "exec",
      "-i",
      containerName,
      "sh",
      "-c",
      'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 "$@"',
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      targetDatabaseUser,
      "-d",
      targetDatabaseName,
      "-1",
    ],
    { cwd, stdio: ["pipe", "pipe", "pipe"] },
  )

  const readDumpError = captureBoundedStream(dump.stderr)
  const readRestoreError = captureBoundedStream(restore.stderr)
  captureBoundedStream(restore.stdout)

  let pipelineError = null
  dump.stdout.on("error", (error) => {
    pipelineError ??= error
  })
  restore.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") pipelineError ??= error
  })
  dump.stdout.pipe(restore.stdin)

  try {
    const [dumpResult, restoreResult] = await Promise.all([
      waitForProcess(dump, {
        timeoutMilliseconds,
        label: `${label}_dump`,
      }),
      waitForProcess(restore, {
        timeoutMilliseconds,
        label: `${label}_restore`,
      }),
    ])
    if (dumpResult.timedOut || restoreResult.timedOut) {
      throw new Error(`${label}_timed_out`)
    }
    if (pipelineError || dumpResult.code !== 0 || restoreResult.code !== 0) {
      const diagnostic = (readRestoreError() || readDumpError()).trim()
      const error = new Error(`${label}_failed`, {
        cause: pipelineError ?? undefined,
      })
      if (diagnostic.length > 0) error.diagnostic = diagnostic
      throw error
    }
  } finally {
    dump.stdout.unpipe(restore.stdin)
  }
}

async function executeContainerSql({
  workspace,
  containerName,
  databaseName,
  databaseUser,
  sql,
  timeoutMilliseconds,
  label,
}) {
  if (
    !CONTAINER_NAME_PATTERN.test(containerName) ||
    !POSTGRES_IDENTIFIER_PATTERN.test(databaseName) ||
    (databaseUser !== "postgres" && databaseUser !== "supabase_admin") ||
    typeof sql !== "string" ||
    sql.length < 1 ||
    Buffer.byteLength(sql, "utf8") > 8 * 1024 * 1024 ||
    sql.includes("\0")
  ) {
    throw new Error("container_sql_input_invalid")
  }
  await runProcess(
    "docker",
    databaseUser === "supabase_admin"
      ? [
          "exec",
          "-i",
          containerName,
          "sh",
          "-c",
          'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 "$@"',
          "psql",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          databaseUser,
          "-d",
          databaseName,
          "-f",
          "-",
        ]
      : [
          "exec",
          "-i",
          containerName,
          "psql",
          "-X",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          databaseUser,
          "-d",
          databaseName,
          "-f",
          "-",
        ],
    {
      cwd: workspace,
      input: sql,
      timeoutMilliseconds,
      label,
    },
  )
}

function loadRuntimeFunctionPrivileges(discovery, timeoutMilliseconds) {
  const functionGrants = runSynchronousProcess(
    "docker",
    [
      "exec",
      discovery.containerName,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      discovery.sourceDatabaseName,
      "-c",
      `SELECT format(
         'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO %s;',
         namespace.nspname,
         procedure.proname,
         pg_catalog.pg_get_function_identity_arguments(procedure.oid),
         CASE
           WHEN privilege.grantee = 0 THEN 'PUBLIC'
           ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(privilege.grantee))
         END
       )
       FROM pg_catalog.pg_proc procedure
       JOIN pg_catalog.pg_namespace namespace
         ON namespace.oid = procedure.pronamespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(
           procedure.proacl,
           pg_catalog.acldefault('f', procedure.proowner)
         )
       ) privilege
       WHERE namespace.nspname IN ('public', 'private', 'audit')
         AND procedure.prokind IN ('f', 'w')
         AND privilege.privilege_type = 'EXECUTE'
         AND (
           privilege.grantee = 0
           OR pg_catalog.pg_get_userbyid(privilege.grantee)
             IN ('anon', 'authenticated', 'service_role')
         )
       ORDER BY
         namespace.nspname,
         procedure.proname,
         pg_catalog.pg_get_function_identity_arguments(procedure.oid),
         privilege.grantee`,
    ],
    {
      cwd: discovery.workspace,
      timeoutMilliseconds,
      label: "local_supabase_runtime_function_privilege_read",
    },
  ).trim()

  const authGrants = runSynchronousProcess(
    "docker",
    [
      "exec",
      discovery.containerName,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      discovery.sourceDatabaseName,
      "-c",
      `SELECT statement
       FROM (
         SELECT
           1 AS object_order,
           privilege.grantee,
           privilege.privilege_type,
           format(
             'GRANT %s ON SCHEMA %I TO %s%s;',
             privilege.privilege_type,
             namespace.nspname,
             CASE
               WHEN privilege.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(privilege.grantee))
             END,
             CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
           ) AS statement
         FROM pg_catalog.pg_namespace namespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             namespace.nspacl,
             pg_catalog.acldefault('n', namespace.nspowner)
           )
         ) privilege
         WHERE namespace.nspname = 'auth'

         UNION ALL

         SELECT
           2 AS object_order,
           privilege.grantee,
           privilege.privilege_type,
           format(
             'GRANT %s ON TABLE %I.%I TO %s%s;',
             privilege.privilege_type,
             namespace.nspname,
             relation.relname,
             CASE
               WHEN privilege.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(privilege.grantee))
             END,
             CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
           ) AS statement
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = relation.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             relation.relacl,
             pg_catalog.acldefault('r', relation.relowner)
           )
         ) privilege
         WHERE namespace.nspname = 'auth'
           AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')

         UNION ALL

         SELECT
           3 AS object_order,
           privilege.grantee,
           privilege.privilege_type,
           format(
             'GRANT %s ON SEQUENCE %I.%I TO %s%s;',
             privilege.privilege_type,
             namespace.nspname,
             relation.relname,
             CASE
               WHEN privilege.grantee = 0 THEN 'PUBLIC'
               ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(privilege.grantee))
             END,
             CASE WHEN privilege.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END
           ) AS statement
         FROM pg_catalog.pg_class relation
         JOIN pg_catalog.pg_namespace namespace
           ON namespace.oid = relation.relnamespace
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             relation.relacl,
             pg_catalog.acldefault('S', relation.relowner)
           )
         ) privilege
         WHERE namespace.nspname = 'auth'
           AND relation.relkind = 'S'
       ) grants
       ORDER BY object_order, grantee, privilege_type, statement`,
    ],
    {
      cwd: discovery.workspace,
      timeoutMilliseconds,
      label: "local_supabase_auth_privilege_read",
    },
  ).trim()

  return `
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, private, audit
  FROM PUBLIC, anon, authenticated, service_role;
${functionGrants}
${authGrants}
`
}

function loadSourceAppliedMigrationVersions(discovery, timeoutMilliseconds) {
  const output = runSynchronousProcess(
    "docker",
    [
      "exec",
      discovery.containerName,
      "psql",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      discovery.sourceDatabaseName,
      "-c",
      "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version",
    ],
    {
      cwd: discovery.workspace,
      timeoutMilliseconds,
      label: "local_supabase_applied_migration_version_read",
    },
  )
  const versions = output
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
  if (
    versions.length === 0 ||
    versions.some((version) => !/^[0-9]{14}$/.test(version)) ||
    new Set(versions).size !== versions.length
  ) {
    throw new Error("local_supabase_applied_migration_versions_invalid")
  }
  return Object.freeze(versions)
}

function safeApplicationName(label, prefix) {
  if (typeof label !== "string" || label !== label.trim()) {
    throw new Error("postgres_client_label_invalid")
  }
  if (
    typeof prefix !== "string" ||
    !TRANSIENT_DATABASE_PREFIX_PATTERN.test(prefix)
  ) {
    throw new Error("postgres_client_database_prefix_invalid")
  }
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
  if (normalized.length === 0) {
    throw new Error("postgres_client_label_invalid")
  }
  return `${prefix}_${normalized}_${randomBytes(6).toString("hex")}`
}

function assertConnectedClient(client) {
  if (
    !client ||
    typeof client.query !== "function" ||
    !Number.isSafeInteger(client.processID) ||
    client.processID < 1
  ) {
    throw new Error("postgres_client_not_connected")
  }
}

async function beginRoleTransaction(client, role, claims) {
  assertConnectedClient(client)
  await client.query("BEGIN")
  try {
    await client.query(`SET LOCAL ROLE ${role}`)
    await client.query(
      `SELECT
         set_config('request.jwt.claim.role', $1, true),
         set_config('request.jwt.claim.sub', $2, true),
         set_config('request.jwt.claims', $3, true)`,
      [role, claims.sub ?? "", JSON.stringify(claims)],
    )
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

export async function discoverLocalSupabase(options = {}) {
  const workspace = resolve(options.workspace ?? process.cwd())
  const timeoutMilliseconds = boundedInteger(
    options.timeoutMilliseconds,
    DEFAULT_DISCOVERY_TIMEOUT_MILLISECONDS,
    1_000,
    60_000,
    "local_supabase_discovery_timeout",
  )
  const configuration = parseProjectConfiguration(
    await readFile(resolve(workspace, "supabase/config.toml"), "utf8"),
  )
  const executable = resolve(workspace, "node_modules/.bin/supabase")
  const statusText = runSynchronousProcess(
    executable,
    ["status", "-o", "json"],
    {
      cwd: workspace,
      timeoutMilliseconds,
      label: "local_supabase_status",
    },
  )
  const status = parseJson(statusText, "local_supabase_status")
  if (!isRecord(status)) throw new Error("local_supabase_status_invalid")
  const sourceConnectionString = requireString(
    status,
    "DB_URL",
    "local_supabase_status",
  )
  const parsedDatabase = parseLoopbackDatabaseUrl(sourceConnectionString, {
    port: configuration.databasePort,
  })

  const containerOutput = runSynchronousProcess(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${configuration.projectId}`,
      "--filter",
      "status=running",
      "--format",
      "{{.Names}}",
    ],
    {
      cwd: workspace,
      timeoutMilliseconds,
      label: "local_supabase_database_container_lookup",
    },
  )
  const containerNames = containerOutput
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value.startsWith("supabase_db_"))
  if (
    containerNames.length !== 1 ||
    !CONTAINER_NAME_PATTERN.test(containerNames[0])
  ) {
    throw new Error("local_supabase_database_container_ambiguous")
  }
  const containerName = containerNames[0]
  const containerInspection = parseJson(
    runSynchronousProcess("docker", ["inspect", containerName], {
      cwd: workspace,
      timeoutMilliseconds,
      label: "local_supabase_database_container_inspection",
    }),
    "local_supabase_database_container_inspection",
  )
  requireLoopbackDatabaseContainerBinding(
    containerInspection,
    configuration.projectId,
    configuration.databasePort,
  )

  const discovery = {
    workspace,
    projectId: configuration.projectId,
    databasePort: configuration.databasePort,
    sourceDatabaseName: parsedDatabase.databaseName,
    sourceConnectionString: parsedDatabase.url.toString(),
    containerName,
  }
  return Object.freeze({
    ...discovery,
    sourceAppliedMigrationVersions: loadSourceAppliedMigrationVersions(
      discovery,
      timeoutMilliseconds,
    ),
  })
}

export async function createTransientLocalSupabaseDatabase(options = {}) {
  const databasePrefix = options.databasePrefix ?? "ff040"
  if (
    typeof databasePrefix !== "string" ||
    !TRANSIENT_DATABASE_PREFIX_PATTERN.test(databasePrefix)
  ) {
    throw new Error("transient_supabase_database_prefix_invalid")
  }
  const discovery = await discoverLocalSupabase(options)
  const cloneTimeoutMilliseconds = boundedInteger(
    options.cloneTimeoutMilliseconds,
    DEFAULT_CLONE_TIMEOUT_MILLISECONDS,
    10_000,
    600_000,
    "transient_supabase_clone_timeout",
  )
  const databaseName = `${databasePrefix}_${randomBytes(12).toString("hex")}`
  if (!POSTGRES_IDENTIFIER_PATTERN.test(databaseName)) {
    throw new Error("transient_supabase_database_name_invalid")
  }

  let databaseCreatePromise
  let databaseCleanupPromise
  const databaseCreateTimeoutMilliseconds = Math.min(
    cloneTimeoutMilliseconds,
    DEFAULT_DATABASE_CREATE_TIMEOUT_MILLISECONDS,
  )
  const databaseDropTimeoutMilliseconds = Math.min(
    cloneTimeoutMilliseconds,
    DEFAULT_DATABASE_DROP_TIMEOUT_MILLISECONDS,
  )
  const dropDatabase = () =>
    runProcess(
      "docker",
      [
        "exec",
        discovery.containerName,
        "sh",
        "-c",
        'PGPASSWORD="$POSTGRES_PASSWORD" exec dropdb -h 127.0.0.1 "$@"',
        "dropdb",
        "-U",
        "supabase_admin",
        "--if-exists",
        "--force",
        databaseName,
      ],
      {
        cwd: discovery.workspace,
        timeoutMilliseconds: databaseDropTimeoutMilliseconds,
        terminationGraceMilliseconds:
          DATABASE_LIFECYCLE_TERMINATION_GRACE_MILLISECONDS,
        label: "transient_supabase_database_drop",
      },
    )
  const cleanupDatabase = () => {
    if (databaseCleanupPromise) return databaseCleanupPromise
    databaseCleanupPromise = (async () => {
      await databaseCreatePromise?.catch(() => undefined)
      try {
        await dropDatabase()
      } catch (firstDropError) {
        try {
          await dropDatabase()
        } catch (secondDropError) {
          throw new AggregateError(
            [firstDropError, secondDropError],
            "transient_supabase_database_drop_failed_twice",
          )
        }
      }
    })().then(
      () => {
        activeTransientDatabaseCleanups.delete(cleanupDatabase)
      },
      (error) => {
        databaseCleanupPromise = undefined
        throw error
      },
    )
    return databaseCleanupPromise
  }
  try {
    const runtimeFunctionPrivileges = loadRuntimeFunctionPrivileges(
      discovery,
      cloneTimeoutMilliseconds,
    )
    databaseCreatePromise = runProcess(
      "docker",
      [
        "exec",
        discovery.containerName,
        "createdb",
        "-U",
        "postgres",
        "-T",
        "template0",
        databaseName,
      ],
      {
        cwd: discovery.workspace,
        timeoutMilliseconds: databaseCreateTimeoutMilliseconds,
        terminationGraceMilliseconds:
          DATABASE_LIFECYCLE_TERMINATION_GRACE_MILLISECONDS,
        label: "transient_supabase_database_create",
      },
    )
    activeTransientDatabaseCleanups.add(cleanupDatabase)
    await databaseCreatePromise
    await executeContainerSql({
      workspace: discovery.workspace,
      containerName: discovery.containerName,
      databaseName,
      databaseUser: "supabase_admin",
      timeoutMilliseconds: cloneTimeoutMilliseconds,
      label: "transient_supabase_database_restore_grant",
      sql: `GRANT CREATE, TEMPORARY ON DATABASE "${databaseName}"
  TO supabase_admin;`,
    })
    await streamPlainDatabaseDump({
      cwd: discovery.workspace,
      containerName: discovery.containerName,
      sourceDatabaseName: discovery.sourceDatabaseName,
      targetDatabaseName: databaseName,
      timeoutMilliseconds: cloneTimeoutMilliseconds,
      dumpArguments: ["--schema-only", "--no-privileges"],
      targetDatabaseUser: "supabase_admin",
      label: "transient_supabase_schema_clone",
    })
    await executeContainerSql({
      workspace: discovery.workspace,
      containerName: discovery.containerName,
      databaseName,
      databaseUser: "supabase_admin",
      timeoutMilliseconds: cloneTimeoutMilliseconds,
      label: "transient_supabase_runtime_function_privilege_restore",
      sql: runtimeFunctionPrivileges,
    })
    await streamPlainDatabaseDump({
      cwd: discovery.workspace,
      containerName: discovery.containerName,
      sourceDatabaseName: discovery.sourceDatabaseName,
      targetDatabaseName: databaseName,
      timeoutMilliseconds: cloneTimeoutMilliseconds,
      dumpArguments: [
        "--data-only",
        "--no-owner",
        "--no-privileges",
        "--disable-triggers",
        "--table=public.roles",
        "--table=public.advocate_roles",
        "--table=public.advocate_permissions",
        "--table=public.advocate_role_permissions",
        "--table=public.advocate_reserved_subdomains",
      ],
      targetDatabaseUser: "supabase_admin",
      label: "transient_supabase_dictionary_clone",
    })
    await executeContainerSql({
      workspace: discovery.workspace,
      containerName: discovery.containerName,
      databaseName,
      databaseUser: "supabase_admin",
      timeoutMilliseconds: cloneTimeoutMilliseconds,
      label: "transient_supabase_auth_owner_privilege_restore",
      sql: `
GRANT USAGE ON SCHEMA auth TO postgres;
GRANT ALL PRIVILEGES ON TABLE auth.users, auth.sessions TO postgres;
`,
    })
  } catch (error) {
    try {
      await cleanupDatabase()
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "transient_supabase_database_creation_and_cleanup_failed",
      )
    }
    throw error
  }

  const connectionUrl = new URL(discovery.sourceConnectionString)
  connectionUrl.pathname = `/${databaseName}`
  const connectionString = connectionUrl.toString()
  parseLoopbackDatabaseUrl(connectionString, {
    port: discovery.databasePort,
    databaseName,
  })

  const descriptor = {
    workspace: discovery.workspace,
    projectId: discovery.projectId,
    databasePrefix,
    databasePort: discovery.databasePort,
    sourceDatabaseName: discovery.sourceDatabaseName,
    sourceAppliedMigrationVersions: discovery.sourceAppliedMigrationVersions,
    databaseName,
    containerName: discovery.containerName,
    connectionString,
    async createClient(label, clientOptions = {}) {
      return createPgClient(descriptor, label, clientOptions)
    },
    async executeSupabaseAdminSql(sql, sqlOptions = {}) {
      return executeSupabaseAdminSql(descriptor, sql, sqlOptions)
    },
    async dispose(options = {}) {
      if (
        !isRecord(options) ||
        Object.keys(options).some((key) => key !== "force") ||
        (options.force !== undefined && typeof options.force !== "boolean")
      ) {
        throw new Error("transient_supabase_database_dispose_options_invalid")
      }
      const force = options.force === true
      const state = transientDatabaseStates.get(descriptor)
      if (!state) throw new Error("transient_supabase_database_unknown")
      if (state.disposePromise) return state.disposePromise
      state.disposing = true
      const disposeAttempt = (async () => {
        try {
          await closePgClients([...state.clients], { force })
        } finally {
          await cleanupDatabase()
          state.disposed = true
        }
      })()
      state.disposePromise = disposeAttempt.catch((error) => {
        state.disposing = false
        state.disposePromise = null
        throw error
      })
      return state.disposePromise
    },
  }
  transientDatabaseStates.set(descriptor, {
    clients: new Set(),
    disposed: false,
    disposing: false,
    disposePromise: null,
    commandTimeoutMilliseconds: cloneTimeoutMilliseconds,
  })
  return Object.freeze(descriptor)
}

export async function disposeActiveTransientLocalSupabaseDatabases() {
  const settlements = await Promise.allSettled(
    [...activeTransientDatabaseCleanups].map((cleanup) => cleanup()),
  )
  const failures = settlements
    .filter((settlement) => settlement.status === "rejected")
    .map((settlement) => settlement.reason)
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "transient_supabase_emergency_cleanup_failed",
    )
  }
}

export async function executeSupabaseAdminSql(database, sql, options = {}) {
  const state = transientDatabaseStates.get(database)
  if (!state || state.disposing || state.disposed) {
    throw new Error("transient_supabase_database_invalid")
  }
  const timeoutMilliseconds = boundedInteger(
    options.timeoutMilliseconds,
    state.commandTimeoutMilliseconds,
    1_000,
    600_000,
    "supabase_admin_sql_timeout",
  )
  await executeContainerSql({
    workspace: database.workspace,
    containerName: database.containerName,
    databaseName: database.databaseName,
    databaseUser: "supabase_admin",
    sql,
    timeoutMilliseconds,
    label: "transient_supabase_admin_sql",
  })
}

export async function createPgClient(database, label, options = {}) {
  const connectionString =
    typeof database === "string" ? database : database?.connectionString
  if (typeof connectionString !== "string") {
    throw new Error("postgres_client_database_invalid")
  }
  const parsedDatabase = parseLoopbackDatabaseUrl(connectionString)
  const state =
    typeof database === "object" && database !== null
      ? transientDatabaseStates.get(database)
      : undefined
  if (state?.disposing || state?.disposed) {
    throw new Error("transient_supabase_database_disposed")
  }

  const applicationName = safeApplicationName(
    label,
    typeof database === "object" && database !== null
      ? (database.databasePrefix ?? "local")
      : "local",
  )
  const client = new Client({
    connectionString: parsedDatabase.url.toString(),
    application_name: applicationName,
    connectionTimeoutMillis: boundedInteger(
      options.connectionTimeoutMilliseconds,
      DEFAULT_CONNECTION_TIMEOUT_MILLISECONDS,
      1_000,
      30_000,
      "postgres_client_connection_timeout",
    ),
    query_timeout: boundedInteger(
      options.queryTimeoutMilliseconds,
      DEFAULT_QUERY_TIMEOUT_MILLISECONDS,
      1_000,
      120_000,
      "postgres_client_query_timeout",
    ),
    statement_timeout: boundedInteger(
      options.statementTimeoutMilliseconds,
      DEFAULT_QUERY_TIMEOUT_MILLISECONDS,
      1_000,
      120_000,
      "postgres_client_statement_timeout",
    ),
    lock_timeout: boundedInteger(
      options.lockTimeoutMilliseconds,
      DEFAULT_LOCK_TIMEOUT_MILLISECONDS,
      1_000,
      120_000,
      "postgres_client_lock_timeout",
    ),
    idle_in_transaction_session_timeout: boundedInteger(
      options.idleTransactionTimeoutMilliseconds,
      DEFAULT_IDLE_TRANSACTION_TIMEOUT_MILLISECONDS,
      1_000,
      120_000,
      "postgres_client_idle_transaction_timeout",
    ),
  })

  await client.connect()
  try {
    const verification = await client.query(
      `SELECT
         current_database() AS database_name,
         pg_backend_pid() AS backend_pid,
         current_setting('application_name') AS application_name`,
    )
    const row = verification.rows[0]
    if (
      verification.rowCount !== 1 ||
      row?.database_name !== parsedDatabase.databaseName ||
      row?.backend_pid !== client.processID ||
      row?.application_name !== applicationName
    ) {
      throw new Error("postgres_client_identity_mismatch")
    }
    await client.query("SET TIME ZONE 'UTC'")
  } catch (error) {
    await client.end().catch(() => undefined)
    throw error
  }

  if (state) {
    state.clients.add(client)
    clientTransientStates.set(client, state)
  }
  return client
}

export async function configureAuthenticatedTransaction(client, actor) {
  if (
    !isRecord(actor) ||
    typeof actor.userId !== "string" ||
    !UUID_PATTERN.test(actor.userId) ||
    typeof actor.sessionId !== "string" ||
    !UUID_PATTERN.test(actor.sessionId) ||
    (actor.aal !== undefined && actor.aal !== "aal1" && actor.aal !== "aal2")
  ) {
    throw new Error("authenticated_transaction_actor_invalid")
  }
  await beginRoleTransaction(client, "authenticated", {
    role: "authenticated",
    sub: actor.userId,
    session_id: actor.sessionId,
    aal: actor.aal ?? "aal1",
  })
}

export async function configureFreshEmailOtpAuthenticatedTransaction(
  client,
  actor,
) {
  if (
    !isRecord(actor) ||
    typeof actor.userId !== "string" ||
    !UUID_PATTERN.test(actor.userId) ||
    typeof actor.sessionId !== "string" ||
    !UUID_PATTERN.test(actor.sessionId) ||
    (actor.aal !== undefined && actor.aal !== "aal1" && actor.aal !== "aal2")
  ) {
    throw new Error("authenticated_transaction_actor_invalid")
  }

  assertConnectedClient(client)
  await client.query("BEGIN")
  try {
    const timestamp = await client.query(
      `SELECT extract(epoch FROM clock_timestamp())::bigint::text AS epoch`,
    )
    const authenticatedAtEpoch = Number(timestamp.rows[0]?.epoch)
    if (
      timestamp.rowCount !== 1 ||
      !Number.isSafeInteger(authenticatedAtEpoch) ||
      authenticatedAtEpoch < 1
    ) {
      throw new Error("postgres_database_clock_invalid")
    }
    const claims = {
      role: "authenticated",
      sub: actor.userId,
      session_id: actor.sessionId,
      aal: actor.aal ?? "aal1",
      iat: authenticatedAtEpoch,
      amr: [
        {
          method: "otp",
          timestamp: authenticatedAtEpoch,
        },
      ],
    }
    await client.query("SET LOCAL ROLE authenticated")
    await client.query(
      `SELECT
         set_config('request.jwt.claim.role', 'authenticated', true),
         set_config('request.jwt.claim.sub', $1, true),
         set_config('request.jwt.claims', $2, true)`,
      [actor.userId, JSON.stringify(claims)],
    )
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }
}

export async function configureServiceRoleTransaction(client) {
  await beginRoleTransaction(client, "service_role", {
    role: "service_role",
  })
}

async function settleClientCleanup(client, operation, label) {
  let timeout
  const deadline = new Promise((resolveDeadline) => {
    timeout = setTimeout(
      () => resolveDeadline({ timedOut: true }),
      DEFAULT_CLIENT_CLOSE_TIMEOUT_MILLISECONDS,
    )
  })
  const settlement = Promise.resolve()
    .then(operation)
    .then(
      () => ({ timedOut: false, error: null }),
      (error) => ({ timedOut: false, error }),
    )
  const result = await Promise.race([settlement, deadline])
  clearTimeout(timeout)
  if (result.timedOut) {
    client.connection?.stream?.destroy()
    throw new Error(`${label}_timed_out`)
  }
  if (result.error) throw result.error
}

export async function closePgClients(clients, options = {}) {
  if (!Array.isArray(clients)) throw new Error("postgres_client_list_invalid")
  if (
    !isRecord(options) ||
    Object.keys(options).some((key) => key !== "force") ||
    (options.force !== undefined && typeof options.force !== "boolean")
  ) {
    throw new Error("postgres_client_close_options_invalid")
  }
  const force = options.force === true
  const uniqueClients = [...new Set(clients.filter(Boolean))]
  const failures = []
  await Promise.all(
    uniqueClients.map(async (client) => {
      if (!force) {
        try {
          await settleClientCleanup(
            client,
            () => client.query("ROLLBACK"),
            "postgres_client_rollback",
          )
        } catch (error) {
          failures.push(error)
        }
      }
      try {
        await settleClientCleanup(
          client,
          () => client.end(),
          force ? "postgres_client_force_end" : "postgres_client_end",
        )
      } catch (error) {
        failures.push(error)
        client.connection?.stream?.destroy()
      }
      clientTransientStates.get(client)?.clients.delete(client)
      clientTransientStates.delete(client)
    }),
  )
  if (failures.length > 0) {
    throw new AggregateError(failures, "postgres_client_close_failed")
  }
}
