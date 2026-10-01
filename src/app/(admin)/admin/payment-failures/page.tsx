import Link from "next/link"
import { notFound } from "next/navigation"
import { createClient } from "@/utils/supabase/server"
import { AcknowledgeFailure } from "./AcknowledgeFailure"

export const dynamic = "force-dynamic"

type Failure = {
  event_id: string
  failure_version: string
  provider: string
  account_scope: string
  kind: "quarantined" | "exhausted" | "expired_final_lease"
  received_at: string
  payload_expires_at: string | null
  payload_available: boolean
  acknowledged: boolean
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const labels = { quarantined: "Quarantined", exhausted: "Retries exhausted", expired_final_lease: "Final processing attempt expired" }
const timestamp = (value: string) => new Date(value).toISOString().replace("T", " ").replace(".000Z", " UTC")

export default async function PaymentFailuresPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const query = await searchParams
  if (Object.keys(query).some(key => key !== "cursor") ||
      (query.cursor !== undefined && (typeof query.cursor !== "string" || !UUID.test(query.cursor)))) notFound()
  const client = await createClient({ requestTimeoutMilliseconds: 15_000 })
  const { data, error } = await client.rpc("list_payment_failures", { after_event_id: query.cursor ?? null })
  if (error?.code === "42501") notFound()
  const valid = !error && data && Array.isArray(data.items) && data.items.length <= 100 &&
    (data.next_cursor === null || (typeof data.next_cursor === "string" && UUID.test(data.next_cursor))) &&
    data.items.every((item: Failure) => item && typeof item.event_id === "string" && UUID.test(item.event_id) &&
      typeof item.failure_version === "string" && /^[a-f0-9]{64}$/.test(item.failure_version) &&
      Object.hasOwn(labels, item.kind) && typeof item.provider === "string" && typeof item.account_scope === "string" &&
      typeof item.acknowledged === "boolean" && typeof item.payload_available === "boolean" &&
      typeof item.received_at === "string" && Number.isFinite(Date.parse(item.received_at)) &&
      (item.payload_expires_at === null || (typeof item.payload_expires_at === "string" && Number.isFinite(Date.parse(item.payload_expires_at)))))
  return <main className="max-w-4xl mx-auto p-6 space-y-6">
    <Link href="/admin">Administration</Link>
    <h1 className="text-2xl font-semibold">Unresolved payment failures</h1>
    <p>Acknowledgment stops repeat failure paging. It does not resolve a failure, retry a payment, change billing, or extend retained evidence. A later failure requires a new acknowledgment.</p>
    {!valid ? <p role="alert">Payment failure inventory is unavailable. Refresh to try again.</p> : <>
      {data.items.length === 0 && <p>No unresolved failures on this page.</p>}
      <ul className="space-y-6">{data.items.map((item: Failure) => <li key={`${item.event_id}:${item.failure_version}`} className="border rounded p-4 space-y-3">
        <h2 className="font-semibold">{labels[item.kind]}: {item.provider} / {item.account_scope}</h2>
        <p>Received {timestamp(item.received_at)}</p>
        <p>{item.payload_available
          ? `Recovery evidence retained${item.payload_expires_at ? ` until ${timestamp(item.payload_expires_at)}` : ""}.`
          : "Encrypted payload unavailable. Recovery requires separately verified provider evidence."}</p>
        {item.acknowledged ? <p>Acknowledged. Still unresolved.</p> : <AcknowledgeFailure eventId={item.event_id} failureVersion={item.failure_version} />}
      </li>)}</ul>
      {data.next_cursor && <Link href={`/admin/payment-failures?cursor=${encodeURIComponent(data.next_cursor)}`}>Next page</Link>}
      {query.cursor && <Link className="block" href="/admin/payment-failures">Return to first page</Link>}
    </>}
  </main>
}
