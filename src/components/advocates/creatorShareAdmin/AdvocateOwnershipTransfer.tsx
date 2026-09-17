"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { parseCreatorShareAdvocateOwnershipTransferResponse } from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"

export interface AdvocateOwnershipTransferCandidate {
  membershipId: string
  displayName: string
}

function ownershipErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Select an eligible member, complete the confirmation, and record a reason."
    case "unauthorized":
      return "Your session expired. Sign in again before transferring ownership."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "ownership_conflict":
      return "The owner or selected member changed. Refresh before trying again."
    default:
      return "The ownership transfer could not be confirmed. You can retry the same request safely."
  }
}

export function AdvocateOwnershipTransfer({
  advocateId,
  slug,
  currentOwnerDisplayName,
  expectedOwnerMembershipId,
  candidates,
  candidateListMayBeIncomplete,
}: Readonly<{
  advocateId: string
  slug: string
  currentOwnerDisplayName: string
  expectedOwnerMembershipId: string | null
  candidates: readonly AdvocateOwnershipTransferCandidate[]
  candidateListMayBeIncomplete: boolean
}>) {
  const router = useRouter()
  const [targetMembershipId, setTargetMembershipId] = useState(
    candidates[0]?.membershipId ?? "",
  )
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const operation = useRef<{ fingerprint: string; id: string } | null>(null)

  const firstCandidateId = candidates[0]?.membershipId ?? ""
  const candidateKey = candidates
    .map((candidate) => candidate.membershipId)
    .join("|")
  useEffect(() => {
    setTargetMembershipId(firstCandidateId)
    setReason("")
    setConfirmation("")
    setCompleted(false)
    setMessage(null)
    operation.current = null
  }, [
    advocateId,
    candidateKey,
    expectedOwnerMembershipId,
    firstCandidateId,
    slug,
  ])

  const confirmationPhrase = `TRANSFER ${slug}`
  const selected = candidates.find(
    (candidate) => candidate.membershipId === targetMembershipId,
  )
  const canSubmit =
    expectedOwnerMembershipId !== null &&
    selected !== undefined &&
    reason === reason.trim() &&
    reason.length >= 1 &&
    reason.length <= 2_000 &&
    confirmation === confirmationPhrase &&
    !busy &&
    !completed

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || !selected || expectedOwnerMembershipId === null) return

    const fingerprint = JSON.stringify({
      expectedOwnerMembershipId,
      targetOwnerMembershipId: selected.membershipId,
      reason,
    })
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
        `/api/admin/advocates/${encodeURIComponent(advocateId)}/ownership`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedOwnerMembershipId,
            targetOwnerMembershipId: selected.membershipId,
            reason,
            operationId,
            confirmation: "TRANSFER",
          }),
        },
      )
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareAdvocateOwnershipTransferResponse(
        payload,
        operationId,
      )
      if (parsed === null) throw new Error("ownership_transfer_failed")
      if (!parsed.ok) {
        if (response.status < 500) operation.current = null
        setMessage({ kind: "error", text: ownershipErrorMessage(parsed.code) })
        return
      }

      operation.current = null
      setCompleted(true)
      setReason("")
      setConfirmation("")
      setMessage({
        kind: "success",
        text: `Ownership transferred to ${selected.displayName}.`,
      })
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: ownershipErrorMessage("ownership_transfer_failed"),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      aria-labelledby="ownership-transfer-heading"
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 id="ownership-transfer-heading" className="text-xl font-bold">
        Ownership transfer
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Current owner: {currentOwnerDisplayName}. Only an active, verified
        member of this portal can become its sole owner.
      </p>

      {expectedOwnerMembershipId === null ? (
        <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          The current owner was not present in the bounded member projection.
          Refresh or use a later support workflow before attempting a transfer.
        </p>
      ) : candidates.length === 0 ? (
        <p className="mt-4 text-sm text-gray-600">
          No eligible replacement owner is currently available.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-5 space-y-4">
          <fieldset disabled={busy || completed} className="space-y-4">
            <label className="block text-sm font-semibold text-gray-900">
              New owner
              <select
                value={targetMembershipId}
                onChange={(event) => {
                  setTargetMembershipId(event.target.value)
                  setConfirmation("")
                  setMessage(null)
                }}
                className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
              >
                {candidates.map((candidate) => (
                  <option
                    key={candidate.membershipId}
                    value={candidate.membershipId}
                  >
                    {candidate.displayName}
                  </option>
                ))}
              </select>
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
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 font-normal"
              />
            </label>

            <label className="block rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-950">
              Type {confirmationPhrase} to confirm the sole owner change
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-2 min-h-11 w-full rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-gray-950"
              />
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 rounded-md bg-red-700 px-5 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {busy ? "Transferring ownership" : "Transfer ownership"}
            </button>
          </fieldset>
        </form>
      )}

      {candidateListMayBeIncomplete ? (
        <p className="mt-4 text-xs text-gray-500">
          This bounded view shows the first 200 portal members. Additional
          members are intentionally not loaded into the browser.
        </p>
      ) : null}

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
