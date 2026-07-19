"use client"

import { useEffect, useState } from "react"

import { AdvocateInitialOwnerRecovery } from "@/components/advocates/creatorShareAdmin/AdvocateInitialOwnerRecovery"
import { AdvocateInitialOwnerRevocation } from "@/components/advocates/creatorShareAdmin/AdvocateInitialOwnerRevocation"
import {
  initialOwnerClientOperationStorageKey,
  parseSavedInitialOwnerClientOperation,
  type InitialOwnerClientOperationKind,
} from "@/lib/advocates/creatorShareAdmin/initialOwnerClientOperation"

type InitialOwnerControlMode =
  InitialOwnerClientOperationKind | "pending" | "resolving"

function preferredMode(
  canReissueInitialOwner: boolean,
  canRevokeInitialOwner: boolean,
): InitialOwnerControlMode {
  if (canReissueInitialOwner) return "reissue"
  if (canRevokeInitialOwner) return "revoke"
  return "pending"
}

function hasSavedOperation(
  kind: InitialOwnerClientOperationKind,
  advocateId: string,
): boolean {
  try {
    const raw = sessionStorage.getItem(
      initialOwnerClientOperationStorageKey(kind, advocateId),
    )
    if (raw === null) return false
    const saved = parseSavedInitialOwnerClientOperation(JSON.parse(raw))
    return saved !== null && saved.advocateId === advocateId
  } catch {
    return false
  }
}

export function AdvocateInitialOwnerControls({
  advocateId,
  slug,
  initialVersion,
  canReissueInitialOwner,
  canRevokeInitialOwner,
}: Readonly<{
  advocateId: string
  slug: string
  initialVersion: number
  canReissueInitialOwner: boolean
  canRevokeInitialOwner: boolean
}>) {
  const preferred = preferredMode(canReissueInitialOwner, canRevokeInitialOwner)
  const [mode, setMode] = useState<InitialOwnerControlMode>("resolving")
  const [resolutionRevision, setResolutionRevision] = useState(0)
  const resolutionContextKey = `${advocateId}:${initialVersion}:${canReissueInitialOwner ? 1 : 0}:${canRevokeInitialOwner ? 1 : 0}:${resolutionRevision}`
  const [resolvedContextKey, setResolvedContextKey] = useState<string | null>(
    null,
  )

  useEffect(() => {
    setMode("resolving")
    if (hasSavedOperation("reissue", advocateId)) {
      setMode("reissue")
      setResolvedContextKey(resolutionContextKey)
      return
    }
    if (hasSavedOperation("revoke", advocateId)) {
      setMode("revoke")
      setResolvedContextKey(resolutionContextKey)
      return
    }
    setMode(preferred)
    setResolvedContextKey(resolutionContextKey)
  }, [advocateId, preferred, resolutionContextKey])

  function resolveRemainingOperations() {
    setMode("resolving")
    setResolutionRevision((revision) => revision + 1)
  }

  if (mode === "resolving" || resolvedContextKey !== resolutionContextKey) {
    return (
      <section
        aria-labelledby="initial-owner-resolving-heading"
        aria-busy="true"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 id="initial-owner-resolving-heading" className="text-xl font-bold">
          Resolving initial owner controls
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Checking for an unresolved administrative operation before enabling
          another action.
        </p>
      </section>
    )
  }

  if (mode === "reissue") {
    return (
      <AdvocateInitialOwnerRecovery
        advocateId={advocateId}
        slug={slug}
        initialVersion={initialVersion}
        canStartNewOperation={canReissueInitialOwner}
        onOperationDiscarded={resolveRemainingOperations}
        onOperationCompleted={resolveRemainingOperations}
      />
    )
  }

  if (mode === "revoke") {
    return (
      <AdvocateInitialOwnerRevocation
        advocateId={advocateId}
        slug={slug}
        initialVersion={initialVersion}
        canStartNewOperation={canRevokeInitialOwner}
        onOperationDiscarded={resolveRemainingOperations}
        onOperationCompleted={resolveRemainingOperations}
      />
    )
  }

  return (
    <section
      aria-labelledby="initial-owner-pending-heading"
      className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm"
    >
      <h2 id="initial-owner-pending-heading" className="text-xl font-bold">
        Initial owner invitation pending
      </h2>
      <p className="mt-2 text-sm text-amber-950">
        The current invitation is not eligible for reissue or revocation.
        Ownership transfer and owner-only lifecycle controls remain unavailable
        until secure acceptance completes.
      </p>
    </section>
  )
}
