import { performance } from "node:perf_hooks"

const DEFAULT_BARRIER_DEADLINE_MILLISECONDS = 5_000
const DEFAULT_SETTLEMENT_DEADLINE_MILLISECONDS = 30_000
const DEFAULT_MAXIMUM_OBSERVATION_QUERIES = 5_000
const IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/
const ALLOWED_VALUE_CASTS = new Set(["bigint", "integer", "text", "uuid"])

const heldLockStates = new WeakMap()

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

function assertConnectedClient(client, label) {
  if (
    !client ||
    typeof client.query !== "function" ||
    !Number.isSafeInteger(client.processID) ||
    client.processID < 1
  ) {
    throw new Error(`${label}_not_connected`)
  }
}

function applicationName(client) {
  const value = client.connectionParameters?.application_name
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("postgres_barrier_application_name_missing")
  }
  return value
}

function normalizeAdvisoryLock(lock) {
  if (typeof lock === "bigint") {
    return {
      kind: "bigint",
      acquireSql: "SELECT pg_catalog.pg_advisory_lock($1::bigint)",
      releaseSql:
        "SELECT pg_catalog.pg_advisory_unlock($1::bigint) AS released",
      parameters: [lock.toString()],
      publicKey: lock.toString(),
    }
  }
  if (Number.isSafeInteger(lock)) {
    return normalizeAdvisoryLock(BigInt(lock))
  }
  if (
    Array.isArray(lock) &&
    lock.length === 2 &&
    lock.every(
      (value) =>
        Number.isSafeInteger(value) &&
        value >= -2_147_483_648 &&
        value <= 2_147_483_647,
    )
  ) {
    return {
      kind: "integer_pair",
      acquireSql:
        "SELECT pg_catalog.pg_advisory_lock($1::integer, $2::integer)",
      releaseSql:
        "SELECT pg_catalog.pg_advisory_unlock($1::integer, $2::integer) AS released",
      parameters: lock,
      publicKey: [...lock],
    }
  }
  if (
    lock &&
    typeof lock === "object" &&
    !Array.isArray(lock) &&
    typeof lock.text === "string" &&
    lock.text.length >= 1 &&
    lock.text.length <= 255 &&
    lock.text === lock.text.trim() &&
    !/[\0\r\n]/.test(lock.text) &&
    Number.isSafeInteger(lock.seed)
  ) {
    return {
      kind: "hashed_text",
      acquireSql:
        "SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended($1::text, $2::bigint))",
      releaseSql:
        "SELECT pg_catalog.pg_advisory_unlock(pg_catalog.hashtextextended($1::text, $2::bigint)) AS released",
      parameters: [lock.text, lock.seed],
      publicKey: Object.freeze({ text: lock.text, seed: lock.seed }),
    }
  }
  throw new Error("postgres_advisory_lock_key_invalid")
}

function createHeldLockHandle(state, publicFields) {
  const handle = Object.freeze(publicFields)
  heldLockStates.set(handle, state)
  return handle
}

function quoteIdentifier(value, label) {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${label}_invalid`)
  }
  return `"${value}"`
}

function reachesBlocker(activityByPid, rootPid, blockerPid) {
  const pending = [rootPid]
  const visited = new Set()
  while (pending.length > 0) {
    const pid = pending.pop()
    if (pid === blockerPid) return true
    if (visited.has(pid)) continue
    visited.add(pid)
    const activity = activityByPid.get(pid)
    if (!activity) continue
    for (const candidate of activity.blocking_pids) pending.push(candidate)
  }
  return false
}

function freezeObservation(row) {
  return Object.freeze({
    pid: row.pid,
    applicationName: row.application_name,
    state: row.state,
    waitEventType: row.wait_event_type,
    waitEvent: row.wait_event,
    blockingPids: Object.freeze([...row.blocking_pids]),
  })
}

export async function holdAdvisoryLock(client, lock) {
  assertConnectedClient(client, "postgres_advisory_lock_client")
  const normalized = normalizeAdvisoryLock(lock)
  await client.query(normalized.acquireSql, normalized.parameters)
  return createHeldLockHandle(
    {
      active: true,
      client,
      releaseSql: normalized.releaseSql,
      parameters: normalized.parameters,
      transactional: false,
    },
    {
      kind: "advisory",
      advisoryKeyKind: normalized.kind,
      advisoryKey: normalized.publicKey,
      backendPid: client.processID,
      applicationName: applicationName(client),
    },
  )
}

export async function holdRowLock(client, options) {
  assertConnectedClient(client, "postgres_row_lock_client")
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new Error("postgres_row_lock_options_invalid")
  }
  const schema = quoteIdentifier(options.schema ?? "public", "row_lock_schema")
  const table = quoteIdentifier(options.table, "row_lock_table")
  const column = quoteIdentifier(options.column ?? "id", "row_lock_column")
  const valueCast = options.valueCast ?? "uuid"
  if (!ALLOWED_VALUE_CASTS.has(valueCast) || options.value === undefined) {
    throw new Error("postgres_row_lock_value_invalid")
  }

  await client.query("BEGIN")
  try {
    const result = await client.query(
      `SELECT ${column}
       FROM ${schema}.${table}
       WHERE ${column} = $1::${valueCast}
       FOR UPDATE`,
      [options.value],
    )
    if (result.rowCount !== 1) {
      throw new Error("postgres_row_lock_target_not_unique")
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined)
    throw error
  }

  return createHeldLockHandle(
    { active: true, client, transactional: true },
    {
      kind: "row",
      backendPid: client.processID,
      applicationName: applicationName(client),
      relation: `${options.schema ?? "public"}.${options.table}`,
      column: options.column ?? "id",
    },
  )
}

export async function waitForClientsBlockedBy(
  observerClient,
  blockedClients,
  blockerClient,
  options = {},
) {
  assertConnectedClient(observerClient, "postgres_barrier_observer")
  assertConnectedClient(blockerClient, "postgres_barrier_blocker")
  if (!Array.isArray(blockedClients) || blockedClients.length === 0) {
    throw new Error("postgres_barrier_blocked_clients_invalid")
  }
  const uniqueClients = [...new Set(blockedClients)]
  if (
    uniqueClients.length !== blockedClients.length ||
    observerClient === blockerClient ||
    uniqueClients.some(
      (client) => client === blockerClient || client === observerClient,
    )
  ) {
    throw new Error("postgres_barrier_blocked_clients_invalid")
  }
  for (const client of uniqueClients) {
    assertConnectedClient(client, "postgres_barrier_blocked_client")
  }

  const deadlineMilliseconds = boundedInteger(
    options.deadlineMilliseconds,
    DEFAULT_BARRIER_DEADLINE_MILLISECONDS,
    100,
    60_000,
    "postgres_barrier_deadline",
  )
  const maximumObservationQueries = boundedInteger(
    options.maximumObservationQueries,
    DEFAULT_MAXIMUM_OBSERVATION_QUERIES,
    1,
    10_000,
    "postgres_barrier_observation_limit",
  )
  const observerIdentity = {
    pid: observerClient.processID,
    applicationName: applicationName(observerClient),
  }
  const blockerIdentity = {
    pid: blockerClient.processID,
    applicationName: applicationName(blockerClient),
  }
  const targetIdentities = uniqueClients.map((client) => ({
    pid: client.processID,
    applicationName: applicationName(client),
  }))
  const allIdentities = [observerIdentity, blockerIdentity, ...targetIdentities]
  if (
    new Set(allIdentities.map(({ pid }) => pid)).size !==
      allIdentities.length ||
    new Set(allIdentities.map(({ applicationName }) => applicationName))
      .size !== allIdentities.length
  ) {
    throw new Error("postgres_barrier_client_identity_not_unique")
  }
  const deadline = performance.now() + deadlineMilliseconds
  let lastTargetObservations = []

  for (
    let observationCount = 1;
    observationCount <= maximumObservationQueries &&
    performance.now() < deadline;
    observationCount += 1
  ) {
    const result = await observerClient.query(
      `SELECT
         activity.pid,
         activity.application_name,
         activity.state,
         activity.wait_event_type,
         activity.wait_event,
         pg_catalog.pg_blocking_pids(activity.pid) AS blocking_pids
       FROM pg_catalog.pg_stat_activity activity`,
    )
    const activityByPid = new Map(
      result.rows.map((row) => [
        row.pid,
        {
          ...row,
          blocking_pids: Array.isArray(row.blocking_pids)
            ? row.blocking_pids
            : [],
        },
      ]),
    )
    lastTargetObservations = targetIdentities.flatMap((identity) => {
      const row = activityByPid.get(identity.pid)
      return row ? [freezeObservation(row)] : []
    })
    const blockerRow = activityByPid.get(blockerIdentity.pid)
    const allBlocked =
      blockerRow?.application_name === blockerIdentity.applicationName &&
      targetIdentities.every((identity) => {
        const row = activityByPid.get(identity.pid)
        return (
          row?.application_name === identity.applicationName &&
          row.wait_event_type === "Lock" &&
          row.blocking_pids.length > 0 &&
          reachesBlocker(activityByPid, identity.pid, blockerIdentity.pid)
        )
      })
    if (allBlocked) return Object.freeze(lastTargetObservations)
    await new Promise(setImmediate)
  }

  const error = new Error("postgres_barrier_not_observed")
  error.observations = Object.freeze(lastTargetObservations)
  error.blocker = Object.freeze({
    pid: blockerClient.processID,
    applicationName: applicationName(blockerClient),
  })
  throw error
}

export async function releaseHeldLock(handle, options = {}) {
  const state = heldLockStates.get(handle)
  if (!state) throw new Error("postgres_held_lock_unknown")
  if (!state.active) return false

  if (state.transactional) {
    const commit = options.commit !== false
    try {
      await state.client.query(commit ? "COMMIT" : "ROLLBACK")
    } catch (error) {
      await state.client.query("ROLLBACK").catch(() => undefined)
      throw error
    } finally {
      state.active = false
    }
    return true
  }

  const result = await state.client.query(state.releaseSql, state.parameters)
  if (result.rowCount !== 1 || result.rows[0]?.released !== true) {
    throw new Error("postgres_advisory_lock_release_failed")
  }
  state.active = false
  return true
}

export async function settleConcurrent(tasks, options = {}) {
  if (
    !Array.isArray(tasks) ||
    tasks.length < 2 ||
    tasks.some((task) => typeof task !== "function")
  ) {
    throw new Error("postgres_concurrent_tasks_invalid")
  }
  const deadlineMilliseconds = boundedInteger(
    options.deadlineMilliseconds,
    DEFAULT_SETTLEMENT_DEADLINE_MILLISECONDS,
    100,
    120_000,
    "postgres_concurrent_settlement_deadline",
  )

  let timeout
  const deadline = new Promise((resolveDeadline) => {
    timeout = setTimeout(
      () => resolveDeadline({ timedOut: true }),
      deadlineMilliseconds,
    )
  })
  const settlement = Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(task)),
  ).then((results) => ({ timedOut: false, results }))
  const result = await Promise.race([settlement, deadline])
  clearTimeout(timeout)
  if (result.timedOut) throw new Error("postgres_concurrent_tasks_timed_out")
  return Object.freeze(result.results)
}
