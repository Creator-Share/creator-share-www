import { NextResponse } from "next/server"

export async function POST() {
  return NextResponse.json(
    { error: "Role assignment is no longer available via this endpoint. Roles are now assigned at invite time." },
    { status: 410 }
  )
}
