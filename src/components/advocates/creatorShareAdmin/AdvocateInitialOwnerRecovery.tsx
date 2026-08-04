"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  parseCreatorShareInitialOwnerReissueResponse,
  type CreatorShareInitialOwnerReissueFailureCode,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerRecoveryContracts"
import {
  initialOwnerClientOperationStorageKey,
  parseSavedInitialOwnerClientOperation,
  type SavedInitialOwnerClientOperation,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerClientOperation"

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Verify the initial owner email, confirmation, and administrative reason."
    case "unauthorized":
      return "Your session expired. Sign in again before retrying this invitation."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "initial_owner_reissue_conflict":
      return "The portal or invitation eligibility changed. Refresh and review the current state."
    default:
      return "The reissue result could not be confirmed. Keep the entries unchanged and retry so the same operation can be recovered safely."
  }
}

function expectedFailureStatus(
  code: CreatorShareInitialOwnerReissueFailureCode,
  status: number,
): boolean {
  switch (code) {
    case "invalid_request":
      return status === 400
    case "unauthorized":
      return status === 401
    case "forbidden":
      return status === 403
    case "portal_not_found":
      return status === 404
    case "initial_owner_reissue_conflict":
      return status === 409
    case "initial_owner_reissue_unavailable":
      return status >= 500 && status <= 599
  }
}

export function AdvocateInitialOwnerRecovery({
  advocateId,
  slug,
  initialVersion,
  canStartNewOperation,
  onOperationDiscarded,
  onOperationCompleted,
}: Readonly<{
  advocateId: string
  slug: string
  initialVersion: number
  canStartNewOperation: boolean
  onOperationDiscarded?: () => void
  onOperationCompleted?: () => void
}>) {
  const router = useRouter()
  const [ownerEmail, setOwnerEmail] = useState("")
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const storageContextKey = `${advocateId}:${initialVersion}:${slug}`
  const [resolvedStorageContextKey, setResolvedStorageContextKey] = useState<
    string | null
  >(null)
  const storageResolved = resolvedStorageContextKey === storageContextKey
  const [hasPendingOperation, setHasPendingOperation] = useState(false)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const operation = useRef<SavedInitialOwnerClientOperation | null>(null)

  useEffect(() => {
    setOwnerEmail("")
    setReason("")
    setConfirmation("")
    setBusy(false)
    setCompleted(false)
    setHasPendingOperation(false)
    setMessage(null)
    operation.current = null

    const key = initialOwnerClientOperationStorageKey("reissue", advocateId)
    try {
      const raw = sessionStorage.getItem(key)
      if (raw === null) return
      const saved = parseSavedInitialOwnerClientOperation(JSON.parse(raw))
      if (saved === null || saved.advocateId !== advocateId) {
        sessionStorage.removeItem(key)
        return
      }
      operation.current = saved
      setHasPendingOperation(true)
    } catch {
      try {
        sessionStorage.removeItem(key)
      } catch {
        // In-memory retry identity remains available when storage is blocked.
      }
    } finally {
      setResolvedStorageContextKey(storageContextKey)
    }
  }, [advocateId, initialVersion, slug, storageContextKey])

  const confirmationPhrase = `REISSUE OWNER ${slug}`
  const canSubmit =
    ownerEmail === ownerEmail.trim() &&
    ownerEmail.length >= 3 &&
    ownerEmail.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) &&
    reason === reason.trim() &&
    reason.length >= 1 &&
    reason.length <= 2_000 &&
    !/[\u0000-\u001f\u007f]/.test(reason) &&
    confirmation === confirmationPhrase &&
    (canStartNewOperation || hasPendingOperation) &&
    storageResolved &&
    !busy &&
    !completed

  function clearOperation() {
    operation.current = null
    setHasPendingOperation(false)
    try {
      sessionStorage.removeItem(
        initialOwnerClientOperationStorageKey("reissue", advocateId),
      )
    } catch {
      // The operation is already clear from memory.
    }
  }

  function discardPendingRetry() {
    clearOperation()
    onOperationDiscarded?.()
    setMessage({
      kind: "success",
      text: "The saved retry operation was discarded. The next submission will start a new operation.",
    })
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    if (operation.current === null) {
      if (!canStartNewOperation) return
      operation.current = Object.freeze({
        version: 1,
        operationId: globalThis.crypto.randomUUID(),
        advocateId,
        expectedVersion: initialVersion,
      })
      setHasPendingOperation(true)
      try {
        sessionStorage.setItem(
          initialOwnerClientOperationStorageKey("reissue", advocateId),
          JSON.stringify(operation.current),
        )
      } catch {
        // Keep the same operation for retries during this mounted session.
      }
    }

    const submittedOperation = operation.current
    if (submittedOperation === null) return
    setBusy(true)
    setMessage(null)

    try {
      const response = await fetch(
        `/api/admin/advocates/${encodeURIComponent(advocateId)}/initial-owner/reissue`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: submittedOperation.expectedVersion,
            ownerEmail,
            reason,
            operationId: submittedOperation.operationId,
            confirmation: "REISSUE_INITIAL_OWNER",
          }),
        },
      )
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareInitialOwnerReissueResponse(payload, {
        operationId: submittedOperation.operationId,
        advocateId,
        expectedVersion: submittedOperation.expectedVersion,
      })
      if (parsed === null) throw new Error("initial_owner_reissue_unavailable")
      if (!parsed.ok) {
        if (
          response.ok ||
          !expectedFailureStatus(parsed.code, response.status)
        ) {
          throw new Error("initial_owner_reissue_unavailable")
        }
        setMessage({ kind: "error", text: errorMessage(parsed.code) })
        return
      }
      if (!response.ok || ![200, 201].includes(response.status)) {
        throw new Error("initial_owner_reissue_unavailable")
      }

      clearOperation()
      setOwnerEmail("")
      setReason("")
      setConfirmation("")
      setCompleted(true)
      setMessage({
        kind: "success",
        text: "A fresh initial owner invitation is queued. The prior invitation can no longer grant access.",
      })
      onOperationCompleted?.()
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: errorMessage("initial_owner_reissue_unavailable"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="initial-owner-recovery-heading"
      className="rounded-xl border border-amber-300 bg-amber-50 p-6 shadow-sm"
    >
      <h2 id="initial-owner-recovery-heading" className="text-xl font-bold">
        {canStartNewOperation || hasPendingOperation
          ? "Reissue initial owner invitation"
          : "Initial owner invitation pending"}
      </h2>
      <p className="mt-2 text-sm text-amber-950">
        {canStartNewOperation
          ? "The server has determined that the previous invitation is safely terminal. Enter the same approved initial owner email to create fresh sealed delivery material. No address is loaded from the backend or saved in browser storage."
          : "The current invitation is not eligible for a new reissue. Ownership transfer and owner-only lifecycle controls remain unavailable until secure acceptance completes."}
      </p>

      {hasPendingOperation ? (
        <div className="mt-4 rounded-md border border-amber-300 bg-white p-3 text-sm text-amber-950">
          <p className="font-semibold">A previous result is unresolved.</p>
          <p className="mt-1">
            Re-enter the exact same email and reason to recover it, or discard
            the saved retry before starting a different request.
          </p>
          <button
            type="button"
            onClick={discardPendingRetry}
            disabled={!storageResolved || busy}
            className="mt-2 min-h-11 rounded-md border border-amber-400 px-4 py-2 font-semibold hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Discard saved retry
          </button>
        </div>
      ) : null}

      {canStartNewOperation || hasPendingOperation ? (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset
            disabled={!storageResolved || busy || completed}
            className="space-y-4"
          >
            <label className="block text-sm font-semibold text-gray-900">
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
                className="mt-1 min-h-11 w-full rounded-md border border-amber-300 bg-white px-3 py-2 font-normal"
              />
            </label>

            <label className="block text-sm font-semibold text-gray-900">
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
                className="mt-1 w-full rounded-md border border-amber-300 bg-white px-3 py-2 font-normal"
                placeholder="Record why a fresh owner invitation is appropriate."
              />
            </label>

            <label className="block text-sm font-semibold text-gray-900">
              Type {confirmationPhrase} to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 min-h-11 w-full rounded-md border border-amber-300 bg-white px-3 py-2 font-normal"
              />
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 rounded-md bg-amber-800 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {busy ? "Reissuing invitation" : "Reissue owner invitation"}
            </button>
          </fieldset>
        </form>
      ) : null}

      {message ? (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`mt-4 text-sm font-semibold ${
            message.kind === "success" ? "text-green-800" : "text-red-800"
          }`}
        >
          {message.text}
        </p>
      ) : null}
    </section>
  )
}
