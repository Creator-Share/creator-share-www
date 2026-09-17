import { NextResponse } from "next/server"

const RETIRED_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const

export async function POST() {
  return NextResponse.json(
    { error: "This checkout endpoint has been retired" },
    { status: 410, headers: RETIRED_HEADERS },
  )
}
