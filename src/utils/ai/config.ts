/**
 * LLM Configuration Utilities
 *
 * Checks if LLM API is properly configured for AI proofreading features.
 * Supports any OpenAI-compatible API endpoint.
 */

import { isAdvocateStagingEnvironmentEnabled } from "@/lib/advocates/host"

export type LLMEnvironment = Readonly<Record<string, string | undefined>>

export function isLLMConfigured(
  environment: LLMEnvironment = process.env,
): boolean {
  return (
    !isAdvocateStagingEnvironmentEnabled(environment) &&
    Boolean(environment.LLM_API_KEY && environment.LLM_API_HOST)
  )
}

export function getLLMConfig(environment: LLMEnvironment = process.env) {
  if (!isLLMConfigured(environment)) {
    throw new Error("LLM API is not configured")
  }
  return {
    apiKey: environment.LLM_API_KEY,
    apiHost: environment.LLM_API_HOST,
    model: environment.LLM_MODEL || "gpt-4o-mini",
  }
}
