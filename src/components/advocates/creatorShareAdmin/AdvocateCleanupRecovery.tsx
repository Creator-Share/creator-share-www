"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { parseCreatorShareAdvocateCleanupRecoveryResponse } from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"

function cleanupRecoveryErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Complete the confirmation and record why the protected external issue is resolved."
    case "unauthorized":
      return "Your session expired. Sign in again before retrying cleanup."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "cleanup_recovery_conflict":
      return "The portal or cleanup evidence changed. Refresh and review the current state."
    default:
      return "The cleanup retry could not be confirmed. You can retry the same request safely."
  }
}

export function AdvocateCleanupRecovery({
  advocateId,
  slug,
  initialVersion,
}: Readonly<{
  advocateId: string
  slug: string
  initialVersion: number
}>) {
  const router = useRouter()
  const [version, setVersion] = useState(initialVersion)
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const operation = useRef<{ fingerprint: string; id: string } | null>(null)

  useEffect(() => {
    setVersion(initialVersion)
    setReason("")
    setConfirmation("")
    setCompleted(false)
    setMessage(null)
    operation.current = null
  }, [advocateId, initialVersion, slug])

  const confirmationPhrase = `RETRY CLEANUP ${slug}`
  const canSubmit =
    reason === reason.trim() &&
    reason.length >= 1 &&
    reason.length <= 2_000 &&
    confirmation === confirmationPhrase &&
    !busy &&
    !completed

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    const fingerprint = JSON.stringify({ version, reason })
    if (operation.current?.fingerprint !== fingerprint) {
      operation.current = {
        fingerprint,
        id: globalThis.crypto.randomUUID(),
      }
    }
    const operationId = operation.current.id
    setBusy(true)
    setMessage(null)

    try {
      const response = await fetch(
        `/api/admin/advocates/${encodeURIComponent(advocateId)}/cleanup-recovery`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: version,
            reason,
            operationId,
            confirmation: "RETRY_CLEANUP",
          }),
        },
      )
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareAdvocateCleanupRecoveryResponse(payload, {
        operationId,
        expectedVersion: version,
      })
      if (parsed === null) throw new Error("cleanup_recovery_failed")
      if (!parsed.ok) {
        if (response.status < 500) operation.current = null
        setMessage({
          kind: "error",
          text: cleanupRecoveryErrorMessage(parsed.code),
        })
        return
      }

      operation.current = null
      setVersion(parsed.advocateVersion)
      setReason("")
      setConfirmation("")
      setCompleted(true)
      setMessage({
        kind: "success",
        text: "Cleanup retry requested. Automated strict-order cleanup will resume.",
      })
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: cleanupRecoveryErrorMessage("cleanup_recovery_failed"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="cleanup-recovery-heading"
      className="mt-4 rounded-lg border border-amber-300 bg-white p-4"
    >
      <h3 id="cleanup-recovery-heading" className="font-bold">
        Retry protected cleanup
      </h3>
      <p className="mt-1 text-sm">
        Use this only after the external cause has been corrected. The server
        selects the latest failed or cancelled strict-order step. No provider or
        job identifier can be selected here.
      </p>

      <form onSubmit={submit} className="mt-4 space-y-4">
        <fieldset disabled={busy || completed} className="space-y-4">
          <label className="block text-sm font-semibold">
            Recovery reason
            <textarea
              value={reason}
              onChange={(event) => {
                setReason(event.target.value)
                setMessage(null)
              }}
              required
              maxLength={2_000}
              rows={3}
              className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2 font-normal text-gray-950"
              placeholder="Record the external correction and why retry is safe."
            />
          </label>

          <label className="block text-sm font-semibold">
            Type {confirmationPhrase} to confirm
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="mt-1 min-h-11 w-full rounded-md border border-amber-300 px-3 py-2 font-normal text-gray-950"
            />
          </label>

          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-11 rounded-md bg-amber-800 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-900 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {busy ? "Requesting cleanup retry" : "Retry cleanup"}
          </button>
        </fieldset>
      </form>

      {message ? (
        <p
          role="status"
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
