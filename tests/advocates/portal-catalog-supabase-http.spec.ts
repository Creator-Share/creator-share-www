import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { expect, test, type Page } from "@playwright/test"

const RUN_LOCAL_INTEGRATION =
  process.env.RUN_LOCAL_SUPABASE_HTTP_INTEGRATION === "1"
const WORKSPACE = process.cwd()
const SUPABASE_EXECUTABLE = resolve(WORKSPACE, "node_modules/.bin/supabase")
const NEXT_EXECUTABLE = resolve(WORKSPACE, "node_modules/next/dist/bin/next")
const OWNER_ROLE_ID = "00000000-0000-4000-8000-000000000001"
const BRAND_EDITOR_ROLE_ID = "00000000-0000-4000-8000-000000000003"
const CATALOG_CURATOR_ROLE_ID = "00000000-0000-4000-8000-000000000004"
const FIXTURE_PREFIX = "catalog-http-"
const FORBIDDEN_RESPONSE_KEY =
  /(?:sponsor|email|phone|contact|customer|subscription|payment|donor)/i
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

interface LocalSupabaseStack {
  apiUrl: string
  restUrl: string
  anonKey: string
  serviceRoleKey: string
  databaseContainer: string
}

interface AuthUserFixture {
  id: string
  email: string
  password: string
}

interface CatalogHttpFixture {
  runId: string
  advocateAId: string
  advocateBId: string
  advocateASlug: string
  advocateBSlug: string
  advocateAName: string
  advocateBName: string
  childAlphaId: string
  childBetaId: string
  childAlphaName: string
  childBetaName: string
  privateContactMarker: string
  users: {
    ownerA: AuthUserFixture
    curatorA: AuthUserFixture
    brandA: AuthUserFixture
    ownerB: AuthUserFixture
  }
}

interface CatalogReadResponse {
  advocate_version: number
  beneficiary_mode: "all" | "all_featured" | "selected"
  beneficiary_selections: Array<{
    beneficiary_id: string
    is_featured: boolean
  }>
  beneficiaries: Array<Record<string, unknown>>
  selection_limit: number
}

let stack: LocalSupabaseStack
let fixture: CatalogHttpFixture | null = null
let appProcess: ChildProcessWithoutNullStreams | null = null
let appDirectory: string | null = null
let appOrigin = ""
let appOutput = ""

// Served by `next dev`, so the first interaction with a not-yet-compiled route
// pays the compile cost inside the test. A shared CI runner is slow enough for
// that to exceed the 30 second default.
test.describe.configure({ mode: "serial", timeout: 120_000 })

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}_not_an_object`)
  }
  return value as Record<string, unknown>
}

function requireString(
  value: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const candidate = value[key]
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`${label}_${key}_missing`)
  }
  return candidate
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`${label}_invalid_json`, { cause: error })
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function uuidLiteral(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error("fixture_uuid_invalid")
  return `${sqlLiteral(value)}::uuid`
}

function executeSql(sql: string): string {
  const result = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      stack.databaseContainer,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-At",
      "-f",
      "-",
    ],
    {
      cwd: WORKSPACE,
      encoding: "utf8",
      input: sql,
      maxBuffer: 8 * 1024 * 1024,
    },
  )
  if (result.status !== 0) {
    throw new Error(
      `local_catalog_fixture_sql_failed\n${result.stderr || result.stdout}`,
    )
  }
  return result.stdout.trim()
}

async function readLocalSupabaseStack(): Promise<LocalSupabaseStack> {
  const status = spawnSync(SUPABASE_EXECUTABLE, ["status", "-o", "json"], {
    cwd: WORKSPACE,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  })
  if (status.status !== 0) {
    throw new Error(`local_supabase_unavailable\n${status.stderr}`)
  }
  const payload = assertRecord(
    parseJson(status.stdout, "local_supabase_status"),
    "local_supabase_status",
  )
  const apiUrl = requireString(payload, "API_URL", "local_supabase_status")
  const restUrl = requireString(payload, "REST_URL", "local_supabase_status")
  const anonKey = requireString(payload, "ANON_KEY", "local_supabase_status")
  const serviceRoleKey = requireString(
    payload,
    "SERVICE_ROLE_KEY",
    "local_supabase_status",
  )
  for (const rawUrl of [apiUrl, restUrl]) {
    const url = new URL(rawUrl)
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    ) {
      throw new Error("catalog_integration_requires_loopback_supabase")
    }
  }

  const config = await readFile(
    resolve(WORKSPACE, "supabase/config.toml"),
    "utf8",
  )
  const projectId = /^project_id\s*=\s*"([a-zA-Z0-9_.-]+)"$/m.exec(config)?.[1]
  if (!projectId) throw new Error("local_supabase_project_id_missing")
  const containers = spawnSync(
    "docker",
    [
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${projectId}`,
      "--filter",
      "name=supabase_db_",
      "--format",
      "{{.Names}}",
    ],
    { cwd: WORKSPACE, encoding: "utf8" },
  )
  if (containers.status !== 0) {
    throw new Error(
      `local_supabase_database_lookup_failed\n${containers.stderr}`,
    )
  }
  const names = containers.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean)
  if (names.length !== 1 || !/^supabase_db_[a-zA-Z0-9_.-]+$/.test(names[0])) {
    throw new Error("local_supabase_database_container_ambiguous")
  }

  return {
    apiUrl,
    restUrl,
    anonKey,
    serviceRoleKey,
    databaseContainer: names[0],
  }
}

async function authAdminRequest(
  input: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${stack.apiUrl}/auth/v1${input}`, {
    ...init,
    headers: {
      apikey: stack.serviceRoleKey,
      Authorization: `Bearer ${stack.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
}

async function deleteAuthUser(userId: string): Promise<void> {
  if (!UUID_PATTERN.test(userId)) return
  const response = await authAdminRequest(`/admin/users/${userId}`, {
    method: "DELETE",
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`local_auth_user_delete_failed_${response.status}`)
  }
}

async function deleteStaleAuthUsers(): Promise<void> {
  const response = await authAdminRequest("/admin/users?page=1&per_page=1000", {
    method: "GET",
  })
  if (!response.ok) {
    throw new Error(`local_auth_user_list_failed_${response.status}`)
  }
  const body = assertRecord(
    parseJson(await response.text(), "local_auth_user_list"),
    "local_auth_user_list",
  )
  if (!Array.isArray(body.users)) {
    throw new Error("local_auth_user_list_shape_invalid")
  }
  const staleIds = body.users.flatMap((candidate) => {
    const user = assertRecord(candidate, "local_auth_user")
    const id = user.id
    const email = user.email
    return typeof id === "string" &&
      UUID_PATTERN.test(id) &&
      typeof email === "string" &&
      email.startsWith(FIXTURE_PREFIX) &&
      email.endsWith("@example.test")
      ? [id]
      : []
  })
  for (const id of staleIds) await deleteAuthUser(id)
}

async function createAuthUser(
  runId: string,
  label: string,
): Promise<AuthUserFixture> {
  const email = `${FIXTURE_PREFIX}${runId}-${label}@example.test`
  const password = `CatalogHttp!${runId}Aa1`
  const response = await authAdminRequest("/admin/users", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Catalog", last_name: label },
    }),
  })
  if (!response.ok) {
    throw new Error(`local_auth_user_create_failed_${response.status}`)
  }
  const body = assertRecord(
    parseJson(await response.text(), "local_auth_user_create"),
    "local_auth_user_create",
  )
  const id = requireString(body, "id", "local_auth_user_create")
  if (!UUID_PATTERN.test(id) || body.email !== email) {
    throw new Error("local_auth_user_create_shape_invalid")
  }
  return { id, email, password }
}

async function signIn(user: AuthUserFixture): Promise<string> {
  const response = await fetch(
    `${stack.apiUrl}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: stack.anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: user.email, password: user.password }),
    },
  )
  if (!response.ok)
    throw new Error(`local_auth_sign_in_failed_${response.status}`)
  const body = assertRecord(
    parseJson(await response.text(), "local_auth_sign_in"),
    "local_auth_sign_in",
  )
  return requireString(body, "access_token", "local_auth_sign_in")
}

async function rpcRequest(options: {
  name: string
  body: Record<string, unknown>
  apiKey: string
  bearerToken: string
}): Promise<{ response: Response; text: string; body: unknown }> {
  const response = await fetch(`${stack.restUrl}/rpc/${options.name}`, {
    method: "POST",
    headers: {
      apikey: options.apiKey,
      Authorization: `Bearer ${options.bearerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(options.body),
  })
  const text = await response.text()
  return {
    response,
    text,
    body: text.length === 0 ? null : parseJson(text, `rpc_${options.name}`),
  }
}

function readCatalogBody(
  advocateId: string,
  actorUserId: string,
): Record<string, unknown> {
  return {
    target_advocate_id: advocateId,
    acting_user_id: actorUserId,
  }
}

function replaceCatalogBody(options: {
  advocateId: string
  actorUserId: string
  expectedVersion: number
  beneficiaryIds: string[]
  featuredBeneficiaryIds: string[]
  requestId?: string
}): Record<string, unknown> {
  return {
    target_advocate_id: options.advocateId,
    acting_user_id: options.actorUserId,
    expected_advocate_version: options.expectedVersion,
    target_beneficiary_mode: "selected",
    target_beneficiary_ids: options.beneficiaryIds,
    target_featured_beneficiary_ids: options.featuredBeneficiaryIds,
    change_reason: "Exercise the local actor-aware catalog boundary",
    request_id: options.requestId ?? randomUUID(),
    trace_id: randomUUID(),
    session_id: null,
    client_ip: "127.0.0.1",
    user_agent: "Creator Share local catalog HTTP integration",
  }
}

function asCatalogRead(value: unknown): CatalogReadResponse {
  const body = assertRecord(value, "catalog_read")
  if (
    typeof body.advocate_version !== "number" ||
    !Number.isSafeInteger(body.advocate_version) ||
    (body.beneficiary_mode !== "all" &&
      body.beneficiary_mode !== "all_featured" &&
      body.beneficiary_mode !== "selected") ||
    !Array.isArray(body.beneficiary_selections) ||
    !Array.isArray(body.beneficiaries) ||
    body.selection_limit !== 1_000
  ) {
    throw new Error("catalog_read_shape_invalid")
  }
  return body as unknown as CatalogReadResponse
}

function collectObjectKeys(
  value: unknown,
  keys = new Set<string>(),
): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) collectObjectKeys(entry, keys)
    return keys
  }
  if (typeof value !== "object" || value === null) return keys
  for (const [key, entry] of Object.entries(value)) {
    keys.add(key)
    collectObjectKeys(entry, keys)
  }
  return keys
}

function cleanupDatabaseFixturesSql(): string {
  return `
BEGIN;
CREATE TEMP TABLE local_catalog_cleanup_advocates ON COMMIT DROP AS
SELECT id
FROM public.advocates
WHERE slug LIKE ${sqlLiteral(`${FIXTURE_PREFIX}%`)};

CREATE TEMP TABLE local_catalog_cleanup_beneficiaries ON COMMIT DROP AS
SELECT id
FROM public.beneficiaries
WHERE username LIKE ${sqlLiteral(`${FIXTURE_PREFIX}%`)};

SET LOCAL session_replication_role = replica;

DELETE FROM audit.audit_event_forensics forensic
USING audit.audit_events event
WHERE forensic.audit_event_id = event.id
  AND (
    event.advocate_id IN (SELECT id FROM local_catalog_cleanup_advocates)
    OR event.record_pk ->> 'id' IN (
      SELECT id::text FROM local_catalog_cleanup_beneficiaries
    )
  );

DELETE FROM audit.advocate_delegate_events event
WHERE event.advocate_id IN (SELECT id FROM local_catalog_cleanup_advocates);

DELETE FROM audit.audit_events event
WHERE event.advocate_id IN (SELECT id FROM local_catalog_cleanup_advocates)
   OR event.record_pk ->> 'id' IN (
     SELECT id::text FROM local_catalog_cleanup_beneficiaries
   );

DELETE FROM public.advocate_beneficiaries selection
WHERE selection.advocate_id IN (SELECT id FROM local_catalog_cleanup_advocates)
   OR selection.beneficiary_id IN (
     SELECT id FROM local_catalog_cleanup_beneficiaries
   );

DELETE FROM public.advocate_membership_roles membership_role
WHERE membership_role.advocate_id IN (
  SELECT id FROM local_catalog_cleanup_advocates
);

DELETE FROM public.advocate_memberships membership
WHERE membership.advocate_id IN (SELECT id FROM local_catalog_cleanup_advocates);

DELETE FROM public.advocates advocate
WHERE advocate.id IN (SELECT id FROM local_catalog_cleanup_advocates);

DELETE FROM public.beneficiaries beneficiary
WHERE beneficiary.id IN (SELECT id FROM local_catalog_cleanup_beneficiaries);

SET LOCAL session_replication_role = origin;
COMMIT;
`
}

function fixtureResidueSql(): string {
  return `
SELECT
  (SELECT count(*) FROM public.advocates WHERE slug LIKE ${sqlLiteral(`${FIXTURE_PREFIX}%`)}),
  (SELECT count(*) FROM public.beneficiaries WHERE username LIKE ${sqlLiteral(`${FIXTURE_PREFIX}%`)}),
  (SELECT count(*) FROM auth.users WHERE email LIKE ${sqlLiteral(`${FIXTURE_PREFIX}%@example.test`)});
`
}

function seedFixtureSql(value: CatalogHttpFixture): string {
  const membershipOwnerA = randomUUID()
  const membershipCuratorA = randomUUID()
  const membershipBrandA = randomUUID()
  const membershipOwnerB = randomUUID()
  return `
BEGIN;

INSERT INTO public.advocates (
  id,
  slug,
  display_name,
  relationship_status,
  publication_status,
  beneficiary_mode,
  created_by_user_id
)
VALUES
  (
    ${uuidLiteral(value.advocateAId)},
    ${sqlLiteral(value.advocateASlug)},
    ${sqlLiteral(value.advocateAName)},
    'active',
    'draft',
    'all',
    ${uuidLiteral(value.users.ownerA.id)}
  ),
  (
    ${uuidLiteral(value.advocateBId)},
    ${sqlLiteral(value.advocateBSlug)},
    ${sqlLiteral(value.advocateBName)},
    'active',
    'draft',
    'all',
    ${uuidLiteral(value.users.ownerB.id)}
  );

INSERT INTO public.advocate_memberships (id, advocate_id, user_id, status)
VALUES
  (
    ${uuidLiteral(membershipOwnerA)},
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(value.users.ownerA.id)},
    'active'
  ),
  (
    ${uuidLiteral(membershipCuratorA)},
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(value.users.curatorA.id)},
    'active'
  ),
  (
    ${uuidLiteral(membershipBrandA)},
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(value.users.brandA.id)},
    'active'
  ),
  (
    ${uuidLiteral(membershipOwnerB)},
    ${uuidLiteral(value.advocateBId)},
    ${uuidLiteral(value.users.ownerB.id)},
    'active'
  );

INSERT INTO public.advocate_membership_roles (
  advocate_id,
  membership_id,
  role_id,
  assigned_by_user_id
)
VALUES
  (
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(membershipOwnerA)},
    ${uuidLiteral(OWNER_ROLE_ID)},
    ${uuidLiteral(value.users.ownerA.id)}
  ),
  (
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(membershipCuratorA)},
    ${uuidLiteral(CATALOG_CURATOR_ROLE_ID)},
    ${uuidLiteral(value.users.ownerA.id)}
  ),
  (
    ${uuidLiteral(value.advocateAId)},
    ${uuidLiteral(membershipBrandA)},
    ${uuidLiteral(BRAND_EDITOR_ROLE_ID)},
    ${uuidLiteral(value.users.ownerA.id)}
  ),
  (
    ${uuidLiteral(value.advocateBId)},
    ${uuidLiteral(membershipOwnerB)},
    ${uuidLiteral(OWNER_ROLE_ID)},
    ${uuidLiteral(value.users.ownerB.id)}
  );

UPDATE public.advocates
SET owner_membership_id = CASE id
  WHEN ${uuidLiteral(value.advocateAId)} THEN ${uuidLiteral(membershipOwnerA)}
  ELSE ${uuidLiteral(membershipOwnerB)}
END
WHERE id IN (
  ${uuidLiteral(value.advocateAId)},
  ${uuidLiteral(value.advocateBId)}
);

INSERT INTO public.beneficiaries (
  id,
  name,
  username,
  biography,
  birth_date,
  budget_goal,
  status,
  beneficiary_type,
  goal_fulfilled_at
)
VALUES
  (
    ${uuidLiteral(value.childAlphaId)},
    ${sqlLiteral(value.childAlphaName)},
    ${sqlLiteral(`${FIXTURE_PREFIX}${value.runId}-alpha`)},
    ${sqlLiteral(value.privateContactMarker)},
    '2014-01-01',
    -1,
    'New',
    'IN_OUR_CARE',
    NULL
  ),
  (
    ${uuidLiteral(value.childBetaId)},
    ${sqlLiteral(value.childBetaName)},
    ${sqlLiteral(`${FIXTURE_PREFIX}${value.runId}-beta`)},
    NULL,
    '2015-01-01',
    -1,
    'Partially Funded',
    'IN_OUR_CARE',
    NULL
  );

COMMIT;
`
}

async function createFixture(): Promise<CatalogHttpFixture> {
  const runId = randomBytes(6).toString("hex")
  const partialUsers: Partial<CatalogHttpFixture["users"]> = {}
  const labels = ["owner-a", "curator-a", "brand-a", "owner-b"] as const
  try {
    for (const label of labels) {
      const user = await createAuthUser(runId, label)
      if (label === "owner-a") partialUsers.ownerA = user
      else if (label === "curator-a") partialUsers.curatorA = user
      else if (label === "brand-a") partialUsers.brandA = user
      else partialUsers.ownerB = user
    }
  } catch (error) {
    for (const user of Object.values(partialUsers)) {
      if (user) await deleteAuthUser(user.id)
    }
    throw error
  }
  const users = partialUsers as CatalogHttpFixture["users"]
  const value: CatalogHttpFixture = {
    runId,
    advocateAId: randomUUID(),
    advocateBId: randomUUID(),
    advocateASlug: `${FIXTURE_PREFIX}${runId}-a`,
    advocateBSlug: `${FIXTURE_PREFIX}${runId}-b`,
    advocateAName: `Catalog HTTP Portal A ${runId}`,
    advocateBName: `Catalog HTTP Portal B ${runId}`,
    childAlphaId: randomUUID(),
    childBetaId: randomUUID(),
    childAlphaName: `Catalog HTTP Alpha ${runId}`,
    childBetaName: `Catalog HTTP Beta ${runId}`,
    privateContactMarker: `${FIXTURE_PREFIX}private-contact-${runId}@example.test`,
    users,
  }
  try {
    executeSql(seedFixtureSql(value))
  } catch (error) {
    for (const user of Object.values(users)) await deleteAuthUser(user.id)
    throw error
  }
  return value
}

async function cleanupFixture(): Promise<void> {
  const errors: unknown[] = []
  try {
    executeSql(cleanupDatabaseFixturesSql())
  } catch (error) {
    errors.push(error)
  }
  const current = fixture
  if (current !== null) {
    for (const user of Object.values(current.users)) {
      try {
        await deleteAuthUser(user.id)
      } catch (error) {
        errors.push(error)
      }
    }
  }
  try {
    await deleteStaleAuthUsers()
  } catch (error) {
    errors.push(error)
  }
  try {
    const residue = executeSql(fixtureResidueSql())
    if (residue !== "0|0|0") {
      errors.push(
        new Error(`local_catalog_fixture_cleanup_incomplete:${residue}`),
      )
    }
  } catch (error) {
    errors.push(error)
  }
  fixture = null
  if (errors.length > 0) {
    throw new AggregateError(errors, "local_catalog_fixture_cleanup_failed")
  }
}

async function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") {
        server.close()
        reject(new Error("catalog_real_app_port_unavailable"))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(address.port)
      })
    })
  })
}

async function stopApp(): Promise<void> {
  const processToStop = appProcess
  appProcess = null
  if (
    processToStop === null ||
    processToStop.exitCode !== null ||
    processToStop.signalCode !== null
  ) {
    return
  }
  await new Promise<void>((resolveExit) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(forceTimer)
      clearTimeout(exitTimer)
      resolveExit()
    }
    const forceTimer = setTimeout(() => processToStop.kill("SIGKILL"), 5_000)
    const exitTimer = setTimeout(finish, 10_000)
    processToStop.once("exit", finish)
    if (!processToStop.kill("SIGTERM")) finish()
  })
}

async function startIsolatedApp(): Promise<void> {
  const port = await reservePort()
  appOrigin = `http://127.0.0.1:${port}`
  appOutput = ""
  appDirectory = await mkdtemp(join(tmpdir(), "creator-share-catalog-page-"))
  for (const directory of ["src", "public"]) {
    await cp(resolve(WORKSPACE, directory), resolve(appDirectory, directory), {
      recursive: true,
    })
  }
  for (const file of [
    "next-env.d.ts",
    "next.config.ts",
    "package.json",
    "postcss.config.mjs",
    "tailwind.config.ts",
    "tsconfig.json",
  ]) {
    await cp(resolve(WORKSPACE, file), resolve(appDirectory, file))
  }
  await symlink(
    resolve(WORKSPACE, "node_modules"),
    resolve(appDirectory, "node_modules"),
    "dir",
  )

  appProcess = spawn(
    process.execPath,
    [NEXT_EXECUTABLE, "dev", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        NODE_ENV: "development",
        NEXT_TELEMETRY_DISABLED: "1",
        NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: stack.anonKey,
        NEXT_SERVICE_ROLE_KEY: stack.serviceRoleKey,
        NEXT_PUBLIC_BASE_URL: appOrigin,
        NEXT_PUBLIC_SITE_URL: appOrigin,
      },
      stdio: "pipe",
    },
  )
  appProcess.stdout.on("data", (chunk: Buffer) => {
    appOutput += chunk.toString()
  })
  appProcess.stderr.on("data", (chunk: Buffer) => {
    appOutput += chunk.toString()
  })

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
      throw new Error(`catalog_real_app_exited\n${appOutput}`)
    }
    try {
      const response = await fetch(`${appOrigin}/api/auth/login`)
      if (response.status > 0) return
    } catch {
      // The copied application is still compiling.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`catalog_real_app_start_timeout\n${appOutput}`)
}

async function browserLogin(page: Page, user: AuthUserFixture): Promise<void> {
  await page.goto(`${appOrigin}/api/auth/login`)
  const result = await page.evaluate(
    async ({ email, password }) => {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      return { status: response.status, body: await response.text() }
    },
    { email: user.email, password: user.password },
  )
  expect(result.status, result.body).toBe(200)
}

test.describe("local Supabase advocate catalog service boundary", () => {
  test.skip(
    !RUN_LOCAL_INTEGRATION,
    "Set RUN_LOCAL_SUPABASE_HTTP_INTEGRATION=1 with the local Supabase stack running.",
  )

  test.beforeAll(async () => {
    stack = await readLocalSupabaseStack()
    executeSql(cleanupDatabaseFixturesSql())
    await deleteStaleAuthUsers()
    fixture = await createFixture()
  })

  test.afterAll(async () => {
    try {
      await stopApp()
      if (appDirectory !== null) {
        await rm(appDirectory, { recursive: true, force: true })
      }
    } finally {
      if (stack) await cleanupFixture()
    }
  })

  test("enforces service role, exact actor permission, tenant isolation, mutation, and privacy through HTTP", async () => {
    const current = fixture
    if (current === null) throw new Error("catalog_http_fixture_missing")
    const curatorToken = await signIn(current.users.curatorA)

    for (const attempt of [
      {
        name: "read_advocate_catalog_administration",
        body: readCatalogBody(current.advocateAId, current.users.curatorA.id),
      },
      {
        name: "replace_advocate_beneficiary_configuration",
        body: replaceCatalogBody({
          advocateId: current.advocateAId,
          actorUserId: current.users.curatorA.id,
          expectedVersion: 1,
          beneficiaryIds: [current.childAlphaId],
          featuredBeneficiaryIds: [],
        }),
      },
    ]) {
      const directUserAttempt = await rpcRequest({
        ...attempt,
        apiKey: stack.anonKey,
        bearerToken: curatorToken,
      })
      expect([401, 403, 404]).toContain(directUserAttempt.response.status)
      expect(directUserAttempt.response.ok).toBe(false)
      expect(directUserAttempt.text).not.toContain(current.childAlphaName)
      expect(directUserAttempt.text).not.toContain(current.users.curatorA.email)
    }

    const initialResult = await rpcRequest({
      name: "read_advocate_catalog_administration",
      body: readCatalogBody(current.advocateAId, current.users.curatorA.id),
      apiKey: stack.serviceRoleKey,
      bearerToken: stack.serviceRoleKey,
    })
    expect(initialResult.response.status, initialResult.text).toBe(200)
    const initial = asCatalogRead(initialResult.body)
    expect(Object.keys(initial).sort()).toEqual([
      "advocate_version",
      "beneficiaries",
      "beneficiary_mode",
      "beneficiary_selections",
      "selection_limit",
    ])
    expect(initial.beneficiary_mode).toBe("all")
    expect(initial.beneficiary_selections).toEqual([])
    expect(initial.beneficiaries.map((beneficiary) => beneficiary.id)).toEqual(
      expect.arrayContaining([current.childAlphaId, current.childBetaId]),
    )
    for (const beneficiary of initial.beneficiaries) {
      expect(Object.keys(beneficiary).sort()).toEqual([
        "blocked_reason",
        "eligible",
        "id",
        "name",
        "status",
        "username",
      ])
    }
    expect(
      [...collectObjectKeys(initial)].filter((key) =>
        FORBIDDEN_RESPONSE_KEY.test(key),
      ),
    ).toEqual([])
    const serializedInitial = JSON.stringify(initial)
    expect(serializedInitial).not.toContain(current.privateContactMarker)
    for (const user of Object.values(current.users)) {
      expect(serializedInitial).not.toContain(user.email)
    }

    for (const denied of [
      {
        label: "permission",
        advocateId: current.advocateAId,
        actorUserId: current.users.brandA.id,
      },
      {
        label: "tenant",
        advocateId: current.advocateBId,
        actorUserId: current.users.curatorA.id,
      },
    ]) {
      const deniedRead = await rpcRequest({
        name: "read_advocate_catalog_administration",
        body: readCatalogBody(denied.advocateId, denied.actorUserId),
        apiKey: stack.serviceRoleKey,
        bearerToken: stack.serviceRoleKey,
      })
      expect(
        deniedRead.response.status,
        `${denied.label}:${deniedRead.text}`,
      ).toBe(403)

      const deniedMutation = await rpcRequest({
        name: "replace_advocate_beneficiary_configuration",
        body: replaceCatalogBody({
          advocateId: denied.advocateId,
          actorUserId: denied.actorUserId,
          expectedVersion: initial.advocate_version,
          beneficiaryIds: [current.childAlphaId],
          featuredBeneficiaryIds: [],
        }),
        apiKey: stack.serviceRoleKey,
        bearerToken: stack.serviceRoleKey,
      })
      expect(
        deniedMutation.response.status,
        `${denied.label}:${deniedMutation.text}`,
      ).toBe(403)
    }

    const mutation = await rpcRequest({
      name: "replace_advocate_beneficiary_configuration",
      body: replaceCatalogBody({
        advocateId: current.advocateAId,
        actorUserId: current.users.curatorA.id,
        expectedVersion: initial.advocate_version,
        beneficiaryIds: [current.childBetaId, current.childAlphaId],
        featuredBeneficiaryIds: [current.childAlphaId],
      }),
      apiKey: stack.serviceRoleKey,
      bearerToken: stack.serviceRoleKey,
    })
    expect(mutation.response.status, mutation.text).toBe(200)
    expect(mutation.body).toBe(initial.advocate_version + 1)

    const readbackResult = await rpcRequest({
      name: "read_advocate_catalog_administration",
      body: readCatalogBody(current.advocateAId, current.users.curatorA.id),
      apiKey: stack.serviceRoleKey,
      bearerToken: stack.serviceRoleKey,
    })
    expect(readbackResult.response.status, readbackResult.text).toBe(200)
    const readback = asCatalogRead(readbackResult.body)
    expect(readback.advocate_version).toBe(initial.advocate_version + 1)
    expect(readback.beneficiary_mode).toBe("selected")
    expect(readback.beneficiary_selections).toEqual([
      { beneficiary_id: current.childBetaId, is_featured: false },
      { beneficiary_id: current.childAlphaId, is_featured: true },
    ])
    expect(JSON.stringify(readback)).not.toContain(current.privateContactMarker)
  })

  test("renders and mutates the actual authenticated portal catalog page", async ({
    page,
  }, testInfo) => {
    testInfo.setTimeout(120_000)
    const current = fixture
    if (current === null) throw new Error("catalog_http_fixture_missing")
    await startIsolatedApp()
    await browserLogin(page, current.users.curatorA)

    const response = await page.goto(
      `${appOrigin}/portal/${current.advocateASlug}/catalog`,
    )
    expect(response?.status()).toBe(200)
    await expect(
      page.getByRole("heading", { name: "Child catalog" }),
    ).toBeVisible()
    await expect(page.getByText(`1. ${current.childBetaName}`)).toBeVisible()
    await expect(page.getByText(`2. ${current.childAlphaName}`)).toBeVisible()
    const pageText = await page.locator("body").innerText()
    expect(pageText).not.toContain(current.privateContactMarker)
    for (const user of [
      current.users.ownerA,
      current.users.brandA,
      current.users.ownerB,
    ]) {
      expect(pageText).not.toContain(user.email)
    }

    await page.getByRole("radio", { name: /Show every eligible child/ }).check()
    await page.getByLabel("Change note").fill("Return to the full catalog")
    await page.getByRole("button", { name: "Save child catalog" }).click()
    await expect(
      page.getByText("Child catalog saved.", { exact: true }),
    ).toBeVisible()

    const readbackResult = await rpcRequest({
      name: "read_advocate_catalog_administration",
      body: readCatalogBody(current.advocateAId, current.users.curatorA.id),
      apiKey: stack.serviceRoleKey,
      bearerToken: stack.serviceRoleKey,
    })
    expect(readbackResult.response.status, readbackResult.text).toBe(200)
    const readback = asCatalogRead(readbackResult.body)
    expect(readback.beneficiary_mode).toBe("all")
    expect(readback.beneficiary_selections).toEqual([])
  })
})
