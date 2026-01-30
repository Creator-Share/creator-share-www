import { NextRequest, NextResponse } from "next/server"
import { proofreadText } from "@/utils/ai/llm"
import { isLLMConfigured } from "@/utils/ai/config"

export async function POST(req: NextRequest) {
  // Early check for configuration
  if (!isLLMConfigured()) {
    return NextResponse.json(
      { error: "AI proofreading is not configured on this server." },
      { status: 503 }
    )
  }

  try {
    const { text, type, instructions } = await req.json()

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Text is required and must be a string" },
        { status: 400 }
      )
    }

    if (text.length > 10000) {
      return NextResponse.json(
        { error: "Text is too long. Maximum 10,000 characters allowed." },
        { status: 400 }
      )
    }

    // Validate type if provided
    if (type && !["biography", "activity"].includes(type)) {
      return NextResponse.json(
        { error: "Type must be 'biography' or 'activity'" },
        { status: 400 }
      )
    }

    // Validate instructions if provided
    if (instructions && typeof instructions !== "string") {
      return NextResponse.json(
        { error: "Instructions must be a string" },
        { status: 400 }
      )
    }

    const result = await proofreadText(text, type || "biography", instructions)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      proofreadText: result.proofreadText
    })
  } catch (error) {
    console.error("Proofread API error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    )
  }
}
