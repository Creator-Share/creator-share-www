import { spawnSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { relative, resolve } from "node:path"

import { discoverLocalSupabase } from "./local-supabase.mjs"

// Matches the database helper's discovery budget; see the note there.
const DISCOVERY_TIMEOUT_MILLISECONDS = 30_000
const MIGRATION_ORACLE_TIMEOUT_MILLISECONDS = 60_000
const MAXIMUM_PROCESS_OUTPUT_BYTES = 1024 * 1024
const MAXIMUM_RESPONSE_BYTES = 64 * 1024
const MAXIMUM_KEY_BYTES = 4096
const MIGRATION_FILE_PATTERN = /^[0-9]{14}_[a-z0-9_-]+\.sql$/
const SHA_REVISION_PATTERN = /^[0-9a-f]{40}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]{0,63})?$/
const OPAQUE_KEY_PATTERN = /^sb_(?:publishable|secret)_[A-Za-z0-9_-]{20,512}$/
const POSTGRES_DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
const POSTGRES_CONTAINER_NAME_PATTERN = /^supabase_db_[A-Za-z0-9_.-]+$/
const MIGRATION_ORACLE_DATABASE_NAME_PATTERN = /^advpg_[0-9a-f]{24}$/
const COMPONENT_IMAGE_PATTERNS = Object.freeze({
  gateway:
    /^public\.ecr\.aws\/supabase\/kong:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  auth: /^public\.ecr\.aws\/supabase\/gotrue:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  postgrest:
    /^public\.ecr\.aws\/supabase\/postgrest:[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  database: /^public\.ecr\.aws\/supabase\/postgres:[0-9][A-Za-z0-9._-]{0,127}$/,
})
const LOOPBACK_HTTP_HOST = "127.0.0.1"
const LOOPBACK_DATABASE_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
])
const MIGRATION_LEDGER_DIGEST_SQL = `
SELECT
  count(*)::text,
  encode(
    extensions.digest(
      convert_to(
        coalesce(
          jsonb_agg(
            jsonb_build_array(version, coalesce(name, ''), statements)
            ORDER BY version
          )::text,
          'null'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
FROM supabase_migrations.schema_migrations
`

function fixedError(code, cause) {
  return cause === undefined ? new Error(code) : new Error(code, { cause })
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseJson(value, code) {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw fixedError(code, error)
  }
}

function requiredString(record, key, code) {
  const value = record[key]
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAXIMUM_KEY_BYTES ||
    !/^[\x21-\x7e]+$/.test(value)
  ) {
    throw fixedError(code)
  }
  return value
}

function runBoundedProcess(executable, args, options) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: MAXIMUM_PROCESS_OUTPUT_BYTES,
    timeout: options.timeoutMilliseconds ?? DISCOVERY_TIMEOUT_MILLISECONDS,
    ...(options.environment === undefined ? {} : { env: options.environment }),
  })
  if (result.error || result.status !== 0) {
    throw fixedError(options.code, result.error)
  }
  return result.stdout
}

function requireLoopbackHttpUrl(value, expectedPath, code) {
  let url
  try {
    url = new URL(value)
  } catch (error) {
    throw fixedError(code, error)
  }
  const port = Number(url.port)
  if (
    url.protocol !== "http:" ||
    url.hostname !== LOOPBACK_HTTP_HOST ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== expectedPath ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw fixedError(code)
  }
  return url
}

function decodeJwtClaims(value, expectedRole, code) {
  const segments = value.split(".")
  if (
    segments.length !== 3 ||
    segments.some((segment) => segment.length === 0)
  ) {
    throw fixedError(code)
  }
  const claims = parseJson(
    Buffer.from(segments[1], "base64url").toString("utf8"),
    code,
  )
  if (!isRecord(claims) || claims.role !== expectedRole) {
    throw fixedError(code)
  }
}

function readComponentImages(workspace, projectId) {
  const output = runBoundedProcess(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectId}`,
      "--filter",
      "status=running",
      "--format",
      "{{.Names}}\t{{.Image}}",
    ],
    {
      cwd: workspace,
      code: "local_supabase_http_component_discovery_failed",
    },
  )
  const entries = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"))
  if (
    entries.length === 0 ||
    entries.some(
      (entry) =>
        entry.length !== 2 ||
        entry.some((value) => value.length === 0 || value.length > 255),
    )
  ) {
    throw fixedError("local_supabase_http_component_discovery_invalid")
  }
  const imagesByName = new Map(entries)
  const componentNames = {
    gateway: `supabase_kong_${projectId}`,
    auth: `supabase_auth_${projectId}`,
    postgrest: `supabase_rest_${projectId}`,
    database: `supabase_db_${projectId}`,
  }
  const components = {}
  for (const [component, name] of Object.entries(componentNames)) {
    const image = imagesByName.get(name)
    if (
      typeof image !== "string" ||
      !COMPONENT_IMAGE_PATTERNS[component].test(image)
    ) {
      throw fixedError(`local_supabase_http_${component}_image_invalid`)
    }
    components[component] = image
  }
  return Object.freeze(components)
}

function readPostgresqlMajorVersion(database) {
  const output = runBoundedProcess(
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
      "SELECT current_setting('server_version_num')",
    ],
    {
      cwd: database.workspace,
      code: "local_supabase_http_postgresql_version_read_failed",
    },
  ).trim()
  if (!/^[0-9]{6}$/.test(output)) {
    throw fixedError("local_supabase_http_postgresql_version_invalid")
  }
  const version = Number(output)
  const major = Math.trunc(version / 10_000)
  if (!Number.isSafeInteger(major) || major < 1) {
    throw fixedError("local_supabase_http_postgresql_version_invalid")
  }
  return major
}

function decodeUrlComponent(value, code) {
  try {
    return decodeURIComponent(value)
  } catch (error) {
    throw fixedError(code, error)
  }
}

function requireLocalDatabaseDescriptor(database) {
  if (
    !isRecord(database) ||
    typeof database.workspace !== "string" ||
    typeof database.containerName !== "string" ||
    !POSTGRES_CONTAINER_NAME_PATTERN.test(database.containerName) ||
    typeof database.sourceDatabaseName !== "string" ||
    !POSTGRES_DATABASE_NAME_PATTERN.test(database.sourceDatabaseName) ||
    !Number.isSafeInteger(database.databasePort) ||
    database.databasePort < 1 ||
    database.databasePort > 65_535 ||
    typeof database.sourceConnectionString !== "string" ||
    database.sourceConnectionString.length > 8192
  ) {
    throw fixedError("local_supabase_http_database_descriptor_invalid")
  }
  let url
  try {
    url = new URL(database.sourceConnectionString)
  } catch (error) {
    throw fixedError("local_supabase_http_database_connection_invalid", error)
  }
  const username = decodeUrlComponent(
    url.username,
    "local_supabase_http_database_connection_invalid",
  )
  const password = decodeUrlComponent(
    url.password,
    "local_supabase_http_database_connection_invalid",
  )
  const databaseName = decodeUrlComponent(
    url.pathname.slice(1),
    "local_supabase_http_database_connection_invalid",
  )
  const port = Number(url.port)
  if (
    (url.protocol !== "postgresql:" && url.protocol !== "postgres:") ||
    !LOOPBACK_DATABASE_HOSTS.has(url.hostname) ||
    username !== "postgres" ||
    password.length === 0 ||
    password.length > MAXIMUM_KEY_BYTES ||
    password.includes("\0") ||
    databaseName !== database.sourceDatabaseName ||
    port !== database.databasePort ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw fixedError("local_supabase_http_database_connection_invalid")
  }
  return Object.freeze({
    workspace: resolve(database.workspace),
    containerName: database.containerName,
    sourceDatabaseName: database.sourceDatabaseName,
    databasePort: database.databasePort,
    sourceConnectionString: url.toString(),
    password,
  })
}

function runContainerPsql(database, databaseName, sql, code) {
  if (!POSTGRES_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw fixedError(code)
  }
  return runBoundedProcess(
    "docker",
    [
      "exec",
      database.containerName,
      "psql",
      "-X",
      "-A",
      "-t",
      "-F",
      "|",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      databaseName,
      "-c",
      sql,
    ],
    {
      cwd: database.workspace,
      code,
    },
  )
}

function oracleDatabaseExists(database, oracleDatabaseName) {
  if (!MIGRATION_ORACLE_DATABASE_NAME_PATTERN.test(oracleDatabaseName)) {
    throw fixedError("local_supabase_http_migration_oracle_name_invalid")
  }
  const output = runContainerPsql(
    database,
    database.sourceDatabaseName,
    `SELECT count(*) FROM pg_database WHERE datname = '${oracleDatabaseName}'`,
    "local_supabase_http_migration_oracle_absence_read_failed",
  ).trim()
  if (output !== "0" && output !== "1") {
    throw fixedError("local_supabase_http_migration_oracle_absence_invalid")
  }
  return output === "1"
}

function forceDropOracleDatabase(database, oracleDatabaseName) {
  const failures = []
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      runBoundedProcess(
        "docker",
        [
          "exec",
          database.containerName,
          "dropdb",
          "-U",
          "postgres",
          "--if-exists",
          "--force",
          oracleDatabaseName,
        ],
        {
          cwd: database.workspace,
          code: "local_supabase_http_migration_oracle_drop_failed",
        },
      )
    } catch (error) {
      failures.push(error)
    }
    try {
      if (!oracleDatabaseExists(database, oracleDatabaseName)) return
      failures.push(
        fixedError("local_supabase_http_migration_oracle_still_exists"),
      )
    } catch (error) {
      failures.push(error)
    }
  }
  throw fixedError(
    "local_supabase_http_migration_oracle_cleanup_failed",
    new AggregateError(
      failures,
      "local_supabase_http_migration_oracle_cleanup_failed",
    ),
  )
}

function readMigrationLedgerDigest(database, databaseName) {
  const output = runContainerPsql(
    database,
    databaseName,
    MIGRATION_LEDGER_DIGEST_SQL,
    "local_supabase_http_migration_ledger_read_failed",
  ).trim()
  const fields = output.split("|")
  if (
    fields.length !== 2 ||
    !/^[1-9][0-9]{0,5}$/.test(fields[0]) ||
    !SHA256_PATTERN.test(fields[1])
  ) {
    throw fixedError("local_supabase_http_migration_ledger_invalid")
  }
  const count = Number(fields[0])
  if (!Number.isSafeInteger(count)) {
    throw fixedError("local_supabase_http_migration_ledger_invalid")
  }
  return Object.freeze({ count, sha256: fields[1] })
}

function verifyAppliedMigrationLedger(databaseInput, expectedMigrationCount) {
  if (
    !Number.isSafeInteger(expectedMigrationCount) ||
    expectedMigrationCount < 1 ||
    expectedMigrationCount > 100_000
  ) {
    throw fixedError("local_supabase_http_migration_ledger_count_invalid")
  }
  const database = requireLocalDatabaseDescriptor(databaseInput)
  const oracleDatabaseName = `advpg_${randomBytes(12).toString("hex")}`
  if (!MIGRATION_ORACLE_DATABASE_NAME_PATTERN.test(oracleDatabaseName)) {
    throw fixedError("local_supabase_http_migration_oracle_name_invalid")
  }
  if (oracleDatabaseExists(database, oracleDatabaseName)) {
    throw fixedError("local_supabase_http_migration_oracle_name_collision")
  }

  const oracleUrl = new URL(database.sourceConnectionString)
  oracleUrl.hostname = LOOPBACK_HTTP_HOST
  oracleUrl.username = "postgres"
  oracleUrl.password = ""
  oracleUrl.pathname = `/${oracleDatabaseName}`
  if (
    oracleUrl.hostname !== LOOPBACK_HTTP_HOST ||
    oracleUrl.username !== "postgres" ||
    oracleUrl.password.length !== 0 ||
    Number(oracleUrl.port) !== database.databasePort ||
    oracleUrl.pathname !== `/${oracleDatabaseName}` ||
    oracleUrl.search.length > 0 ||
    oracleUrl.hash.length > 0
  ) {
    throw fixedError("local_supabase_http_migration_oracle_url_invalid")
  }

  let operationError
  let cleanupError
  let appliedMigrationLedgerSha256
  let creationAttempted = false
  try {
    creationAttempted = true
    runBoundedProcess(
      "docker",
      [
        "exec",
        database.containerName,
        "createdb",
        "-U",
        "postgres",
        "-T",
        "template0",
        oracleDatabaseName,
      ],
      {
        cwd: database.workspace,
        code: "local_supabase_http_migration_oracle_create_failed",
      },
    )
    runBoundedProcess(
      resolve(database.workspace, "node_modules/.bin/supabase"),
      [
        "migration",
        "repair",
        "--db-url",
        oracleUrl.href,
        "--status",
        "applied",
        "--yes",
      ],
      {
        cwd: database.workspace,
        timeoutMilliseconds: MIGRATION_ORACLE_TIMEOUT_MILLISECONDS,
        environment: { ...process.env, PGPASSWORD: database.password },
        code: "local_supabase_http_migration_oracle_repair_failed",
      },
    )
    runContainerPsql(
      database,
      oracleDatabaseName,
      `CREATE SCHEMA IF NOT EXISTS extensions;
       CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions`,
      "local_supabase_http_migration_oracle_digest_setup_failed",
    )
    const oracleLedger = readMigrationLedgerDigest(database, oracleDatabaseName)
    const sourceLedger = readMigrationLedgerDigest(
      database,
      database.sourceDatabaseName,
    )
    if (
      sourceLedger.count !== expectedMigrationCount ||
      oracleLedger.count !== expectedMigrationCount ||
      sourceLedger.sha256 !== oracleLedger.sha256
    ) {
      throw fixedError("local_supabase_http_migration_ledger_mismatch")
    }
    appliedMigrationLedgerSha256 = sourceLedger.sha256
  } catch (error) {
    operationError = error
  } finally {
    if (creationAttempted) {
      try {
        forceDropOracleDatabase(database, oracleDatabaseName)
      } catch (error) {
        cleanupError = error
      }
    }
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "local_supabase_http_migration_oracle_and_cleanup_failed",
    )
  }
  if (cleanupError) throw cleanupError
  if (operationError) throw operationError
  if (!SHA256_PATTERN.test(appliedMigrationLedgerSha256 ?? "")) {
    throw fixedError("local_supabase_http_migration_ledger_invalid")
  }
  return appliedMigrationLedgerSha256
}

async function readPackageVersion(workspace, packagePath, packageName, code) {
  let metadata
  try {
    metadata = parseJson(
      await readFile(resolve(workspace, packagePath), "utf8"),
      code,
    )
  } catch (error) {
    if (error?.message === code) throw error
    throw fixedError(code, error)
  }
  if (
    !isRecord(metadata) ||
    metadata.name !== packageName ||
    typeof metadata.version !== "string" ||
    !VERSION_PATTERN.test(metadata.version)
  ) {
    throw fixedError(code)
  }
  return metadata.version
}

export async function discoverLocalSupabaseHttp(options = {}) {
  const workspace = resolve(options.workspace ?? process.cwd())
  const database = await discoverLocalSupabase({
    workspace,
    timeoutMilliseconds:
      options.timeoutMilliseconds ?? DISCOVERY_TIMEOUT_MILLISECONDS,
  })
  const executable = resolve(workspace, "node_modules/.bin/supabase")
  const status = parseJson(
    runBoundedProcess(executable, ["status", "-o", "json"], {
      cwd: workspace,
      timeoutMilliseconds:
        options.timeoutMilliseconds ?? DISCOVERY_TIMEOUT_MILLISECONDS,
      code: "local_supabase_http_status_failed",
    }),
    "local_supabase_http_status_invalid_json",
  )
  if (!isRecord(status)) {
    throw fixedError("local_supabase_http_status_invalid")
  }

  const apiUrl = requireLoopbackHttpUrl(
    requiredString(status, "API_URL", "local_supabase_http_api_url_missing"),
    "/",
    "local_supabase_http_api_url_invalid",
  )
  const restUrl = requireLoopbackHttpUrl(
    requiredString(status, "REST_URL", "local_supabase_http_rest_url_missing"),
    "/rest/v1",
    "local_supabase_http_rest_url_invalid",
  )
  if (apiUrl.origin !== restUrl.origin) {
    throw fixedError("local_supabase_http_origin_mismatch")
  }

  const legacyAnonKey = requiredString(
    status,
    "ANON_KEY",
    "local_supabase_http_anon_key_invalid",
  )
  const legacyServiceRoleKey = requiredString(
    status,
    "SERVICE_ROLE_KEY",
    "local_supabase_http_service_role_key_invalid",
  )
  const publishableKey = requiredString(
    status,
    "PUBLISHABLE_KEY",
    "local_supabase_http_publishable_key_invalid",
  )
  const secretKey = requiredString(
    status,
    "SECRET_KEY",
    "local_supabase_http_secret_key_invalid",
  )
  decodeJwtClaims(legacyAnonKey, "anon", "local_supabase_http_anon_key_invalid")
  decodeJwtClaims(
    legacyServiceRoleKey,
    "service_role",
    "local_supabase_http_service_role_key_invalid",
  )
  if (
    !OPAQUE_KEY_PATTERN.test(publishableKey) ||
    !publishableKey.startsWith("sb_publishable_")
  ) {
    throw fixedError("local_supabase_http_publishable_key_invalid")
  }
  if (
    !OPAQUE_KEY_PATTERN.test(secretKey) ||
    !secretKey.startsWith("sb_secret_")
  ) {
    throw fixedError("local_supabase_http_secret_key_invalid")
  }
  if (
    new Set([legacyAnonKey, legacyServiceRoleKey, publishableKey, secretKey])
      .size !== 4
  ) {
    throw fixedError("local_supabase_http_keys_not_distinct")
  }

  const [cliVersion, supabaseJsVersion, components, postgresqlMajorVersion] =
    await Promise.all([
      readPackageVersion(
        workspace,
        "node_modules/supabase/package.json",
        "supabase",
        "local_supabase_http_cli_metadata_invalid",
      ),
      readPackageVersion(
        workspace,
        "node_modules/@supabase/supabase-js/package.json",
        "@supabase/supabase-js",
        "local_supabase_http_sdk_metadata_invalid",
      ),
      readComponentImages(workspace, database.projectId),
      readPostgresqlMajorVersion(database),
    ])
  const imagePostgresqlMajorVersion = Number(
    /^public\.ecr\.aws\/supabase\/postgres:([0-9]+)\./.exec(
      components.database,
    )?.[1],
  )
  if (
    !Number.isSafeInteger(imagePostgresqlMajorVersion) ||
    imagePostgresqlMajorVersion !== postgresqlMajorVersion
  ) {
    throw fixedError("local_supabase_http_postgresql_version_mismatch")
  }
  return Object.freeze({
    workspace,
    apiOrigin: apiUrl.origin,
    restRoot: restUrl.href,
    legacyAnonKey,
    legacyServiceRoleKey,
    publishableKey,
    secretKey,
    projectId: database.projectId,
    sourceAppliedMigrationVersions: database.sourceAppliedMigrationVersions,
    database,
    versions: Object.freeze({
      supabaseCli: cliVersion,
      supabaseJs: supabaseJsVersion,
      gatewayImage: components.gateway,
      authImage: components.auth,
      postgrestImage: components.postgrest,
      databaseImage: components.database,
      postgresqlMajor: postgresqlMajorVersion,
    }),
  })
}

function resolveWorkspaceFile(workspace, path, code) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\0") ||
    path.startsWith("/")
  ) {
    throw fixedError(code)
  }
  const absolute = resolve(workspace, path)
  const workspaceRelative = relative(workspace, absolute)
  if (
    workspaceRelative.length === 0 ||
    workspaceRelative.startsWith("..") ||
    workspaceRelative.startsWith("/")
  ) {
    throw fixedError(code)
  }
  return { absolute, relative: workspaceRelative }
}

async function hashFiles(workspace, paths, code) {
  if (
    !Array.isArray(paths) ||
    paths.length === 0 ||
    paths.some((path) => typeof path !== "string")
  ) {
    throw fixedError(code)
  }
  const files = paths
    .map((path) => resolveWorkspaceFile(workspace, path, code))
    .sort((left, right) => left.relative.localeCompare(right.relative))
  if (new Set(files.map((file) => file.relative)).size !== files.length) {
    throw fixedError(code)
  }
  const digest = createHash("sha256")
  for (const file of files) {
    let contents
    try {
      contents = await readFile(file.absolute)
    } catch (error) {
      throw fixedError(code, error)
    }
    digest.update(file.relative, "utf8")
    digest.update("\0", "utf8")
    digest.update(contents)
    digest.update("\0", "utf8")
  }
  return digest.digest("hex")
}

export async function loadLocalSupabaseHttpProvenance(stack, options = {}) {
  if (
    !isRecord(stack) ||
    typeof stack.workspace !== "string" ||
    !Array.isArray(stack.sourceAppliedMigrationVersions) ||
    !isRecord(stack.database) ||
    !isRecord(stack.versions)
  ) {
    throw fixedError("local_supabase_http_provenance_input_invalid")
  }
  const workspace = resolve(stack.workspace)
  const migrationDirectory = resolve(workspace, "supabase/migrations")
  let migrationFiles
  try {
    migrationFiles = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort()
  } catch (error) {
    throw fixedError("local_supabase_http_migration_set_invalid", error)
  }
  if (
    migrationFiles.length === 0 ||
    migrationFiles.some((file) => !MIGRATION_FILE_PATTERN.test(file))
  ) {
    throw fixedError("local_supabase_http_migration_set_invalid")
  }
  const expectedVersions = migrationFiles.map((file) => file.slice(0, 14))
  if (
    new Set(expectedVersions).size !== expectedVersions.length ||
    expectedVersions.length !== stack.sourceAppliedMigrationVersions.length ||
    expectedVersions.some(
      (version, index) =>
        version !== stack.sourceAppliedMigrationVersions[index],
    )
  ) {
    throw fixedError("local_supabase_http_migration_set_mismatch")
  }
  const migrationSetSha256 = await hashFiles(
    workspace,
    migrationFiles.map((file) => `supabase/migrations/${file}`),
    "local_supabase_http_migration_digest_failed",
  )
  const harnessSha256 = await hashFiles(
    workspace,
    options.harnessPaths,
    "local_supabase_http_harness_digest_failed",
  )
  const compatibilityTestSha256 = await hashFiles(
    workspace,
    [options.compatibilityTestPath],
    "local_supabase_http_compatibility_digest_failed",
  )
  const sourceRevision = runBoundedProcess("git", ["rev-parse", "HEAD"], {
    cwd: workspace,
    code: "local_supabase_http_source_revision_failed",
  }).trim()
  if (!SHA_REVISION_PATTERN.test(sourceRevision)) {
    throw fixedError("local_supabase_http_source_revision_invalid")
  }
  if (
    options.expectedSourceRevision !== undefined &&
    options.expectedSourceRevision !== sourceRevision
  ) {
    throw fixedError("local_supabase_http_source_revision_mismatch")
  }
  if (options.requireCleanCheckout === true) {
    const workingTreeStatus = runBoundedProcess(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=all"],
      {
        cwd: workspace,
        code: "local_supabase_http_working_tree_status_failed",
      },
    )
    if (workingTreeStatus.trim().length > 0) {
      throw fixedError("local_supabase_http_working_tree_not_clean")
    }
  }
  const appliedMigrationLedgerSha256 = verifyAppliedMigrationLedger(
    stack.database,
    migrationFiles.length,
  )
  const migrationSetAfterOracleSha256 = await hashFiles(
    workspace,
    migrationFiles.map((file) => `supabase/migrations/${file}`),
    "local_supabase_http_migration_digest_failed",
  )
  if (
    !SHA256_PATTERN.test(migrationSetSha256) ||
    migrationSetAfterOracleSha256 !== migrationSetSha256 ||
    !SHA256_PATTERN.test(appliedMigrationLedgerSha256) ||
    !SHA256_PATTERN.test(harnessSha256) ||
    !SHA256_PATTERN.test(compatibilityTestSha256)
  ) {
    throw fixedError("local_supabase_http_provenance_digest_invalid")
  }
  return Object.freeze({
    sourceRevision,
    migrationBoundary: migrationFiles.at(-1).replace(/\.sql$/, ""),
    migrationSetSha256,
    appliedMigrationLedgerSha256,
    harnessSha256,
    compatibilityTestSha256,
    versions: stack.versions,
  })
}

function requirePositiveInteger(value, fallback, minimum, maximum, code) {
  const candidate = value ?? fallback
  if (
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw fixedError(code)
  }
  return candidate
}

async function consumeBoundedResponse(response, maximumBytes) {
  const declaredLength = response.headers.get("content-length")
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength)
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 0 ||
      parsedLength > maximumBytes
    ) {
      await response.body?.cancel().catch(() => undefined)
      throw fixedError("local_supabase_http_response_too_large")
    }
  }
  if (response.body === null) {
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
  const reader = response.body.getReader()
  const chunks = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maximumBytes) {
        await reader.cancel().catch(() => undefined)
        throw fixedError("local_supabase_http_response_too_large")
      }
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error?.message === "local_supabase_http_response_too_large") {
      throw error
    }
    throw fixedError("local_supabase_http_response_read_failed", error)
  } finally {
    reader.releaseLock()
  }
  const statusForbidsBody = [101, 204, 205, 304].includes(response.status)
  return new Response(
    statusForbidsBody ? null : Buffer.concat(chunks, length),
    {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    },
  )
}

export function createBoundedLocalSupabaseFetch(options = {}) {
  const allowedOrigin = requireLoopbackHttpUrl(
    `${options.allowedOrigin ?? ""}/`,
    "/",
    "local_supabase_http_fetch_origin_invalid",
  ).origin
  const allowedPathPrefixes = options.allowedPathPrefixes
  if (
    !Array.isArray(allowedPathPrefixes) ||
    allowedPathPrefixes.length === 0 ||
    allowedPathPrefixes.some(
      (prefix) =>
        typeof prefix !== "string" ||
        !prefix.startsWith("/") ||
        prefix.includes("\0") ||
        prefix.includes("?") ||
        prefix.includes("#"),
    )
  ) {
    throw fixedError("local_supabase_http_fetch_path_scope_invalid")
  }
  const requestTimeoutMilliseconds = requirePositiveInteger(
    options.requestTimeoutMilliseconds,
    5_000,
    250,
    30_000,
    "local_supabase_http_fetch_timeout_invalid",
  )
  const maximumResponseBytes = requirePositiveInteger(
    options.maximumResponseBytes,
    MAXIMUM_RESPONSE_BYTES,
    1024,
    MAXIMUM_RESPONSE_BYTES,
    "local_supabase_http_response_limit_invalid",
  )
  if (
    typeof options.getAbsoluteDeadline !== "function" ||
    typeof options.getSignal !== "function" ||
    typeof globalThis.fetch !== "function"
  ) {
    throw fixedError("local_supabase_http_fetch_configuration_invalid")
  }

  return async function boundedLocalSupabaseFetch(input, init = {}) {
    let url
    try {
      url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      )
    } catch (error) {
      throw fixedError("local_supabase_http_request_url_invalid", error)
    }
    if (
      url.origin !== allowedOrigin ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      !allowedPathPrefixes.some((prefix) => url.pathname.startsWith(prefix))
    ) {
      throw fixedError("local_supabase_http_request_out_of_scope")
    }
    const absoluteDeadline = options.getAbsoluteDeadline()
    const remaining = absoluteDeadline - Date.now()
    if (!Number.isSafeInteger(absoluteDeadline) || remaining <= 0) {
      throw fixedError("local_supabase_http_execution_deadline_exhausted")
    }
    const controller = new AbortController()
    const signals = [
      options.getSignal(),
      init.signal,
      typeof input === "object" && input !== null ? input.signal : undefined,
    ].filter((signal) => signal instanceof AbortSignal)
    const abort = () => controller.abort()
    for (const signal of signals) {
      if (signal.aborted) controller.abort()
      else signal.addEventListener("abort", abort, { once: true })
    }
    const timer = setTimeout(
      abort,
      Math.min(requestTimeoutMilliseconds, remaining),
    )
    let response
    try {
      response = await globalThis.fetch(input, {
        ...init,
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      })
      if (response.url.length > 0) {
        const responseUrl = new URL(response.url)
        if (responseUrl.origin !== allowedOrigin) {
          await response.body?.cancel().catch(() => undefined)
          throw fixedError("local_supabase_http_response_origin_mismatch")
        }
      }
      return await consumeBoundedResponse(response, maximumResponseBytes)
    } catch (error) {
      if (
        typeof error?.message === "string" &&
        error.message.startsWith("local_supabase_http_")
      ) {
        throw error
      }
      throw fixedError("local_supabase_http_request_failed", error)
    } finally {
      clearTimeout(timer)
      for (const signal of signals) {
        signal.removeEventListener("abort", abort)
      }
    }
  }
}
