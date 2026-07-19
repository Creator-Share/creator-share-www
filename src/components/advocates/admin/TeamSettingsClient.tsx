"use client"

import { FormEvent, useEffect, useState } from "react"

import {
  ADVOCATE_DELEGATE_ROLE_KEYS,
  type AdvocateDelegateRoleKey,
  type AdvocateMembershipStatus,
  type AdvocateTeamMember,
} from "@/lib/advocates/admin/teamContracts"

const ROLE_LABELS: Readonly<Record<"owner" | AdvocateDelegateRoleKey, string>> =
  Object.freeze({
    owner: "Owner",
    administrator: "Administrator",
    brand_editor: "Brand editor",
    catalog_curator: "Catalog curator",
    analytics_viewer: "Analytics viewer",
    audit_viewer: "Audit viewer",
  })

function statusLabel(status: AdvocateMembershipStatus): string {
  return status.slice(0, 1).toUpperCase() + status.slice(1)
}

function mutationErrorMessage(code: unknown): string {
  switch (code) {
    case "version_conflict":
      return "This team member changed in another session. Refresh and try again."
    case "permission_changed":
      return "Your team management permission changed. Refresh the page."
    case "lifecycle_conflict":
      return "That change is no longer allowed for this team member."
    case "invalid_request":
      return "Review the selected access and reason, then try again."
    default:
      return "The team change could not be saved. Try again."
  }
}

async function submitMemberMutation(options: {
  slug: string
  membershipId: string
  body: Record<string, unknown>
}): Promise<number> {
  const response = await fetch(
    `/api/portal/${encodeURIComponent(options.slug)}/team/members/${encodeURIComponent(options.membershipId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    },
  )

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("team_update_failed")
  }
  const value = payload as Record<string, unknown>
  if (
    !response.ok ||
    value.ok !== true ||
    typeof value.membershipVersion !== "number" ||
    !Number.isSafeInteger(value.membershipVersion) ||
    value.membershipVersion < 1
  ) {
    throw new Error(
      typeof value.code === "string" ? value.code : "team_update_failed",
    )
  }
  return value.membershipVersion
}

function TeamMemberControls({
  slug,
  member,
  onChange,
}: {
  slug: string
  member: AdvocateTeamMember
  onChange(member: AdvocateTeamMember): void
}) {
  const [selectedRoles, setSelectedRoles] = useState<
    readonly AdvocateDelegateRoleKey[]
  >(() =>
    member.roleKeys.filter(
      (role): role is AdvocateDelegateRoleKey => role !== "owner",
    ),
  )
  const [roleReason, setRoleReason] = useState("")
  const [statusReason, setStatusReason] = useState("")
  const [targetStatus, setTargetStatus] =
    useState<AdvocateMembershipStatus | null>(
      member.status === "active"
        ? "suspended"
        : member.status === "suspended"
          ? "active"
          : null,
    )
  const [busyAction, setBusyAction] = useState<"roles" | "status" | null>(null)
  const [message, setMessage] = useState<{
    kind: "success" | "error"
    text: string
  } | null>(null)

  useEffect(() => {
    setSelectedRoles(
      member.roleKeys.filter(
        (role): role is AdvocateDelegateRoleKey => role !== "owner",
      ),
    )
  }, [member.roleKeys, member.version])

  function toggleRole(role: AdvocateDelegateRoleKey) {
    setSelectedRoles((current) =>
      current.includes(role)
        ? current.filter((candidate) => candidate !== role)
        : [...current, role].sort(),
    )
  }

  async function saveRoles(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedRoles.length < 1 || roleReason.trim().length < 1) return

    setBusyAction("roles")
    setMessage(null)
    try {
      const version = await submitMemberMutation({
        slug,
        membershipId: member.membershipId,
        body: {
          action: "replace_roles",
          expectedVersion: member.version,
          roleKeys: selectedRoles,
          reason: roleReason.trim(),
        },
      })
      onChange({ ...member, roleKeys: selectedRoles, version })
      setRoleReason("")
      setMessage({ kind: "success", text: "Access roles updated." })
    } catch (error) {
      setMessage({
        kind: "error",
        text: mutationErrorMessage(
          error instanceof Error ? error.message : undefined,
        ),
      })
    } finally {
      setBusyAction(null)
    }
  }

  async function saveStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (targetStatus === null || statusReason.trim().length < 1) return

    setBusyAction("status")
    setMessage(null)
    try {
      const version = await submitMemberMutation({
        slug,
        membershipId: member.membershipId,
        body: {
          action: "change_status",
          expectedVersion: member.version,
          status: targetStatus,
          reason: statusReason.trim(),
        },
      })
      onChange({ ...member, status: targetStatus, version })
      setStatusReason("")
      setTargetStatus(
        targetStatus === "active"
          ? "suspended"
          : targetStatus === "suspended"
            ? "active"
            : null,
      )
      setMessage({
        kind: "success",
        text:
          targetStatus === "active"
            ? "Team member reactivated."
            : targetStatus === "suspended"
              ? "Team member suspended."
              : "Team member revoked.",
      })
    } catch (error) {
      setMessage({
        kind: "error",
        text: mutationErrorMessage(
          error instanceof Error ? error.message : undefined,
        ),
      })
    } finally {
      setBusyAction(null)
    }
  }

  if (member.status === "revoked") {
    return (
      <p className="mt-4 text-sm text-gray-600">
        Revoked access can be restored only through a fresh invitation.
      </p>
    )
  }

  return (
    <div className="mt-5 grid gap-5 border-t border-gray-100 pt-5 xl:grid-cols-2">
      <form onSubmit={saveRoles}>
        <fieldset disabled={busyAction !== null}>
          <legend className="text-sm font-semibold text-gray-900">
            Access roles
          </legend>
          <div className="mt-3 grid gap-2">
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
          <label className="mt-3 block text-sm font-medium text-gray-800">
            Reason for role change
            <textarea
              value={roleReason}
              onChange={(event) => setRoleReason(event.target.value)}
              maxLength={2_000}
              rows={2}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={
              busyAction !== null ||
              selectedRoles.length < 1 ||
              roleReason.trim().length < 1
            }
            className="mt-3 min-h-11 rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {busyAction === "roles" ? "Saving roles" : "Save roles"}
          </button>
        </fieldset>
      </form>

      <form onSubmit={saveStatus}>
        <fieldset disabled={busyAction !== null || targetStatus === null}>
          <legend className="text-sm font-semibold text-gray-900">
            Access status
          </legend>
          <label className="mt-3 block text-sm font-medium text-gray-800">
            New status
            <select
              value={targetStatus ?? ""}
              onChange={(event) =>
                setTargetStatus(event.target.value as AdvocateMembershipStatus)
              }
              className="mt-1 block min-h-11 w-full rounded-md border border-gray-300 px-3 py-2"
            >
              {member.status === "active" ? (
                <option value="suspended">Suspended</option>
              ) : (
                <option value="active">Active</option>
              )}
              <option value="revoked">Revoked</option>
            </select>
          </label>
          <label className="mt-3 block text-sm font-medium text-gray-800">
            Reason for status change
            <textarea
              value={statusReason}
              onChange={(event) => setStatusReason(event.target.value)}
              maxLength={2_000}
              rows={2}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={
              busyAction !== null ||
              targetStatus === null ||
              statusReason.trim().length < 1
            }
            className="mt-3 min-h-11 rounded-md border border-red-700 px-4 py-2 text-sm font-semibold text-red-800 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
          >
            {busyAction === "status" ? "Saving status" : "Save status"}
          </button>
        </fieldset>
      </form>

      {message ? (
        <p
          role="status"
          className={
            message.kind === "error"
              ? "text-sm font-medium text-red-800 xl:col-span-2"
              : "text-sm font-medium text-green-800 xl:col-span-2"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  )
}

export function TeamSettingsClient({
  slug,
  initialMembers,
  canManage,
}: {
  slug: string
  initialMembers: readonly AdvocateTeamMember[]
  canManage: boolean
}) {
  const [members, setMembers] =
    useState<readonly AdvocateTeamMember[]>(initialMembers)

  function updateMember(updated: AdvocateTeamMember) {
    setMembers((current) =>
      current.map((member) =>
        member.membershipId === updated.membershipId ? updated : member,
      ),
    )
  }

  return (
    <section aria-labelledby="team-heading">
      <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="team-heading" className="text-2xl font-bold">
          Team access
        </h2>
        <p className="mt-2 max-w-3xl text-gray-600">
          Delegate access is permission based and takes effect immediately.
          Suspended and revoked members cannot open this portal.
        </p>
      </div>

      <div className="mt-6 grid gap-4">
        {members.map((member) => (
          <article
            key={member.membershipId}
            className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-950">
                  {member.displayName}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  {member.roleKeys.map((role) => (
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
                  member.status === "active"
                    ? "rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-900"
                    : member.status === "suspended"
                      ? "rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900"
                      : "rounded-full bg-gray-200 px-3 py-1 text-xs font-semibold text-gray-800"
                }
              >
                {statusLabel(member.status)}
              </span>
            </div>

            {member.isOwner ? (
              <p className="mt-4 text-sm text-gray-600">
                Ownership is managed through the separate ownership transfer
                process.
              </p>
            ) : canManage ? (
              <TeamMemberControls
                slug={slug}
                member={member}
                onChange={updateMember}
              />
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
}
