"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

export function AcknowledgeFailure({ eventId, failureVersion }: { eventId: string; failureVersion: string }) {
  const labelId = useId()
  const router = useRouter()
  const [reason, setReason] = useState("investigating")
  const [pending, setPending] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState("")
  async function acknowledge() {
    if (pending || acknowledged) return
    setPending(true)
    setError("")
    try {
      const response = await fetch("/api/admin/payment-failures/acknowledge", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId, failureVersion, reason }), signal: AbortSignal.timeout(25_000),
      })
      const result = await response.json()
      if (!response.ok || result.acknowledged !== true || result.resolved !== false) {
        throw new Error(response.status === 409 ? "This failure changed. Refresh before acknowledging it." : "Unable to confirm acknowledgment. Refresh to check its status.")
      }
      setAcknowledged(true)
      router.refresh()
    } catch (failure) {
      setError(failure instanceof Error && failure.name === "Error" ? failure.message : "Unable to confirm acknowledgment. Refresh to check its status.")
    } finally { setPending(false) }
  }
  if (acknowledged) return <p role="status">Acknowledged. Still unresolved.</p>
  return <div className="flex flex-col gap-2">
    <label htmlFor={labelId}>Review status</label>
    <select id={labelId} value={reason} onChange={event => setReason(event.target.value)} disabled={pending} className="border rounded p-2">
      <option value="investigating">Investigating</option>
      <option value="awaiting_provider">Awaiting provider</option>
      <option value="awaiting_repair">Awaiting repair</option>
    </select>
    <button type="button" onClick={acknowledge} disabled={pending} className="border rounded p-2 disabled:opacity-50">
      {pending ? "Acknowledging..." : "Acknowledge and stop repeat paging"}
    </button>
    {error && <p role="alert">{error}</p>}
  </div>
}
