"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import {
  parseCreatorShareAdvocateOnboardingResponse,
  type CreatorShareAdvocateOnboardingFailureCode,
} from "@/lib/advocates/creatorShareAdmin/onboardingContracts"

const ADVOCATE_TYPES = Object.freeze([
  { value: "creator", label: "Content creator" },
  { value: "social_influencer", label: "Social influencer" },
  { value: "public_figure", label: "Public figure" },
  { value: "organization", label: "Organization" },
] as const)
const ONBOARDING_OPERATION_STORAGE_KEY =
  "creator-share:advocate-onboarding-operation:v1"
const OPERATION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/

function onboardingErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Review every field and submit the form again."
    case "unauthorized":
      return "Your session expired. Sign in again before creating this portal."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "onboarding_conflict":
      return "That subdomain or operation is already reserved. Refresh the portal list before continuing."
    default:
      return "The onboarding result could not be confirmed. Keep the form unchanged and retry so the same operation can be recovered safely."
  }
}

function hasExpectedErrorStatus(
  code: CreatorShareAdvocateOnboardingFailureCode,
  status: number,
): boolean {
  switch (code) {
    case "invalid_request":
      return status === 400
    case "unauthorized":
      return status === 401
    case "forbidden":
      return status === 403
    case "onboarding_conflict":
      return status === 409
    case "onboarding_unavailable":
      return status >= 500 && status <= 599
  }
}

export function AdvocateOnboarding() {
  const router = useRouter()
  const [slug, setSlug] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [advocateType, setAdvocateType] = useState("creator")
  const [ownerEmail, setOwnerEmail] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [storageResolved, setStorageResolved] = useState(false)
  const [hasPendingOperation, setHasPendingOperation] = useState(false)
  const [result, setResult] = useState<{
    advocateId: string
    displayName: string
    slug: string
  } | null>(null)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const operationId = useRef<string | null>(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(ONBOARDING_OPERATION_STORAGE_KEY)
      if (raw === null) return
      const value: unknown = JSON.parse(raw)
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        Object.keys(value).sort().join("|") !== "operationId|version" ||
        !("version" in value) ||
        value.version !== 1 ||
        !("operationId" in value) ||
        typeof value.operationId !== "string" ||
        !OPERATION_UUID_PATTERN.test(value.operationId)
      ) {
        sessionStorage.removeItem(ONBOARDING_OPERATION_STORAGE_KEY)
        return
      }
      operationId.current = value.operationId
      setHasPendingOperation(true)
    } catch {
      try {
        sessionStorage.removeItem(ONBOARDING_OPERATION_STORAGE_KEY)
      } catch {
        // Storage may be unavailable. In-memory retry safety still applies.
      }
    } finally {
      setStorageResolved(true)
    }
  }, [])

  const canonicalSlug = slug.trim().toLowerCase()
  const canSubmit =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(canonicalSlug) &&
    displayName === displayName.trim() &&
    displayName.length >= 1 &&
    displayName.length <= 160 &&
    !CONTROL_CHARACTER_PATTERN.test(displayName) &&
    ADVOCATE_TYPES.some((option) => option.value === advocateType) &&
    ownerEmail === ownerEmail.trim() &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) &&
    ownerEmail.length >= 3 &&
    ownerEmail.length <= 254 &&
    reason === reason.trim() &&
    reason.length >= 1 &&
    reason.length <= 2_000 &&
    !CONTROL_CHARACTER_PATTERN.test(reason) &&
    storageResolved &&
    !busy &&
    result === null

  function clearOperation() {
    operationId.current = null
    setHasPendingOperation(false)
    try {
      sessionStorage.removeItem(ONBOARDING_OPERATION_STORAGE_KEY)
    } catch {
      // Storage may be unavailable. The in-memory operation is already clear.
    }
  }

  function reset() {
    setSlug("")
    setDisplayName("")
    setAdvocateType("creator")
    setOwnerEmail("")
    setReason("")
    setResult(null)
    setMessage(null)
    clearOperation()
  }

  function discardPendingRetry() {
    clearOperation()
    setMessage({
      kind: "success",
      text: "The saved retry operation was discarded. The next submission will start a new operation.",
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    if (operationId.current === null) {
      operationId.current = globalThis.crypto.randomUUID()
      setHasPendingOperation(true)
      try {
        sessionStorage.setItem(
          ONBOARDING_OPERATION_STORAGE_KEY,
          JSON.stringify({ version: 1, operationId: operationId.current }),
        )
      } catch {
        // Keep the same operation for retries during this mounted session.
      }
    }
    const submittedOperationId = operationId.current
    if (submittedOperationId === null) return
    setBusy(true)
    setMessage(null)

    try {
      const response = await fetch("/api/admin/advocates", {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: canonicalSlug,
          displayName,
          advocateType,
          ownerEmail,
          reason,
          operationId: submittedOperationId,
        }),
      })
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareAdvocateOnboardingResponse(
        payload,
        submittedOperationId,
      )
      if (parsed === null) throw new Error("advocate_onboarding_failed")
      if (!parsed.ok) {
        if (
          response.ok ||
          !hasExpectedErrorStatus(parsed.code, response.status)
        ) {
          throw new Error("advocate_onboarding_failed")
        }
        setMessage({
          kind: "error",
          text: onboardingErrorMessage(parsed.code),
        })
        return
      }

      if (
        !response.ok ||
        (response.status !== 200 && response.status !== 201)
      ) {
        throw new Error("advocate_onboarding_failed")
      }

      clearOperation()
      setOwnerEmail("")
      setReason("")
      setResult({
        advocateId: parsed.advocateId,
        displayName,
        slug: canonicalSlug,
      })
      setMessage({
        kind: "success",
        text: "Portal reserved. The initial owner invitation is queued, and provider setup will wait until it is accepted.",
      })
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: onboardingErrorMessage("onboarding_unavailable"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="advocate-onboarding-heading"
      className="mt-8 rounded-xl border border-blue-100 bg-blue-50/40 p-5 shadow-sm sm:p-6"
    >
      <div className="max-w-3xl">
        <h2
          id="advocate-onboarding-heading"
          className="text-xl font-bold text-gray-950"
        >
          Create an advocate portal
        </h2>
        <p className="mt-2 text-sm text-gray-700">
          Reserve the branded subdomain and invite its initial owner. Domain and
          payment provider setup begins only after that person securely accepts
          ownership.
        </p>
      </div>

      {result ? (
        <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
          <p className="font-semibold">{message?.text}</p>
          <p className="mt-1 text-sm">
            {result.displayName} is reserved at {result.slug}.creatorshare.com.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/admin/advocates/${encodeURIComponent(result.advocateId)}`}
              className="flex min-h-11 items-center rounded-md bg-emerald-800 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-900"
            >
              Open portal controls
            </Link>
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-md border border-emerald-300 bg-white px-5 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-100"
            >
              Create another portal
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-5 grid gap-4 lg:grid-cols-2">
          <fieldset disabled={!storageResolved || busy} className="contents">
            <label className="text-sm font-semibold text-gray-900">
              Subdomain
              <div className="mt-1 flex min-h-11 rounded-md border border-gray-300 bg-white focus-within:border-blue-600 focus-within:ring-1 focus-within:ring-blue-600">
                <input
                  value={slug}
                  onChange={(event) => {
                    setSlug(event.target.value.toLowerCase())
                    setMessage(null)
                  }}
                  required
                  minLength={1}
                  maxLength={63}
                  pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-l-md px-3 py-2 font-normal outline-none"
                  placeholder="creator-name"
                />
                <span className="flex items-center border-l border-gray-200 px-3 text-gray-500">
                  .creatorshare.com
                </span>
              </div>
            </label>

            <label className="text-sm font-semibold text-gray-900">
              Public display name
              <input
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setMessage(null)
                }}
                required
                maxLength={160}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal"
                placeholder="Creator or organization name"
              />
            </label>

            <label className="text-sm font-semibold text-gray-900">
              Advocate type
              <select
                value={advocateType}
                onChange={(event) => {
                  setAdvocateType(event.target.value)
                  setMessage(null)
                }}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal"
              >
                {ADVOCATE_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-gray-900">
              Initial owner email
              <input
                type="email"
                value={ownerEmail}
                onChange={(event) => {
                  setOwnerEmail(event.target.value)
                  setMessage(null)
                }}
                required
                maxLength={254}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal"
                placeholder="owner@example.com"
              />
            </label>

            <label className="text-sm font-semibold text-gray-900 lg:col-span-2">
              Administrative reason
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  setMessage(null)
                }}
                required
                maxLength={2_000}
                rows={3}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-normal"
                placeholder="Record why this advocate portal is being created."
              />
            </label>

            <div className="lg:col-span-2">
              {hasPendingOperation ? (
                <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  A previous result is unresolved. Re-enter the exact same
                  values to recover it, or explicitly discard the saved retry
                  before starting a different portal.
                </p>
              ) : null}
              <button
                type="submit"
                disabled={!canSubmit}
                className="min-h-11 rounded-md bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {busy ? "Reserving portal" : "Reserve portal and invite owner"}
              </button>
              {hasPendingOperation && !busy ? (
                <button
                  type="button"
                  onClick={discardPendingRetry}
                  className="ml-3 min-h-11 rounded-md border border-gray-300 bg-white px-5 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                >
                  Discard saved retry
                </button>
              ) : null}
            </div>
          </fieldset>
        </form>
      )}

      {message && !result ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-4 rounded-md border p-3 text-sm font-semibold ${
            message.kind === "error"
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-blue-200 bg-blue-50 text-blue-950"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
