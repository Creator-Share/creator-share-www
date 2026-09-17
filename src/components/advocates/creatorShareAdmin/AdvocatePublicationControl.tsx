"use client"

import { FormEvent, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import {
  bindPublicationCanaryRun,
  parsePublicationCanaryClientResponse,
  parseSavedPublicationCanaryOperation,
  publicationCanaryOperationsEqual,
  publicationCanaryOperationStorageKey,
  type SavedPublicationCanaryOperation,
} from "@/lib/advocates/publicationCanary/clientOperation"

type PublicationPhase =
  | "idle"
  | "recovering"
  | "pending"
  | "authentication_required"
  | "uncertain"
  | "terminal"
  | "refreshing"
  | "published"

type TerminalCode =
  | "publication_canary_failed"
  | "publication_canary_expired"
  | "publication_deployment_changed"

const REQUEST_TIMEOUT_MS = 20_000

function validReason(value: string): boolean {
  return (
    value.length >= 1 &&
    Array.from(value).length <= 2_000 &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function operationMessage(code: string): string {
  switch (code) {
    case "unauthorized":
      return "Your session expired. Sign in again, then return to this portal. The saved publication operation will resume automatically."
    case "forbidden":
      return "Your Creator Share administrator access changed. The saved operation has not been cleared."
    case "portal_not_found":
      return "This advocate portal is no longer available. The saved operation has not been cleared."
    case "publication_conflict":
      return "The publication result is not yet safe to classify. Refresh the portal and retry the same saved operation."
    case "invalid_request":
      return "The saved publication request no longer matches the server contract. It has not been cleared."
    default:
      return "The publication result could not be confirmed. The exact operation is still saved and no replacement was created."
  }
}

function terminalMessage(code: TerminalCode): string {
  switch (code) {
    case "publication_canary_failed":
      return "The publication check finished without approval. Review the protected operational record and correct the failed release condition before starting again."
    case "publication_canary_expired":
      return "The publication evidence expired before approval. A fresh operation is required after this result is acknowledged."
    case "publication_deployment_changed":
      return "The production deployment changed after this check began. Its evidence cannot approve the current release. A fresh operation may begin after the original 30 minute evidence window ends."
  }
}

function persistExactOperation(
  key: string,
  operation: SavedPublicationCanaryOperation,
): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(operation))
    const raw = sessionStorage.getItem(key)
    if (raw === null) return false
    const readBack = parseSavedPublicationCanaryOperation(JSON.parse(raw))
    return (
      readBack !== null && publicationCanaryOperationsEqual(readBack, operation)
    )
  } catch {
    return false
  }
}

function waitForRetry(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const finish = () => {
      window.clearTimeout(timeout)
      signal.removeEventListener("abort", finish)
      resolve()
    }
    const timeout = window.setTimeout(finish, milliseconds)
    signal.addEventListener("abort", finish, { once: true })
  })
}

export function AdvocatePublicationControl({
  advocateId,
  slug,
  initialVersion,
  canBeginPublicationCanary,
}: Readonly<{
  advocateId: string
  slug: string
  initialVersion: number
  canBeginPublicationCanary: boolean
}>) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [operation, setOperation] =
    useState<SavedPublicationCanaryOperation | null>(null)
  const operationRef = useRef<SavedPublicationCanaryOperation | null>(null)
  const [resolvedAdvocateId, setResolvedAdvocateId] = useState<string | null>(
    null,
  )
  const [storageAvailable, setStorageAvailable] = useState(false)
  const [phase, setPhase] = useState<PublicationPhase>("idle")
  const [terminalCode, setTerminalCode] = useState<TerminalCode | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [retryRevision, setRetryRevision] = useState(0)

  const storageResolved = resolvedAdvocateId === advocateId
  const storageKey = publicationCanaryOperationStorageKey(advocateId)

  useEffect(() => {
    setResolvedAdvocateId(null)
    setStorageAvailable(false)
    setOperation(null)
    operationRef.current = null
    setPhase("idle")
    setTerminalCode(null)
    setMessage(null)
    setReason("")
    setConfirmation("")

    try {
      const raw = sessionStorage.getItem(
        publicationCanaryOperationStorageKey(advocateId),
      )
      if (raw !== null) {
        const saved = parseSavedPublicationCanaryOperation(JSON.parse(raw))
        if (saved === null || saved.advocateId !== advocateId) {
          sessionStorage.removeItem(
            publicationCanaryOperationStorageKey(advocateId),
          )
        } else {
          operationRef.current = saved
          setOperation(saved)
          setReason(saved.adminReason)
          setPhase("recovering")
        }
      }
      setStorageAvailable(true)
    } catch {
      setMessage(
        "This browser is blocking same-tab recovery storage. Publication cannot start because an uncertain request could not be recovered safely.",
      )
    } finally {
      setResolvedAdvocateId(advocateId)
    }
  }, [advocateId])

  useEffect(() => {
    if (
      !storageResolved ||
      !storageAvailable ||
      operation === null ||
      terminalCode !== null
    ) {
      return
    }

    const controller = new AbortController()
    let activeOperation = operationRef.current ?? operation

    async function run(): Promise<void> {
      setMessage(null)
      setPhase(activeOperation.runId === null ? "recovering" : "pending")

      while (!controller.signal.aborted) {
        const requestController = new AbortController()
        const timeout = window.setTimeout(
          () => requestController.abort(),
          REQUEST_TIMEOUT_MS,
        )
        const stopRequest = () => requestController.abort()
        controller.signal.addEventListener("abort", stopRequest, { once: true })

        let response: Response
        let payload: unknown = null
        try {
          response = await fetch(
            `/api/admin/advocates/${encodeURIComponent(advocateId)}/publish`,
            {
              method: "POST",
              credentials: "same-origin",
              redirect: "error",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                expectedVersion: activeOperation.expectedVersion,
                operationId: activeOperation.operationId,
                adminReason: activeOperation.adminReason,
              }),
              signal: requestController.signal,
            },
          )
          try {
            payload = await response.json()
          } catch (error) {
            if (requestController.signal.aborted) throw error
          }
        } catch {
          if (controller.signal.aborted) return
          setPhase("uncertain")
          setMessage(operationMessage("publication_unavailable"))
          return
        } finally {
          window.clearTimeout(timeout)
          controller.signal.removeEventListener("abort", stopRequest)
        }

        if (controller.signal.aborted) return
        const parsed = parsePublicationCanaryClientResponse(payload, {
          status: response.status,
          operationId: activeOperation.operationId,
          expectedVersion: activeOperation.expectedVersion,
          retryAfterHeader: response.headers.get("retry-after"),
        })
        if (parsed === null) {
          setPhase("uncertain")
          setMessage(operationMessage("publication_unavailable"))
          return
        }

        if (parsed.kind === "failure") {
          if (controller.signal.aborted) return
          setPhase(
            parsed.code === "unauthorized"
              ? "authentication_required"
              : "uncertain",
          )
          setMessage(operationMessage(parsed.code))
          return
        }

        const boundOperation = bindPublicationCanaryRun(
          activeOperation,
          parsed.runId,
        )
        if (controller.signal.aborted) return
        if (
          boundOperation === null ||
          !persistExactOperation(storageKey, boundOperation)
        ) {
          setPhase("uncertain")
          setMessage(
            "The server responded, but this tab could not preserve the exact run binding. The original operation remains authoritative and no replacement was created.",
          )
          return
        }
        activeOperation = boundOperation
        operationRef.current = boundOperation

        if (parsed.kind === "pending") {
          if (controller.signal.aborted) return
          setPhase("pending")
          await waitForRetry(
            parsed.retryAfterSeconds * 1_000,
            controller.signal,
          )
          continue
        }

        if (parsed.kind === "terminal") {
          if (controller.signal.aborted) return
          setTerminalCode(parsed.code)
          setPhase("terminal")
          setMessage(terminalMessage(parsed.code))
          return
        }

        try {
          sessionStorage.removeItem(storageKey)
          if (sessionStorage.getItem(storageKey) !== null) throw new Error()
        } catch {
          setPhase("published")
          setMessage(
            "Publication committed, but this tab could not clear its saved recovery record. No new publication operation can start here. Reload after browser storage is available to replay and clear the exact result safely.",
          )
          router.refresh()
          return
        }
        operationRef.current = null
        setOperation(null)
        setPhase("published")
        setMessage(
          "Publication committed. Refreshing the current portal state.",
        )
        router.refresh()
        return
      }
    }

    void run()
    return () => controller.abort()
  }, [
    advocateId,
    operation,
    retryRevision,
    router,
    storageAvailable,
    storageKey,
    storageResolved,
    terminalCode,
  ])

  const confirmationPhrase = `PUBLISH ${slug}`
  const canStart =
    storageResolved &&
    storageAvailable &&
    operation === null &&
    phase === "idle" &&
    canBeginPublicationCanary &&
    validReason(reason) &&
    confirmation === confirmationPhrase

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canStart) return

    const candidate = parseSavedPublicationCanaryOperation({
      version: 1,
      advocateId,
      operationId: globalThis.crypto.randomUUID(),
      expectedVersion: initialVersion,
      adminReason: reason,
      runId: null,
    })
    if (candidate === null || !persistExactOperation(storageKey, candidate)) {
      setStorageAvailable(false)
      setMessage(
        "This tab could not save and verify the publication operation. No request was sent.",
      )
      return
    }

    operationRef.current = candidate
    setOperation(candidate)
    setConfirmation("")
    setPhase("recovering")
  }

  function retrySavedOperation() {
    if (operation === null || terminalCode !== null) return
    setRetryRevision((value) => value + 1)
  }

  function acknowledgeTerminalResult() {
    if (operationRef.current === null || terminalCode === null) return
    try {
      sessionStorage.removeItem(storageKey)
      if (sessionStorage.getItem(storageKey) !== null) throw new Error()
    } catch {
      setMessage(
        "This tab could not clear the terminal operation. Keep this page open and retry the acknowledgment before starting again.",
      )
      return
    }
    operationRef.current = null
    setOperation(null)
    setTerminalCode(null)
    setPhase("refreshing")
    setReason("")
    setConfirmation("")
    setMessage(
      "The terminal result was acknowledged. Review readiness before starting a fresh publication operation.",
    )
    window.location.reload()
  }

  const operationInProgress = operation !== null

  return (
    <section
      aria-labelledby="advocate-publication-heading"
      className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-6 shadow-sm"
    >
      <h2 id="advocate-publication-heading" className="text-xl font-bold">
        Publish advocate portal
      </h2>
      <p className="mt-2 text-sm text-blue-950">
        Publication runs an independent exact-host release check before the
        portal can become public. The check may take several minutes and will
        survive a timeout, reload, or route transition in this tab.
      </p>

      {operationInProgress ? (
        <div className="mt-4 rounded-md border border-blue-300 bg-white p-4 text-sm text-gray-800">
          <p className="font-semibold">
            {phase === "terminal"
              ? "Publication operation finished"
              : phase === "authentication_required"
                ? "Authentication is required"
                : "Publication operation saved"}
          </p>
          <p className="mt-1">
            The reviewed version and exact administrative reason are locked.
            This tab will never substitute a new operation after an uncertain
            result.
          </p>
          <p className="mt-2 break-words text-gray-600">
            Reason: {operation.adminReason}
          </p>
        </div>
      ) : null}

      {!operationInProgress && canBeginPublicationCanary && phase === "idle" ? (
        <form onSubmit={start} className="mt-5 space-y-4">
          <fieldset disabled={!storageResolved || !storageAvailable}>
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
                className="mt-1 w-full rounded-md border border-blue-300 bg-white px-3 py-2 font-normal"
                placeholder="Record the specific release evidence and approval purpose."
              />
            </label>
            <p className="mt-1 text-xs text-gray-600">
              Do not include sponsor contact, credentials, provider secrets, or
              raw provider responses.
            </p>

            <label className="mt-4 block text-sm font-semibold text-gray-900">
              Type {confirmationPhrase} to confirm
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
                autoComplete="off"
                className="mt-1 w-full rounded-md border border-blue-300 bg-white px-3 py-2 font-normal"
              />
            </label>

            <button
              type="submit"
              disabled={!canStart}
              className="mt-4 min-h-11 rounded-md bg-blue-700 px-4 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Start publication check
            </button>
          </fieldset>
        </form>
      ) : !operationInProgress && phase !== "published" ? (
        <p className="mt-4 text-sm font-semibold text-blue-950">
          A new publication operation is not currently eligible. Complete the
          protected readiness work and refresh this portal.
        </p>
      ) : null}

      {phase === "pending" || phase === "recovering" ? (
        <p className="mt-4 text-sm font-semibold text-blue-950" role="status">
          {phase === "pending"
            ? "The release check is still running. This page is polling the same saved operation."
            : "Recovering the saved publication operation."}
        </p>
      ) : null}

      {message !== null ? (
        <p
          className={`mt-4 text-sm font-semibold ${phase === "published" ? "text-green-800" : "text-blue-950"}`}
          role={phase === "published" ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}

      {(phase === "uncertain" || phase === "authentication_required") &&
      operationInProgress ? (
        <button
          type="button"
          onClick={retrySavedOperation}
          className="mt-4 min-h-11 rounded-md border border-blue-400 bg-white px-4 py-2 text-sm font-semibold text-blue-950 hover:bg-blue-100"
        >
          Retry saved operation
        </button>
      ) : null}

      {phase === "terminal" && terminalCode !== null ? (
        <button
          type="button"
          onClick={acknowledgeTerminalResult}
          className="mt-4 min-h-11 rounded-md border border-blue-400 bg-white px-4 py-2 text-sm font-semibold text-blue-950 hover:bg-blue-100"
        >
          Acknowledge terminal result
        </button>
      ) : null}
    </section>
  )
}
