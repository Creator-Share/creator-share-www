/**
 * LLM Configuration Utilities
 * 
 * Checks if LLM API is properly configured for AI proofreading features.
 * Supports any OpenAI-compatible API endpoint.
 */

export function isLLMConfigured(): boolean {
  return !!(process.env.LLM_API_KEY && process.env.LLM_API_HOST)
}

export function getLLMConfig() {
  return {
    apiKey: process.env.LLM_API_KEY,
    apiHost: process.env.LLM_API_HOST,
    model: process.env.LLM_MODEL || "gpt-4o-mini"
  }
}
