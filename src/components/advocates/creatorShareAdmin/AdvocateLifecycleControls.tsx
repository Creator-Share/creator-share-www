"use client"

import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  parseCreatorShareAdvocateLifecycleResponse,
  type CreatorShareAdvocateLifecycleAction,
} from "@/lib/advocates/creatorShareAdmin/lifecycleContracts"

const ACTION_PRESENTATION: Readonly<
  Record<
    CreatorShareAdvocateLifecycleAction,
    Readonly<{ label: string; description: string; buttonClassName: string }>
  >
> = Object.freeze({
  suspend: {
    label: "Suspend portal",
    description:
      "Withdraw the public portal and fence new provider work without deleting its domain configuration.",
    buttonClassName: "bg-amber-700 hover:bg-amber-800",
  },
  resume: {
    label: "Resume portal",
    description:
      "Return the relationship to active and start fresh readiness work. This never publishes the portal directly.",
    buttonClassName: "bg-blue-700 hover:bg-blue-800",
  },
  archive: {
    label: "Archive portal",
    description:
      "Irreversibly archive the relationship, revoke pending invitations, and begin ordered domain cleanup.",
    buttonClassName: "bg-red-700 hover:bg-red-800",
  },
  repair: {
    label: "Repair readiness",
    description:
      "Fence stale work and start a fresh provisioning pass. This never bypasses readiness checks or publishes directly.",
    buttonClassName: "bg-violet-700 hover:bg-violet-800",
  },
})

function lifecycleErrorMessage(code: string): string {
  switch (code) {
    case "invalid_request":
      return "Review the action, confirmation, and reason, then try again."
    case "unauthorized":
      return "Your session expired. Sign in again before changing this portal."
    case "forbidden":
      return "Your Creator Share administrator access changed. Refresh the page."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "lifecycle_conflict":
      return "The portal changed or another operation is still settling. Refresh before trying again."
    default:
      return "The lifecycle change could not be confirmed. You can retry the same request safely."
  }
}

export function AdvocateLifecycleControls({
  advocateId,
  slug,
  initialVersion,
  availableActions,
}: Readonly<{
  advocateId: string
  slug: string
  initialVersion: number
  availableActions: readonly CreatorShareAdvocateLifecycleAction[]
}>) {
  const router = useRouter()
  const [version, setVersion] = useState(initialVersion)
  const [action, setAction] = useState<
    CreatorShareAdvocateLifecycleAction | ""
  >(availableActions[0] ?? "")
  const [reason, setReason] = useState("")
  const [archiveConfirmation, setArchiveConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)
  const operation = useRef<{ fingerprint: string; id: string } | null>(null)

  const firstAvailableAction = availableActions[0] ?? ""
  const availableActionKey = availableActions.join("|")
  useEffect(() => {
    setVersion(initialVersion)
    setAction(firstAvailableAction)
    setReason("")
    setArchiveConfirmation("")
    setCompleted(false)
    setMessage(null)
    operation.current = null
  }, [
    advocateId,
    availableActionKey,
    firstAvailableAction,
    initialVersion,
    slug,
  ])

  const archivePhrase = `ARCHIVE ${slug}`
  const actionPresentation = action ? ACTION_PRESENTATION[action] : null
  const archiveConfirmed =
    action !== "archive" || archiveConfirmation === archivePhrase
  const canSubmit =
    action !== "" &&
    availableActions.includes(action) &&
    reason === reason.trim() &&
    reason.length >= 1 &&
    reason.length <= 2_000 &&
    archiveConfirmed &&
    !busy &&
    !completed

  const optionList = useMemo(
    () =>
      availableActions.map((candidate) => ({
        value: candidate,
        label: ACTION_PRESENTATION[candidate].label,
      })),
    [availableActions],
  )

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    const fingerprint = JSON.stringify({ action, version, reason })
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
        `/api/admin/advocates/${encodeURIComponent(advocateId)}/lifecycle`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            expectedVersion: version,
            reason,
            operationId,
            confirmation: action === "archive" ? "ARCHIVE" : null,
          }),
        },
      )
      let payload: unknown = null
      try {
        payload = await response.json()
      } catch {
        payload = null
      }
      const parsed = parseCreatorShareAdvocateLifecycleResponse(payload, {
        operationId,
        expectedVersion: version,
        action,
      })
      if (parsed === null) {
        throw new Error("lifecycle_update_failed")
      }
      if (!parsed.ok) {
        if (response.status < 500) operation.current = null
        setMessage({ kind: "error", text: lifecycleErrorMessage(parsed.code) })
        return
      }

      operation.current = null
      setVersion(parsed.advocateVersion)
      setCompleted(true)
      setReason("")
      setArchiveConfirmation("")
      setMessage({
        kind: "success",
        text:
          action === "archive" && parsed.domainCleanupRequested
            ? "Portal archived. Ordered domain cleanup has been requested."
            : `${ACTION_PRESENTATION[action].label} completed.`,
      })
      router.refresh()
    } catch {
      setMessage({
        kind: "error",
        text: lifecycleErrorMessage("lifecycle_update_failed"),
      })
    } finally {
      setBusy(false)
    }
  }

  if (optionList.length === 0) {
    return (
      <section
        aria-labelledby="lifecycle-controls-heading"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 id="lifecycle-controls-heading" className="text-xl font-bold">
          Lifecycle controls
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          No lifecycle action is currently eligible. Refresh after any open
          infrastructure work settles.
        </p>
      </section>
    )
  }

  return (
    <section
      aria-labelledby="lifecycle-controls-heading"
      className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
    >
      <h2 id="lifecycle-controls-heading" className="text-xl font-bold">
        Lifecycle controls
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Every action is version fenced and audited. There is no force publish or
        unarchive path.
      </p>

      <form onSubmit={submit} className="mt-5 space-y-4">
        <fieldset disabled={busy || completed} className="space-y-4">
          <label className="block text-sm font-semibold text-gray-900">
            Action
            <select
              value={action}
              onChange={(event) => {
                setAction(
                  event.target.value as CreatorShareAdvocateLifecycleAction,
                )
                setArchiveConfirmation("")
                setMessage(null)
              }}
              className="mt-1 min-h-11 w-full rounded-md border border-gray-300 bg-white px-3 py-2"
            >
              {optionList.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {actionPresentation ? (
            <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-700">
              {actionPresentation.description}
            </p>
          ) : null}

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
              placeholder="Record why this change is necessary."
            />
          </label>

          {action === "archive" ? (
            <label className="block rounded-md border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-950">
              Type {archivePhrase} to confirm this irreversible action
              <input
                value={archiveConfirmation}
                onChange={(event) => setArchiveConfirmation(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-2 min-h-11 w-full rounded-md border border-red-300 bg-white px-3 py-2 font-normal text-gray-950"
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={!canSubmit}
            className={`min-h-11 rounded-md px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400 ${actionPresentation?.buttonClassName ?? "bg-gray-700"}`}
          >
            {busy ? "Applying action" : actionPresentation?.label}
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
