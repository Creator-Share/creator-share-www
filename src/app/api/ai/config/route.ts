import { NextResponse } from "next/server"
import { isLLMConfigured } from "@/utils/ai/config"

export async function GET() {
  const available = isLLMConfigured()

  return NextResponse.json({
    available
  })
}
