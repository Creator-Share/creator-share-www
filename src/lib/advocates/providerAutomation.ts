import "server-only"

import { isAdvocateStagingEnvironmentEnabled } from "./host"

export const PROVIDER_AUTOMATION_MODE_ENVIRONMENT_VARIABLE =
  "ADVOCATE_PROVIDER_AUTOMATION_MODE" as const

export const PROVIDER_AUTOMATION_DISABLED_RESULT = Object.freeze({
  ok: true,
  code: "automation_disabled",
} as const)

export type ProviderAutomationMode = "disabled" | "active"

export type ProviderAutomationExecution<T> =
  Readonly<{ active: false }> | Readonly<{ active: true; value: T }>

export class ProviderAutomationConfigurationError extends Error {
  constructor() {
    super("advocate_provider_automation_mode_invalid")
    this.name = "ProviderAutomationConfigurationError"
  }
}

export function loadProviderAutomationMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ProviderAutomationMode {
  const configured = environment[PROVIDER_AUTOMATION_MODE_ENVIRONMENT_VARIABLE]
  if (
    isAdvocateStagingEnvironmentEnabled(environment) &&
    configured === "active"
  ) {
    throw new ProviderAutomationConfigurationError()
  }
  if (configured === undefined) return "disabled"
  if (configured === "disabled" || configured === "active") return configured
  throw new ProviderAutomationConfigurationError()
}

function isProviderAutomationActive(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  try {
    return loadProviderAutomationMode(environment) === "active"
  } catch (error) {
    if (error instanceof ProviderAutomationConfigurationError) return false
    throw error
  }
}

export async function runWhenProviderAutomationActive<T>(
  run: () => Promise<T>,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<ProviderAutomationExecution<T>> {
  if (!isProviderAutomationActive(environment)) {
    return Object.freeze({ active: false })
  }
  return Object.freeze({ active: true, value: await run() })
}
