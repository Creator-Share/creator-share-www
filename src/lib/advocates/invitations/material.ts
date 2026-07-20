export const ADVOCATE_INVITATION_PATH = "/advocate-invitation"
export const ADVOCATE_INVITATION_AUTHENTICATE_PATH =
  "/api/auth/advocate-invitations/authenticate"
export const ADVOCATE_INVITATION_REDEEM_PATH =
  "/api/auth/advocate-invitations/redeem"
export const ADVOCATE_INVITATION_RECOVER_PATH =
  "/api/auth/advocate-invitations/recover"

const CAPABILITY_PATTERN = /^[0-9a-f]{64}$/
export const ADVOCATE_INVITATION_AUTH_TOKEN_HASH_MAXIMUM_LENGTH = 384
export const ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH = 1_536

const AUTH_TOKEN_HASH_PATTERN = /^[A-Za-z0-9._~-]{32,384}$/
const OPERATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const MATERIAL_KEYS = Object.freeze([
  "auth",
  "capability",
  "type",
  "v",
] as const)
export const ADVOCATE_INVITATION_MAXIMUM_REQUEST_BODY_LENGTH = 2_048

export type AdvocateInvitationAuthType = "magiclink" | "signup"

export interface AdvocateInvitationMaterial {
  capability: string
  authTokenHash: string
  authType: AdvocateInvitationAuthType
  version: 1
}

export interface AdvocateInvitationAuthenticationRequest {
  authTokenHash: string
  authType: AdvocateInvitationAuthType
  version: 1
}

export interface AdvocateInvitationRedemptionRequest {
  capability: string
  operationId: string
  version: 1
}

export interface AdvocateInvitationRecoveryRequest {
  operationId: string
  version: 1
}

export class AdvocateInvitationMaterialError extends Error {
  constructor() {
    super("advocate_invitation_material_invalid")
    this.name = "AdvocateInvitationMaterialError"
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isAdvocateInvitationAuthType(
  value: unknown,
): value is AdvocateInvitationAuthType {
  return value === "magiclink" || value === "signup"
}

export function isAdvocateInvitationOperationId(
  value: unknown,
): value is string {
  return typeof value === "string" && OPERATION_ID_PATTERN.test(value)
}

function parseExactBody(rawBody: string): Record<string, unknown> | null {
  if (
    typeof rawBody !== "string" ||
    rawBody.length < 2 ||
    rawBody.length > ADVOCATE_INVITATION_MAXIMUM_REQUEST_BODY_LENGTH ||
    /[^\x09\x0a\x0d\x20-\x7e]/.test(rawBody)
  ) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(rawBody)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isExactMaterial(value: AdvocateInvitationMaterial): boolean {
  return (
    value.version === 1 &&
    isAdvocateInvitationAuthType(value.authType) &&
    CAPABILITY_PATTERN.test(value.capability) &&
    AUTH_TOKEN_HASH_PATTERN.test(value.authTokenHash)
  )
}

export function buildAdvocateInvitationFragment(
  value: AdvocateInvitationMaterial,
): string {
  if (!isExactMaterial(value)) throw new AdvocateInvitationMaterialError()

  const parameters = new URLSearchParams({
    v: "1",
    capability: value.capability,
    auth: value.authTokenHash,
    type: value.authType,
  })
  const fragment = `#${parameters.toString()}`
  if (fragment.length > ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH) {
    throw new AdvocateInvitationMaterialError()
  }
  return fragment
}

export function buildAdvocateInvitationLink(options: {
  canonicalOrigin: string
  material: AdvocateInvitationMaterial
  allowDevelopmentLoopback?: boolean
}): string {
  let origin: URL
  try {
    origin = new URL(options.canonicalOrigin)
  } catch {
    throw new AdvocateInvitationMaterialError()
  }
  const isProductionOrigin =
    origin.protocol === "https:" &&
    origin.hostname === "creatorshare.com" &&
    origin.port === ""
  const isDevelopmentOrigin =
    options.allowDevelopmentLoopback === true &&
    origin.protocol === "http:" &&
    (origin.hostname === "localhost" ||
      origin.hostname === "127.0.0.1" ||
      origin.hostname === "[::1]")
  if (
    origin.origin !== options.canonicalOrigin ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    (!isProductionOrigin && !isDevelopmentOrigin)
  ) {
    throw new AdvocateInvitationMaterialError()
  }

  const invitationUrl = new URL(ADVOCATE_INVITATION_PATH, origin)
  invitationUrl.hash = buildAdvocateInvitationFragment(options.material)
  return invitationUrl.toString()
}

export function parseAdvocateInvitationFragment(
  fragment: string,
): AdvocateInvitationMaterial | null {
  if (
    typeof fragment !== "string" ||
    fragment.length < 2 ||
    fragment.length > ADVOCATE_INVITATION_MAXIMUM_FRAGMENT_LENGTH ||
    fragment[0] !== "#" ||
    /[^\x21-\x7e]/.test(fragment)
  ) {
    return null
  }

  let parameters: URLSearchParams
  try {
    parameters = new URLSearchParams(fragment.slice(1))
  } catch {
    return null
  }
  const keys = [...parameters.keys()].sort()
  if (
    keys.length !== MATERIAL_KEYS.length ||
    keys.some((key, index) => key !== MATERIAL_KEYS[index]) ||
    MATERIAL_KEYS.some((key) => parameters.getAll(key).length !== 1)
  ) {
    return null
  }

  const capability = parameters.get("capability") ?? ""
  const authTokenHash = parameters.get("auth") ?? ""
  const authType = parameters.get("type")
  if (
    parameters.get("v") !== "1" ||
    !isAdvocateInvitationAuthType(authType) ||
    !CAPABILITY_PATTERN.test(capability) ||
    !AUTH_TOKEN_HASH_PATTERN.test(authTokenHash)
  ) {
    return null
  }
  return Object.freeze({
    version: 1,
    capability,
    authTokenHash,
    authType,
  })
}

export function parseAdvocateInvitationRedeemBody(
  rawBody: string,
): AdvocateInvitationRedemptionRequest | null {
  const parsed = parseExactBody(rawBody)
  if (parsed === null) return null

  const keys = Object.keys(parsed).sort()
  if (
    keys.length !== 3 ||
    keys[0] !== "capability" ||
    keys[1] !== "operationId" ||
    keys[2] !== "version"
  ) {
    return null
  }

  const capability = parsed.capability
  const operationId = parsed.operationId
  if (
    parsed.version !== 1 ||
    typeof capability !== "string" ||
    !CAPABILITY_PATTERN.test(capability) ||
    !isAdvocateInvitationOperationId(operationId)
  ) {
    return null
  }
  const value: AdvocateInvitationRedemptionRequest = {
    capability,
    operationId,
    version: 1,
  }
  if (rawBody !== JSON.stringify(value)) return null
  return Object.freeze(value)
}

export function parseAdvocateInvitationAuthenticateBody(
  rawBody: string,
): AdvocateInvitationAuthenticationRequest | null {
  const parsed = parseExactBody(rawBody)
  if (parsed === null) return null

  const keys = Object.keys(parsed).sort()
  const authTokenHash = parsed.authTokenHash
  if (
    keys.length !== 3 ||
    keys[0] !== "authTokenHash" ||
    keys[1] !== "authType" ||
    keys[2] !== "version" ||
    parsed.version !== 1 ||
    !isAdvocateInvitationAuthType(parsed.authType) ||
    typeof authTokenHash !== "string" ||
    !AUTH_TOKEN_HASH_PATTERN.test(authTokenHash)
  ) {
    return null
  }

  const value: AdvocateInvitationAuthenticationRequest = {
    authTokenHash,
    authType: parsed.authType,
    version: 1,
  }
  if (rawBody !== JSON.stringify(value)) return null
  return Object.freeze(value)
}

export function parseAdvocateInvitationRecoveryBody(
  rawBody: string,
): AdvocateInvitationRecoveryRequest | null {
  const parsed = parseExactBody(rawBody)
  if (parsed === null) return null

  const keys = Object.keys(parsed).sort()
  if (
    keys.length !== 2 ||
    keys[0] !== "operationId" ||
    keys[1] !== "version" ||
    parsed.version !== 1 ||
    !isAdvocateInvitationOperationId(parsed.operationId)
  ) {
    return null
  }

  const value: AdvocateInvitationRecoveryRequest = {
    operationId: parsed.operationId,
    version: 1,
  }
  if (rawBody !== JSON.stringify(value)) return null
  return Object.freeze(value)
}
