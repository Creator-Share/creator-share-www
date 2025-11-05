import { NextRequest, NextResponse } from "next/server"
import { proofreadText } from "@/utils/ai/gemini"

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()

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

    const result = await proofreadText(text)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      proofreadText: result.proofreadText,
    })
  } catch (error) {
    console.error("Proofread API error:", error)
    return NextResponse.json(
      { error: "An unexpected error occurred" },
      { status: 500 }
    )
  }
}
