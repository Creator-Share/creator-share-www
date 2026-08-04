"use client"

import { FormEvent, useState } from "react"

import {
  ADVOCATE_DELEGATE_ROLE_KEYS,
  type AdvocateDelegateRoleKey,
} from "@/lib/advocates/admin/teamContracts"
import {
  type AdvocatePendingInvitation,
  parseAdvocatePendingInvitationApi,
} from "@/lib/advocates/invitations/administrationContracts"

const ROLE_LABELS: Readonly<Record<AdvocateDelegateRoleKey, string>> =
  Object.freeze({
    administrator: "Administrator",
    analytics_viewer: "Analytics viewer",
    audit_viewer: "Audit viewer",
    brand_editor: "Brand editor",
    catalog_curator: "Catalog curator",
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function invitationErrorMessage(code: unknown): string {
  switch (code) {
    case "invitation_conflict":
      return "That person already has access, or this request changed while it was being retried."
    case "permission_changed":
    case "forbidden":
      return "Your invitation permission changed. Refresh the page."
    case "lifecycle_conflict":
      return "This portal is not currently accepting team invitations."
    case "invalid_request":
      return "Review the email, roles, and reason, then try again."
    default:
      return "The invitation could not be queued. Try again with the same form."
  }
}

async function decodeJson(
  response: Response,
): Promise<Record<string, unknown>> {
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!isRecord(payload)) throw new Error("invitation_failed")
  return payload
}

function PendingInvitationCard({
  slug,
  invitation,
  canInvite,
  onRevoked,
}: {
  slug: string
  invitation: AdvocatePendingInvitation
  canInvite: boolean
  onRevoked(invitationId: string): void
}) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function revoke(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reason.trim().length < 1) return

    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(slug)}/team/invitations/${encodeURIComponent(invitation.invitationId)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      )
      const payload = await decodeJson(response)
      if (!response.ok || payload.ok !== true) {
        throw new Error(
          typeof payload.code === "string"
            ? payload.code
            : "invitation_revoke_failed",
        )
      }
      onRevoked(invitation.invitationId)
    } catch (error) {
      setMessage(
        invitationErrorMessage(
          error instanceof Error ? error.message : undefined,
        ),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="rounded-lg border border-gray-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-950">
            {invitation.invitedEmail}
          </h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {invitation.roleKeys.map((role) => (
              <span
                key={role}
                className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-800"
              >
                {ROLE_LABELS[role]}
              </span>
            ))}
          </div>
        </div>
        <span
          className={
            invitation.status === "pending"
              ? "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900"
              : "rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-800"
          }
        >
          {invitation.status === "pending" ? "Pending" : "Expired"}
        </span>
      </div>
      <p className="mt-3 text-sm text-gray-600">
        {invitation.status === "pending" ? "Expires" : "Expired"}{" "}
        <time dateTime={invitation.expiresAt}>
          {invitation.expiresAt.slice(0, 10)}
        </time>
        .
      </p>

      {canInvite ? (
        <form onSubmit={revoke} className="mt-4 border-t border-gray-100 pt-4">
          <label className="block text-sm font-medium text-gray-800">
            Reason for revoking this invitation
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={2_000}
              rows={2}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={busy || reason.trim().length < 1}
            className="mt-3 min-h-11 rounded-md border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
          >
            {busy ? "Revoking invitation" : "Revoke invitation"}
          </button>
          {message ? (
            <p role="status" className="mt-3 text-sm font-medium text-red-800">
              {message}
            </p>
          ) : null}
        </form>
      ) : null}
    </article>
  )
}

export function InvitationSettingsClient({
  slug,
  initialInvitations,
  canInvite,
}: {
  slug: string
  initialInvitations: readonly AdvocatePendingInvitation[]
  canInvite: boolean
}) {
  const [invitations, setInvitations] =
    useState<readonly AdvocatePendingInvitation[]>(initialInvitations)
  const [email, setEmail] = useState("")
  const [selectedRoles, setSelectedRoles] = useState<
    readonly AdvocateDelegateRoleKey[]
  >(["analytics_viewer"])
  const [reason, setReason] = useState("")
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)

  function invalidatePendingRequest() {
    setIdempotencyKey(null)
    setMessage(null)
  }

  function toggleRole(role: AdvocateDelegateRoleKey) {
    invalidatePendingRequest()
    setSelectedRoles((current) =>
      current.includes(role)
        ? current.filter((candidate) => candidate !== role)
        : [...current, role].sort(),
    )
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (
      email.trim().length < 3 ||
      selectedRoles.length < 1 ||
      reason.trim().length < 1
    ) {
      return
    }

    const requestKey = idempotencyKey ?? crypto.randomUUID()
    setIdempotencyKey(requestKey)
    setBusy(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(slug)}/team/invitations`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: email.trim(),
            roleKeys: selectedRoles,
            reason: reason.trim(),
            idempotencyKey: requestKey,
          }),
        },
      )
      const payload = await decodeJson(response)
      const invitation = parseAdvocatePendingInvitationApi(payload.invitation)
      if (!response.ok || payload.ok !== true || invitation === null) {
        throw new Error(
          typeof payload.code === "string" ? payload.code : "invitation_failed",
        )
      }

      setInvitations((current) => [
        invitation,
        ...current.filter(
          (candidate) =>
            candidate.invitationId !== invitation.invitationId &&
            candidate.invitedEmail !== invitation.invitedEmail,
        ),
      ])
      setEmail("")
      setSelectedRoles(["analytics_viewer"])
      setReason("")
      setIdempotencyKey(null)
      setMessage({
        kind: "success",
        text: "Invitation queued. Secure email delivery may take a moment.",
      })
    } catch (error) {
      setMessage({
        kind: "error",
        text: invitationErrorMessage(
          error instanceof Error ? error.message : undefined,
        ),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="invitations-heading" className="mt-6">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="invitations-heading" className="text-2xl font-bold">
          Team invitations
        </h2>
        <p className="mt-2 max-w-3xl text-gray-600">
          Invitations are single use and remain pending for seven days. The
          secure email sign-in proof is intentionally shorter lived. Send a new
          invitation if that proof expires.
        </p>

        {canInvite ? (
          <form onSubmit={issue} className="mt-6 grid gap-5 lg:grid-cols-2">
            <label className="block text-sm font-medium text-gray-800">
              Email address
              <input
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                  invalidatePendingRequest()
                }}
                maxLength={320}
                autoComplete="email"
                required
                className="mt-1 block min-h-11 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <fieldset>
              <legend className="text-sm font-semibold text-gray-900">
                Access roles
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {ADVOCATE_DELEGATE_ROLE_KEYS.map((role) => (
                  <label
                    key={role}
                    className="flex min-h-11 items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(role)}
                      onChange={() => toggleRole(role)}
                      className="h-4 w-4"
                    />
                    <span>{ROLE_LABELS[role]}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block text-sm font-medium text-gray-800 lg:col-span-2">
              Reason for access
              <textarea
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  invalidatePendingRequest()
                }}
                maxLength={2_000}
                rows={2}
                required
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <div className="lg:col-span-2">
              <button
                type="submit"
                disabled={
                  busy ||
                  email.trim().length < 3 ||
                  selectedRoles.length < 1 ||
                  reason.trim().length < 1
                }
                className="min-h-11 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
              >
                {busy ? "Queuing invitation" : "Send invitation"}
              </button>
              {message ? (
                <p
                  role="status"
                  className={
                    message.kind === "error"
                      ? "mt-3 text-sm font-medium text-red-800"
                      : "mt-3 text-sm font-medium text-green-800"
                  }
                >
                  {message.text}
                </p>
              ) : null}
            </div>
          </form>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4">
        {invitations.length === 0 ? (
          <p className="rounded-xl border border-gray-200 bg-white p-5 text-gray-600 shadow-sm">
            No invitations are pending.
          </p>
        ) : (
          invitations.map((invitation) => (
            <PendingInvitationCard
              key={invitation.invitationId}
              slug={slug}
              invitation={invitation}
              canInvite={canInvite}
              onRevoked={(invitationId) =>
                setInvitations((current) =>
                  current.filter(
                    (candidate) => candidate.invitationId !== invitationId,
                  ),
                )
              }
            />
          ))
        )}
      </div>
    </section>
  )
}
