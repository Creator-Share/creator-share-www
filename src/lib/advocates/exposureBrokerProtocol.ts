import { isQualifyingAdvocateExposurePagePath } from "./publicBrowsePaths"

export const ADVOCATE_EXPOSURE_BROKER_PATH = "/api/advocates/exposure"
export const ADVOCATE_EXPOSURE_BROKER_VERSION_HEADER =
  "x-creator-share-exposure-version"
export const ADVOCATE_EXPOSURE_BROKER_VERSION = "1"
export const ADVOCATE_EXPOSURE_CONTENT_TYPE = "application/json"
export const ADVOCATE_EXPOSURE_MAXIMUM_PAGE_PATH_LENGTH = 500
export const ADVOCATE_EXPOSURE_MAXIMUM_BODY_BYTES = 1_024

const LOCAL_APEX_HOST_PATTERN = /^localhost(?::([1-9][0-9]{0,4}))?$/

type BrokerEnvironment = Readonly<Record<string, string | undefined>>

export function isCanonicalAdvocateExposureBrokerHost(
  rawHost: string | null,
  environment: BrokerEnvironment = process.env,
): boolean {
  if (rawHost === null) return false
  if (environment.NODE_ENV !== "development") {
    return rawHost === "creatorshare.com"
  }
  const match = LOCAL_APEX_HOST_PATTERN.exec(rawHost)
  if (!match) return false
  if (match[1] === undefined) return true
  return Number(match[1]) <= 65_535
}

export function isValidAdvocateExposurePagePath(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= ADVOCATE_EXPOSURE_MAXIMUM_PAGE_PATH_LENGTH &&
    isQualifyingAdvocateExposurePagePath(value)
  )
}
