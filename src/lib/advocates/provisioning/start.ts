import { createHash } from "node:crypto"

import { resolveAdvocateHost } from "@/lib/advocates/host"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const PROVISIONING_REQUEST_NAMESPACE =
  "9b087b09-b7f0-5e7e-bc80-9c5b746b5bfd"

export const MAX_PROVISIONING_START_BODY_BYTES = 4_096

export interface AdvocateProvisioningStartInput {
  expectedVersion: number
}

export interface AdvocateProvisioningStartResult {
  advocateId: string
  advocateVersion: number
  domainId: string
  hostname: string
  jobIds: [string, string, string, string, string]
}

export interface AdvocateProvisioningStartFailure {
  status: 400 | 403 | 404 | 409 | 500
  code:
    | "invalid_request"
    | "forbidden"
    | "portal_not_found"
    | "provisioning_conflict"
    | "provisioning_failed"
}

export function isJsonRequestContentType(value: string | null): boolean {
  if (value === null) return false
  return value.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
}

function uuidBytes(value: string): Buffer {
  return Buffer.from(value.replaceAll("-", ""), "hex")
}

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex")
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-")
}

export function deriveAdvocateProvisioningRequestId(input: {
  actorUserId: string
  advocateId: string
  expectedVersion: number
}): string | null {
  if (
    !UUID_PATTERN.test(input.actorUserId) ||
    !UUID_PATTERN.test(input.advocateId) ||
    !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion < 1
  ) {
    return null
  }

  const name = [
    "creator-share-advocate-provisioning-start-v1",
    input.actorUserId,
    input.advocateId,
    String(input.expectedVersion),
  ].join("\n")
  const digest = createHash("sha1")
    .update(uuidBytes(PROVISIONING_REQUEST_NAMESPACE))
    .update(Buffer.from(name, "utf8"))
    .digest()
    .subarray(0, 16)

  digest[6] = (digest[6] & 0x0f) | 0x50
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}

export async function readBoundedProvisioningStartBody(
  request: Pick<Request, "body" | "headers">,
): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^[0-9]+$/.test(contentLength) ||
      Number(contentLength) > MAX_PROVISIONING_START_BODY_BYTES)
  ) {
    return null
  }
  if (request.body === null) return ""

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_PROVISIONING_START_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

export function parseAdvocateProvisioningStartInput(
  rawBody: string,
): AdvocateProvisioningStartInput | null {
  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).byteLength >
      MAX_PROVISIONING_START_BODY_BYTES
  ) {
    return null
  }

  let value: unknown
  try {
    value = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "expectedVersion") ||
    typeof value.expectedVersion !== "number" ||
    !Number.isSafeInteger(value.expectedVersion) ||
    value.expectedVersion < 1
  ) {
    return null
  }
  return { expectedVersion: value.expectedVersion }
}

export function parseAdvocateProvisioningStartResult(
  value: unknown,
  expected: { advocateId: string; expectedVersion: number },
): AdvocateProvisioningStartResult | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null
  }
  const row = value[0]
  if (
    Object.keys(row).sort().join(",") !==
      "advocate_id,advocate_version,domain_id,hostname,job_ids" ||
    !isUuid(row.advocate_id) ||
    row.advocate_id !== expected.advocateId ||
    typeof row.advocate_version !== "number" ||
    !Number.isSafeInteger(row.advocate_version) ||
    row.advocate_version !== expected.expectedVersion + 1 ||
    !isUuid(row.domain_id) ||
    typeof row.hostname !== "string" ||
    !Array.isArray(row.job_ids) ||
    row.job_ids.length !== 5 ||
    !row.job_ids.every(isUuid) ||
    new Set(row.job_ids).size !== 5
  ) {
    return null
  }

  const host = resolveAdvocateHost(row.hostname)
  if (
    host.kind !== "tenant-candidate" ||
    host.environment !== "production" ||
    host.requestHostname !== row.hostname ||
    host.requestPort !== null ||
    host.domainLookup.hostname !== row.hostname
  ) {
    return null
  }

  return {
    advocateId: row.advocate_id,
    advocateVersion: row.advocate_version,
    domainId: row.domain_id,
    hostname: row.hostname,
    jobIds: row.job_ids as AdvocateProvisioningStartResult["jobIds"],
  }
}

export function classifyAdvocateProvisioningStartFailure(
  postgresCode: string | undefined,
): AdvocateProvisioningStartFailure {
  switch (postgresCode) {
    case "22023":
      return { status: 400, code: "invalid_request" }
    case "28000":
    case "42501":
      return { status: 403, code: "forbidden" }
    case "23503":
      return { status: 404, code: "portal_not_found" }
    case "23514":
    case "40001":
    case "55000":
      return { status: 409, code: "provisioning_conflict" }
    default:
      return { status: 500, code: "provisioning_failed" }
  }
}
