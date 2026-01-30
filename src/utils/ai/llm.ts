import { Configuration, OpenAIApi, ResponseTypes } from "openai-edge"
import {
  PROOFREADING_SYSTEM_PROMPT,
  ACTIVITY_PROOFREADING_SYSTEM_PROMPT
} from "@/config/ai-prompts"
import { isLLMConfigured, getLLMConfig } from "./config"

export async function proofreadText(
  text: string,
  type: "biography" | "activity" = "biography",
  additionalInstructions?: string
): Promise<{
  success: boolean
  proofreadText?: string
  error?: string
}> {
  // Check configuration
  if (!isLLMConfigured()) {
    return {
      success: false,
      error:
        "LLM API is not configured. Please set LLM_API_KEY and LLM_API_HOST environment variables."
    }
  }

  // Validate input
  if (!text || text.trim().length === 0) {
    return {
      success: false,
      error: "No text provided for proofreading"
    }
  }

  try {
    const config = getLLMConfig()

    // Initialize OpenAI client with custom base URL
    const configuration = new Configuration({
      apiKey: config.apiKey,
      basePath: config.apiHost
    })
    const openai = new OpenAIApi(configuration)

    // Select appropriate prompt based on type
    const systemPrompt =
      type === "biography"
        ? PROOFREADING_SYSTEM_PROMPT
        : ACTIVITY_PROOFREADING_SYSTEM_PROMPT

    // Build user message with optional instructions
    let userMessage = `Original text:\n\n${text}\n\n`
    
    if (additionalInstructions && additionalInstructions.trim()) {
      userMessage += `Additional instructions: ${additionalInstructions.trim()}\n\n`
    }
    
    userMessage += `Improved text:`

    // Call LLM API
    const response = await openai.createChatCompletion({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      temperature: type === "biography" ? 0.7 : 0.5,
      stream: false
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("LLM API error response:", {
        status: response.status,
        statusText: response.statusText
      })
      throw new Error(`API returned ${response.status}: ${errorText}`)
    }

    const responseText = await response.text()
    
    // Check if response is HTML (common mistake - wrong endpoint)
    if (responseText.trim().startsWith("<!DOCTYPE") || responseText.trim().startsWith("<html")) {
      console.error("LLM API returned HTML instead of JSON. Check LLM_API_HOST configuration.")
      throw new Error("API returned HTML instead of JSON. Check your LLM_API_HOST configuration.")
    }

    let data: ResponseTypes["createChatCompletion"]
    try {
      data = JSON.parse(responseText) as ResponseTypes["createChatCompletion"]
    } catch {
      console.error("Failed to parse LLM API response as JSON")
      throw new Error("Failed to parse API response as JSON")
    }

    const proofreadText = data.choices?.[0]?.message?.content?.trim()

    if (!proofreadText) {
      console.error("LLM API returned no content in response")
      throw new Error("No response from LLM")
    }

    return {
      success: true,
      proofreadText
    }
  } catch (error: unknown) {
    console.error("LLM API error:", error)

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred"

    // Check for common errors
    if (
      errorMessage.includes("401") ||
      errorMessage.includes("authentication") ||
      errorMessage.includes("Unauthorized")
    ) {
      return {
        success: false,
        error: "API authentication failed. Please check your LLM_API_KEY."
      }
    }

    if (
      errorMessage.includes("429") ||
      errorMessage.includes("rate limit") ||
      errorMessage.includes("quota")
    ) {
      return {
        success: false,
        error: "Rate limit exceeded. Please wait a moment before trying again."
      }
    }

    if (errorMessage.includes("404") || errorMessage.includes("not found")) {
      return {
        success: false,
        error:
          "API endpoint not found. Please check your LLM_API_HOST configuration."
      }
    }

    return {
      success: false,
      error: `Failed to proofread text: ${errorMessage}`
    }
  }
}
