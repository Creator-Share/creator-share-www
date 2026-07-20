import "server-only"

import { resolveAdvocateHost } from "./host"
import {
  ADVOCATE_EXPOSURE_BROKER_VERSION,
  ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER,
  ADVOCATE_EXPOSURE_CONTENT_TYPE,
  ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES,
  isCanonicalAdvocateExposureBrokerHost,
  isValidAdvocateExposurePagePath,
} from "./exposureBrokerProtocol"

const BOT_USER_AGENT_PATTERN =
  /(?:bot|crawler|spider|preview|facebookexternalhit|slackbot|discordbot|whatsapp|telegrambot|headless|lighthouse)/i
const ALLOWED_PREFLIGHT_HEADERS = Object.freeze([
  "content-type",
  ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER,
])

export interface AdvocateExposureBrokerRequestContext {
  advocateHostname: string
  allowedOrigin: string
}

export interface AdvocateExposureBrokerBody {
  pagePath: string
}

type BrokerEnvironment = Readonly<Record<string, string | undefined>>

function localApexPort(
  rawHost: string,
  environment: BrokerEnvironment,
): number | null | undefined {
  if (environment.NODE_ENV !== "development") return undefined
  if (!isCanonicalAdvocateExposureBrokerHost(rawHost, environment)) {
    return undefined
  }
  if (rawHost === "localhost") return null
  return Number(rawHost.slice("localhost:".length))
}

function hasExactFetchMetadata(
  headers: Headers,
  localDevelopment: boolean,
): boolean {
  return (
    headers.get("sec-fetch-site") ===
      (localDevelopment ? "cross-site" : "same-site") &&
    headers.get("sec-fetch-mode") === "cors" &&
    headers.get("sec-fetch-dest") === "empty"
  )
}

function isAutomatedOrSpeculativeRequest(headers: Headers): boolean {
  const purpose = `${headers.get("purpose") || ""} ${
    headers.get("sec-purpose") || ""
  }`
  if (/prefetch|prerender/i.test(purpose)) return true
  if (headers.get("next-router-prefetch") !== null) return true

  const userAgent = headers.get("user-agent") || ""
  return userAgent.length === 0 || BOT_USER_AGENT_PATTERN.test(userAgent)
}

function resolveAllowedTenantOrigin(
  rawOrigin: string | null,
  rawApexHost: string,
  environment: BrokerEnvironment,
): AdvocateExposureBrokerRequestContext | null {
  if (rawOrigin === null || rawOrigin.length > 512) return null

  let origin: URL
  try {
    origin = new URL(rawOrigin)
  } catch {
    return null
  }
  if (
    rawOrigin !== origin.origin ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    return null
  }

  const localPort = localApexPort(rawApexHost, environment)
  const allowLocalhostDevelopment = localPort !== undefined
  const host = resolveAdvocateHost(origin.host, {
    allowLocalhostDevelopment,
  })
  if (host.kind !== "tenant-candidate") return null

  if (allowLocalhostDevelopment) {
    if (
      origin.protocol !== "http:" ||
      host.environment !== "local-development" ||
      host.requestPort !== localPort
    ) {
      return null
    }
  } else if (
    origin.protocol !== "https:" ||
    host.environment !== "production" ||
    host.requestPort !== null
  ) {
    return null
  }

  return Object.freeze({
    advocateHostname: host.domainLookup.hostname,
    allowedOrigin: rawOrigin,
  })
}

function hasExactPreflightHeaders(headers: Headers): boolean {
  if (headers.get("access-control-request-method") !== "POST") return false
  const rawHeaders = headers.get("access-control-request-headers")
  if (rawHeaders === null || rawHeaders.length > 256) return false
  const requestedHeaders = rawHeaders
    .split(",")
    .map((value) => value.trim().toLowerCase())
  return (
    requestedHeaders.length === ALLOWED_PREFLIGHT_HEADERS.length &&
    new Set(requestedHeaders).size === ALLOWED_PREFLIGHT_HEADERS.length &&
    ALLOWED_PREFLIGHT_HEADERS.every((value) => requestedHeaders.includes(value))
  )
}

export function resolveAdvocateExposureBrokerRequest(
  request: Pick<Request, "headers" | "method">,
  environment: BrokerEnvironment = process.env,
): AdvocateExposureBrokerRequestContext | null {
  const rawHost = request.headers.get("host")
  const localDevelopment =
    rawHost !== null && localApexPort(rawHost, environment) !== undefined
  if (
    rawHost === null ||
    !isCanonicalAdvocateExposureBrokerHost(rawHost, environment) ||
    !hasExactFetchMetadata(request.headers, localDevelopment) ||
    isAutomatedOrSpeculativeRequest(request.headers)
  ) {
    return null
  }

  const context = resolveAllowedTenantOrigin(
    request.headers.get("origin"),
    rawHost,
    environment,
  )
  if (context === null) return null

  if (request.method === "OPTIONS") {
    return hasExactPreflightHeaders(request.headers) ? context : null
  }
  if (request.method !== "POST") return null

  return request.headers.get("content-type") ===
    ADVOCATE_EXPOSURE_CONTENT_TYPE &&
    request.headers.get(ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER) ===
      ADVOCATE_EXPOSURE_BROKER_VERSION
    ? context
    : null
}

async function readBoundedUtf8Body(request: Request): Promise<string | null> {
  const rawContentLength = request.headers.get("content-length")
  if (rawContentLength !== null) {
    if (!/^(?:0|[1-9][0-9]{0,9})$/.test(rawContentLength)) return null
    const contentLength = Number(rawContentLength)
    if (
      !Number.isSafeInteger(contentLength) ||
      contentLength > ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES
    ) {
      return null
    }
  }
  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      byteLength += value.byteLength
      if (byteLength > ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }

  const body = new Uint8Array(byteLength)
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

export async function readAdvocateExposureBrokerBody(
  request: Request,
): Promise<AdvocateExposureBrokerBody | null> {
  const rawBody = await readBoundedUtf8Body(request)
  if (rawBody === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const keys = Object.keys(parsed)
  if (keys.length !== 1 || keys[0] !== "pagePath") return null
  if (!isValidAdvocateExposurePagePath(parsed.pagePath)) return null
  return Object.freeze({ pagePath: parsed.pagePath })
}

export function isExactActiveAdvocatePresentationSnapshot(
  value: unknown,
  expectedHostname: string,
): boolean {
  if (!isRecord(value) || !isRecord(value.domain)) return false
  return (
    value.domain.hostname === expectedHostname &&
    value.domain.status === "active"
  )
}

export const ADVOCATE_EXPOSURE_ALLOWED_PREFLIGHT_HEADERS =
  ALLOWED_PREFLIGHT_HEADERS.join(", ")
