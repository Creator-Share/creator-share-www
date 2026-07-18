import { NextRequest, NextResponse } from "next/server"

import {
  isTrustedCheckoutJsonRequest,
  resolveTrustedCheckoutRequestOrigin,
} from "@/lib/sponsorships/checkout/requestSecurity"
import { normalizeSponsorEmailV1 } from "@/lib/sponsorships/crypto"
import { createClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAXIMUM_VERIFY_OTP_BODY_BYTES = 1024

const RECOVERY_OTP_TYPE = "recovery" as const
const RECOVERY_OTP_PATTERN = /^\d{6}$/
const RESPONSE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const

interface RecoveryOtpRequest {
  email: string
  token: string
  type: typeof RECOVERY_OTP_TYPE
}

function response(body: Record<string, string>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: RESPONSE_HEADERS,
  })
}

function parseRecoveryOtpRequest(
  serializedBody: string,
): RecoveryOtpRequest | null {
  if (
    Buffer.byteLength(serializedBody, "utf8") > MAXIMUM_VERIFY_OTP_BODY_BYTES
  ) {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(serializedBody)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null
  }

  const value = parsed as Record<string, unknown>
  const keys = Object.keys(value)
  if (
    keys.length !== 3 ||
    !keys.includes("email") ||
    !keys.includes("token") ||
    !keys.includes("type") ||
    typeof value.email !== "string" ||
    typeof value.token !== "string" ||
    value.type !== RECOVERY_OTP_TYPE ||
    !RECOVERY_OTP_PATTERN.test(value.token)
  ) {
    return null
  }

  try {
    return {
      email: normalizeSponsorEmailV1(value.email),
      token: value.token,
      type: RECOVERY_OTP_TYPE,
    }
  } catch {
    return null
  }
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    (!/^\d{1,10}$/.test(contentLength) ||
      Number(contentLength) > MAXIMUM_VERIFY_OTP_BODY_BYTES)
  ) {
    return null
  }

  if (request.body === null) return null

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let receivedBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAXIMUM_VERIFY_OTP_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString("utf8")
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

export async function POST(request: NextRequest) {
  const expectedOrigin = resolveTrustedCheckoutRequestOrigin({
    rawHost: request.headers.get("host"),
  })
  if (
    expectedOrigin === null ||
    !isTrustedCheckoutJsonRequest(request.headers, expectedOrigin)
  ) {
    return response({ error: "invalid-request" }, 400)
  }

  const serializedBody = await readBoundedBody(request)
  const verificationRequest =
    serializedBody === null ? null : parseRecoveryOtpRequest(serializedBody)
  if (verificationRequest === null) {
    return response({ error: "invalid-request" }, 400)
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp(verificationRequest)
    if (error) {
      return response({ error: "verification-failed" }, 400)
    }

    return response({ message: "OTP verified successfully." }, 200)
  } catch {
    return response({ error: "verification-unavailable" }, 503)
  }
}
