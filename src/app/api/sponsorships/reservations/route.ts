import { NextResponse } from "next/server"
import { cookies, headers } from "next/headers"
import { createClient } from "@/utils/supabase/server"
import type { SupabaseClient } from "@supabase/supabase-js"

const COOKIE_NAME = "csr_res_token"
const RES_MINUTES = parseInt(process.env.RESERVATION_TIMEOUT_MINUTES || "15", 10)

async function getOrCreateToken() {
  const jar = await cookies()
  let token = jar.get(COOKIE_NAME)?.value
  if (!token) {
    token = crypto.randomUUID()
    jar.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: RES_MINUTES * 60,
    })
  }
  return token
}

async function cleanupExpiredReservations(supabase: SupabaseClient) {
  try {
    await supabase
      .from("beneficiary_reservations")
      .delete()
      .lt("expires_at", new Date().toISOString())
  } catch (error) {
    console.error("Failed to cleanup expired reservations:", error)
  }
}

export async function POST(req: Request) {
  const supabase = await createClient()
  
  const body = await req.json().catch(() => ({}))
  const { beneficiaryId }: { beneficiaryId?: string } = body
  if (!beneficiaryId) {
    return NextResponse.json({ error: "beneficiaryId required" }, { status: 400 })
  }

  // Check if user is authenticated
  const { data: { user } } = await supabase.auth.getUser()
  
  const token = await getOrCreateToken()
  const hdrs = await headers()
  const ip = hdrs.get("x-forwarded-for") || hdrs.get("x-real-ip") || ""
  const ua = hdrs.get("user-agent") || ""

  // First, delete any expired reservation for this specific beneficiary
  await supabase
    .from("beneficiary_reservations")
    .delete()
    .eq("beneficiary_id", beneficiaryId)
    .lt("expires_at", new Date().toISOString())

  // Upsert the reservation - will insert new or update existing
  const { error } = await supabase
    .from("beneficiary_reservations")
    .upsert({
      beneficiary_id: beneficiaryId,
      reservation_token: token,
      user_id: user?.id || null,
      expires_at: new Date(Date.now() + RES_MINUTES * 60 * 1000).toISOString(),
      created_ip: ip,
      user_agent: ua,
    }, {
      onConflict: "beneficiary_id",
    })

  if (error) {
    console.error("Failed to create/update reservation:", error)
    return NextResponse.json({ error: "Failed to create reservation" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, expiresInMinutes: RES_MINUTES })
}

export async function DELETE(req: Request) {
  const supabase = await createClient()
  
  // Clean up expired reservations first
  await cleanupExpiredReservations(supabase)
  
  const body = await req.json().catch(() => ({}))
  const { beneficiaryId }: { beneficiaryId?: string } = body
  if (!beneficiaryId) {
    return NextResponse.json({ error: "beneficiaryId required" }, { status: 400 })
  }

  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (!token) {
    // nothing to delete
    return NextResponse.json({ ok: true })
  }

  await supabase
    .from("beneficiary_reservations")
    .delete()
    .eq("beneficiary_id", beneficiaryId)
    .eq("reservation_token", token)

  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const supabase = await createClient()
  
  // Force cleanup of expired reservations first
  await cleanupExpiredReservations(supabase)
  
  const { searchParams } = new URL(req.url)
  const beneficiaryId = searchParams.get("beneficiaryId")
  
  // If no beneficiaryId, return cleanup status
  if (!beneficiaryId) {
    const { data, error } = await supabase
      .from("beneficiary_reservations")
      .select("beneficiary_id", { count: "exact" })
      .gt("expires_at", new Date().toISOString())

    if (error) {
      return NextResponse.json({ error: "Failed to get active reservations" }, { status: 500 })
    }

    return NextResponse.json({ 
      activeReservations: data?.length || 0,
      cleaned: true 
    })
  }

  const { data, error } = await supabase
    .from("beneficiary_reservations")
    .select("expires_at, reservation_token, user_id")
    .eq("beneficiary_id", beneficiaryId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: "Database error" }, { status: 500 })
  }

  if (!data) return NextResponse.json({ reserved: false })

  const jar = await cookies()
  const myToken = jar.get(COOKIE_NAME)?.value
  const mine = myToken && data.reservation_token === myToken
  const ttlMs = new Date(data.expires_at).getTime() - Date.now()
  return NextResponse.json({ reserved: true, mine, ttlMs, userId: data.user_id })
}