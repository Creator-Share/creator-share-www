import { GoogleGenerativeAI } from "@google/generative-ai"

const apiKey = process.env.GEMINI_API_KEY

if (!apiKey) {
  console.warn("GEMINI_API_KEY is not set in environment variables")
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null

export async function proofreadText(text: string): Promise<{
  success: boolean
  proofreadText?: string
  error?: string
}> {
  if (!genAI) {
    return {
      success: false,
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY to your .env file.",
    }
  }

  if (!text || text.trim().length === 0) {
    return {
      success: false,
      error: "No text provided for proofreading",
    }
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" })

    const prompt = `You are a helpful assistant that proofreads and improves text for beneficiary profiles and activity updates in a charitable organization platform.

Your task is to:
1. Fix any grammar, spelling, and punctuation errors
2. Improve readability and sentence flow
3. Maintain an empathetic, warm, and professional tone
4. Keep the original meaning and key information
5. Make the text more engaging while remaining respectful and appropriate for sensitive content

IMPORTANT: Return ONLY the improved text without any explanation, commentary, or quotation marks. Do not add phrases like "Here's the improved version" or similar. Just return the proofread text directly.

Original text:
${text}

Improved text:`

    const result = await model.generateContent(prompt)
    const response = result.response
    const proofreadText = response.text().trim()

    return {
      success: true,
      proofreadText,
    }
  } catch (error: unknown) {
    console.error("Gemini API error:", error)
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred"
    
    // Check for rate limiting
    if (errorMessage.includes("429") || errorMessage.includes("quota")) {
      return {
        success: false,
        error: "Rate limit exceeded. Please wait a moment before trying again. (Free tier: 15 requests/minute)",
      }
    }

    return {
      success: false,
      error: `Failed to proofread text: ${errorMessage}`,
    }
  }
}
