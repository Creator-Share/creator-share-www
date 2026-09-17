"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  initialOwnerClientOperationStorageKey,
  parseSavedInitialOwnerClientOperation,
  type SavedInitialOwnerClientOperation,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerClientOperation"
import {
  parseCreatorShareInitialOwnerRevocationResponse,
  type CreatorShareInitialOwnerRevocationFailureCode,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerRevocationContracts"

function errorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Verify the confirmation and administrative reason."
    case "unauthorized":
      return "Your session expired. Sign in again before revoking this invitation."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "initial_owner_revocation_conflict":
      return "The portal or invitation eligibility changed. Refresh and review the current state."
    default:
      return "The revocation result could not be confirmed. Keep the reason unchanged and retry so the same operation can be recovered safely."
  }
}

function expectedFailureStatus(
  code: CreatorShareInitialOwnerRevocationFailureCode,
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
    case "initial_owner_revocation_conflict":
      return status === 409
    case "initial_owner_revocation_unavailable":
      return status >= 500 && status <= 599
  }
}

export function AdvocateInitialOwnerRevocation({
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
    setReason("")
    setConfirmation("")
    setBusy(false)
    setCompleted(false)
    setHasPendingOperation(false)
    setMessage(null)
    operation.current = null

    const key = initialOwnerClientOperationStorageKey("revoke", advocateId)
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

  const confirmationPhrase = `REVOKE OWNER ${slug}`
  const canSubmit =
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
        initialOwnerClientOperationStorageKey("revoke", advocateId),
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
          initialOwnerClientOperationStorageKey("revoke", advocateId),
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
        `/api/admin/advocates/${encodeURIComponent(advocateId)}/initial-owner/revoke`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: submittedOperation.expectedVersion,
            reason,
            operationId: submittedOperation.operationId,
            confirmation: "REVOKE_INITIAL_OWNER",
          }),
        },
      )
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareInitialOwnerRevocationResponse(payload, {
        operationId: submittedOperation.operationId,
        advocateId,
        expectedVersion: submittedOperation.expectedVersion,
      })
      if (parsed === null) {
        throw new Error("initial_owner_revocation_unavailable")
      }
      if (!parsed.ok) {
        if (
          response.ok ||
          !expectedFailureStatus(parsed.code, response.status)
        ) {
          throw new Error("initial_owner_revocation_unavailable")
        }
        setMessage({ kind: "error", text: errorMessage(parsed.code) })
        return
      }
      if (!response.ok || ![200, 201].includes(response.status)) {
        throw new Error("initial_owner_revocation_unavailable")
      }

      clearOperation()
      setReason("")
      setConfirmation("")
      setCompleted(true)
      setMessage({
        kind: "success",
        text: "The initial owner invitation is revoked. A fresh invitation can now be issued safely.",
      })
      onOperationCompleted?.()
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: errorMessage("initial_owner_revocation_unavailable"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="initial-owner-revocation-heading"
      className="rounded-xl border border-red-300 bg-red-50 p-6 shadow-sm"
    >
      <h2 id="initial-owner-revocation-heading" className="text-xl font-bold">
        {canStartNewOperation || hasPendingOperation
          ? "Revoke initial owner invitation"
          : "Initial owner invitation pending"}
      </h2>
      <p className="mt-2 text-sm text-red-950">
        {canStartNewOperation
          ? "Use this when the current initial owner link must be invalidated before a replacement is issued. Revocation is immediate and audited."
          : "The current invitation is not eligible for revocation. Ownership transfer and owner-only lifecycle controls remain unavailable until secure acceptance completes."}
      </p>

      {hasPendingOperation ? (
        <div className="mt-4 rounded-md border border-red-300 bg-white p-3 text-sm text-red-950">
          <p className="font-semibold">A previous result is unresolved.</p>
          <p className="mt-1">
            Re-enter the exact same reason to recover it, or discard the saved
            retry before starting a different request.
          </p>
          <button
            type="button"
            onClick={discardPendingRetry}
            disabled={!storageResolved || busy}
            className="mt-2 min-h-11 rounded-md border border-red-400 px-4 py-2 font-semibold hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
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
                className="mt-1 w-full rounded-md border border-red-300 bg-white px-3 py-2 font-normal"
                placeholder="Record why the current owner link must be invalidated."
              />
            </label>

            <label className="block text-sm font-semibold text-red-950">
              Type {confirmationPhrase} to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 min-h-11 w-full rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-gray-950"
              />
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 rounded-md bg-red-800 px-5 py-2 text-sm font-semibold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {busy ? "Revoking invitation" : "Revoke owner invitation"}
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
