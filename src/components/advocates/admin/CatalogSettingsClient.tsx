"use client"

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import {
  advocateCatalogFingerprint,
  isValidAdvocateCatalogConfiguration,
  moveAdvocateCatalogSelection,
  parseAdvocateCatalogDraft,
  parseAdvocateCatalogSaveResponse,
  selectionsForAdvocateCatalogMode,
  type AdvocateCatalogChoice,
  type AdvocateCatalogMode,
  type AdvocateCatalogSelection,
} from "@/lib/advocates/admin/catalogForm"

export interface AdvocateCatalogSettingsViewModel {
  advocateId: string
  actorUserId: string
  slug: string
  displayName: string
  advocateVersion: number
  mode: AdvocateCatalogMode
  selections: readonly AdvocateCatalogSelection[]
  beneficiaries: readonly AdvocateCatalogChoice[]
  selectionLimit: number
}

type SaveMessage = Readonly<{
  kind: "success" | "error"
  text: string
}> | null

type PendingNavigation = Readonly<{
  href: string
  label: string
}>

interface CatalogNavigationDestination {
  readonly url: string
}

interface CatalogNavigateEvent extends Event {
  readonly destination: CatalogNavigationDestination
  readonly navigationType: "push" | "reload" | "replace" | "traverse"
}

function getBrowserNavigation(): EventTarget | null {
  if (!("navigation" in window)) return null
  return (window as Window & { navigation?: EventTarget }).navigation ?? null
}

function isAppleWebKitBrowser(): boolean {
  return (
    navigator.userAgent.includes("AppleWebKit") &&
    !/(?:Chrome|Chromium|Edg|OPR)\//.test(navigator.userAgent)
  )
}

function persistCatalogDraft(
  storageKey: string,
  serializedDraft: string | null,
): boolean {
  try {
    if (serializedDraft === null) {
      window.sessionStorage.removeItem(storageKey)
    } else {
      window.sessionStorage.setItem(storageKey, serializedDraft)
    }
    return true
  } catch {
    return false
  }
}

const MODE_OPTIONS: readonly Readonly<{
  value: AdvocateCatalogMode
  label: string
  description: string
}>[] = Object.freeze([
  {
    value: "all",
    label: "Show every eligible child",
    description:
      "The portal follows the complete Creator Share catalog automatically.",
  },
  {
    value: "all_featured",
    label: "Show every child and feature chosen children",
    description:
      "Every eligible child remains available, while your chosen children appear first.",
  },
  {
    value: "selected",
    label: "Show only chosen children",
    description:
      "The portal contains only your ordered selection. Any chosen child may also be featured.",
  },
])

function freezeSelections(
  selections: readonly AdvocateCatalogSelection[],
): readonly AdvocateCatalogSelection[] {
  return Object.freeze(
    selections.map((selection) => Object.freeze({ ...selection })),
  )
}

export function advocateCatalogChoiceLabel(
  choice: AdvocateCatalogChoice,
): string {
  return choice.name ?? `Unavailable selection ${choice.id.slice(-12)}`
}

function catalogMutationErrorMessage(code: string): string {
  switch (code) {
    case "version_conflict":
      return "These catalog settings changed in another session. Reload the latest settings before making another change."
    case "no_change":
      return "That catalog configuration is already saved. No change was made."
    case "eligibility_changed":
      return "A chosen child is no longer eligible for a new sponsorship. Reload the latest catalog before saving."
    case "forbidden":
      return "Your catalog permission changed. Reload the page or contact a portal administrator."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "unauthorized":
      return "Your session expired. Sign in again before saving."
    case "invalid_request":
      return "Review the catalog selection and change note, then try again."
    default:
      return "The child catalog could not be saved. Try again."
  }
}

export function CatalogSettingsClient({
  settings,
}: {
  settings: AdvocateCatalogSettingsViewModel
}) {
  const [advocateVersion, setAdvocateVersion] = useState(
    settings.advocateVersion,
  )
  const [savedMode, setSavedMode] = useState(settings.mode)
  const [savedSelections, setSavedSelections] = useState<
    readonly AdvocateCatalogSelection[]
  >(() => freezeSelections(settings.selections))
  const [mode, setMode] = useState(settings.mode)
  const [selections, setSelections] = useState<
    readonly AdvocateCatalogSelection[]
  >(() => freezeSelections(settings.selections))
  const [query, setQuery] = useState("")
  const [changeReason, setChangeReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [staleLocked, setStaleLocked] = useState(false)
  const [message, setMessage] = useState<SaveMessage>(null)
  const [draftHydrated, setDraftHydrated] = useState(false)
  const [draftPersistenceAvailable, setDraftPersistenceAvailable] = useState<
    boolean | null
  >(null)
  const [catalogAnnouncement, setCatalogAnnouncement] = useState({
    sequence: 0,
    text: "",
  })
  const [pendingNavigation, setPendingNavigation] =
    useState<PendingNavigation | null>(null)
  const pendingNavigationFocus = useRef<HTMLElement | null>(null)
  const pendingLinkAnchor = useRef<HTMLAnchorElement | null>(null)
  const linkNavigationBypass = useRef<HTMLAnchorElement | null>(null)
  const allowPageUnload = useRef(false)
  const navigationDialogOpen = useRef(false)
  const removeButtons = useRef(new Map<string, HTMLButtonElement>())
  const beneficiarySearch = useRef<HTMLInputElement | null>(null)
  const catalogHeading = useRef<HTMLHeadingElement | null>(null)
  const navigationDialog = useRef<HTMLDialogElement | null>(null)
  const stayButton = useRef<HTMLButtonElement | null>(null)
  const discardButton = useRef<HTMLButtonElement | null>(null)
  const saveInFlight = useRef(false)
  const latestSerializedDraft = useRef<string | null>(null)

  const choiceById = useMemo(
    () => new Map(settings.beneficiaries.map((choice) => [choice.id, choice])),
    [settings.beneficiaries],
  )
  const allowedBeneficiaryIds = useMemo(
    () => new Set(choiceById.keys()),
    [choiceById],
  )
  const canonicalSelections = useMemo(
    () => selectionsForAdvocateCatalogMode(mode, selections),
    [mode, selections],
  )
  const selectedIds = useMemo(
    () => new Set(selections.map((selection) => selection.beneficiaryId)),
    [selections],
  )
  const normalizedQuery = query.trim().toLocaleLowerCase("en")
  const matchingChoices = useMemo(
    () =>
      settings.beneficiaries.filter(
        (choice) =>
          choice.eligible &&
          !selectedIds.has(choice.id) &&
          (normalizedQuery.length === 0 ||
            (choice.name ?? "")
              .toLocaleLowerCase("en")
              .includes(normalizedQuery) ||
            (choice.username ?? "")
              .toLocaleLowerCase("en")
              .includes(normalizedQuery)),
      ),
    [normalizedQuery, selectedIds, settings.beneficiaries],
  )
  const visibleChoices = matchingChoices.slice(0, 100)
  const ineligibleSelections = canonicalSelections.filter(
    (selection) => choiceById.get(selection.beneficiaryId)?.eligible !== true,
  )
  const validConfiguration = isValidAdvocateCatalogConfiguration(
    mode,
    canonicalSelections,
  )
  const savedFingerprint = advocateCatalogFingerprint(
    savedMode,
    savedSelections,
  )
  const dirty =
    advocateCatalogFingerprint(mode, canonicalSelections) !== savedFingerprint
  const draftStorageKey = `creator-share:advocate-catalog-draft:v2:${settings.actorUserId}:${settings.advocateId}:${encodeURIComponent(settings.slug)}`
  const normalizedReason = changeReason.trim()
  const canSubmit =
    dirty &&
    validConfiguration &&
    ineligibleSelections.length === 0 &&
    normalizedReason.length >= 1 &&
    normalizedReason.length <= 500 &&
    !saving &&
    !staleLocked
  function serializeDraft(
    nextMode: AdvocateCatalogMode,
    nextSelections: readonly AdvocateCatalogSelection[],
    nextChangeReason: string,
  ): string | null {
    const nextCanonicalSelections = selectionsForAdvocateCatalogMode(
      nextMode,
      nextSelections,
    )
    if (
      advocateCatalogFingerprint(nextMode, nextCanonicalSelections) ===
      savedFingerprint
    ) {
      return null
    }
    return JSON.stringify({
      schemaVersion: 2,
      advocateId: settings.advocateId,
      actorUserId: settings.actorUserId,
      advocateVersion,
      savedFingerprint,
      mode: nextMode,
      selections: nextCanonicalSelections,
      changeReason: nextChangeReason,
    })
  }
  const serializedDraft = serializeDraft(mode, selections, changeReason)
  latestSerializedDraft.current = serializedDraft

  function persistLatestCatalogDraft(
    nextMode: AdvocateCatalogMode,
    nextSelections: readonly AdvocateCatalogSelection[],
    nextChangeReason: string,
  ) {
    const nextSerializedDraft = serializeDraft(
      nextMode,
      nextSelections,
      nextChangeReason,
    )
    latestSerializedDraft.current = nextSerializedDraft
    if (!persistCatalogDraft(draftStorageKey, nextSerializedDraft)) {
      setDraftPersistenceAvailable(false)
    }
  }

  const clearCatalogDraft = useCallback(() => {
    latestSerializedDraft.current = null
    if (!persistCatalogDraft(draftStorageKey, null)) {
      setDraftPersistenceAvailable(false)
    }
  }, [draftStorageKey])

  const discardUnsavedCatalog = useCallback(() => {
    setMode(savedMode)
    setSelections(freezeSelections(savedSelections))
    setChangeReason("")
    setMessage(null)
    clearCatalogDraft()
  }, [clearCatalogDraft, savedMode, savedSelections])

  useEffect(() => {
    try {
      const serializedDraft = window.sessionStorage.getItem(draftStorageKey)
      if (serializedDraft !== null) {
        let rawDraft: unknown = null
        try {
          rawDraft = JSON.parse(serializedDraft) as unknown
        } catch {
          rawDraft = null
        }
        const draft = parseAdvocateCatalogDraft(rawDraft, {
          advocateId: settings.advocateId,
          actorUserId: settings.actorUserId,
          advocateVersion,
          savedFingerprint,
          allowedBeneficiaryIds,
          selectionLimit: settings.selectionLimit,
        })
        if (draft === null) {
          window.sessionStorage.removeItem(draftStorageKey)
        } else {
          setMode(draft.mode)
          setSelections(freezeSelections(draft.selections))
          setChangeReason(draft.changeReason)
          setMessage({
            kind: "success",
            text: "Recovered unsaved catalog changes from this browser tab. Review and save them, or reset to the saved catalog.",
          })
        }
      }
      setDraftPersistenceAvailable(true)
    } catch {
      // A blocked or malformed session store is treated as no recoverable draft.
      setDraftPersistenceAvailable(false)
    } finally {
      setDraftHydrated(true)
    }
  }, [
    allowedBeneficiaryIds,
    draftStorageKey,
    savedFingerprint,
    advocateVersion,
    settings.actorUserId,
    settings.advocateId,
    settings.selectionLimit,
  ])

  useEffect(() => {
    if (!draftHydrated) return
    setDraftPersistenceAvailable(
      persistCatalogDraft(draftStorageKey, serializedDraft),
    )
  }, [draftHydrated, draftStorageKey, serializedDraft])

  useEffect(() => {
    if (!draftHydrated) return

    const flushLatestDraft = () => {
      const persisted = persistCatalogDraft(
        draftStorageKey,
        latestSerializedDraft.current,
      )
      if (!persisted) setDraftPersistenceAvailable(false)
    }
    const flushHiddenDraft = () => {
      if (document.visibilityState === "hidden") flushLatestDraft()
    }

    window.addEventListener("pagehide", flushLatestDraft)
    document.addEventListener("visibilitychange", flushHiddenDraft)
    return () => {
      window.removeEventListener("pagehide", flushLatestDraft)
      document.removeEventListener("visibilitychange", flushHiddenDraft)
    }
  }, [draftHydrated, draftStorageKey])

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowPageUnload.current) return
      event.preventDefault()
      event.returnValue = true
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return

    const blockClientNavigation = (event: globalThis.MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]")
      if (
        !anchor ||
        (anchor.target.length > 0 && anchor.target.toLowerCase() !== "_self") ||
        anchor.hasAttribute("download")
      ) {
        return
      }
      if (linkNavigationBypass.current === anchor) {
        linkNavigationBypass.current = null
        return
      }
      const destination = new URL(anchor.href, window.location.href)
      if (
        destination.origin !== window.location.origin ||
        (destination.pathname === window.location.pathname &&
          destination.search === window.location.search)
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      if (navigationDialogOpen.current) return
      navigationDialogOpen.current = true
      pendingNavigationFocus.current = anchor
      pendingLinkAnchor.current = anchor
      setPendingNavigation({
        href: `${destination.pathname}${destination.search}${destination.hash}`,
        label: anchor.textContent?.trim() || "the selected page",
      })
    }

    document.addEventListener("click", blockClientNavigation, true)
    return () =>
      document.removeEventListener("click", blockClientNavigation, true)
  }, [dirty])

  useEffect(() => {
    if (!dirty) return
    const navigation = getBrowserNavigation()
    if (
      navigation === null ||
      (isAppleWebKitBrowser() && draftPersistenceAvailable !== false)
    ) {
      return
    }

    const blockHistoryTraversal = (rawEvent: Event) => {
      const event = rawEvent as CatalogNavigateEvent
      if (event.navigationType !== "traverse" || !event.cancelable) return

      const destination = new URL(event.destination.url)
      if (destination.origin !== window.location.origin) return

      if (navigationDialogOpen.current) {
        event.preventDefault()
        return
      }

      // Safari implements the base Navigation API but not the deferred
      // precommit callback. A synchronous native confirmation is the only
      // portable way to let Discard continue the exact original traversal
      // while Stay cancels it before the URL or React tree changes.
      if (!window.confirm("Discard unsaved catalog changes?")) {
        event.preventDefault()
      } else {
        allowPageUnload.current = true
        discardUnsavedCatalog()
        window.setTimeout(() => {
          allowPageUnload.current = false
        }, 1_000)
      }
    }

    navigation.addEventListener("navigate", blockHistoryTraversal)
    return () =>
      navigation.removeEventListener("navigate", blockHistoryTraversal)
  }, [dirty, discardUnsavedCatalog, draftPersistenceAvailable])

  useEffect(() => {
    if (pendingNavigation === null) return
    const dialog = navigationDialog.current
    if (dialog === null) return
    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    if (!dialog.open) dialog.showModal()
    stayButton.current?.focus()
    const stayOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return

      const first = stayButton.current
      const last = discardButton.current
      if (first === null || last === null) return
      const active = document.activeElement
      if (event.shiftKey) {
        if (active !== first) return
        event.preventDefault()
        last.focus()
        return
      }
      if (active !== last) return
      event.preventDefault()
      first.focus()
    }
    document.addEventListener("keydown", stayOnEscape)
    return () => {
      document.removeEventListener("keydown", stayOnEscape)
      document.body.style.overflow = previousBodyOverflow
      if (dialog.open) dialog.close()
    }
  }, [pendingNavigation])

  function chooseMode(value: AdvocateCatalogMode) {
    allowPageUnload.current = false
    persistLatestCatalogDraft(value, selections, changeReason)
    setMode(value)
    setMessage(null)
  }

  function updateChangeReason(value: string) {
    allowPageUnload.current = false
    persistLatestCatalogDraft(mode, selections, value)
    setChangeReason(value)
  }

  function announceCatalogChange(text: string) {
    setCatalogAnnouncement((current) => ({
      sequence: current.sequence + 1,
      text,
    }))
  }

  function restorePendingNavigationFocus() {
    const requestedTarget = pendingNavigationFocus.current
    pendingNavigationFocus.current = null
    const target =
      requestedTarget?.isConnected === true
        ? requestedTarget
        : catalogHeading.current
    target?.focus()
  }

  function resetUnsavedCatalog() {
    allowPageUnload.current = false
    discardUnsavedCatalog()
  }

  function addBeneficiary(choice: AdvocateCatalogChoice) {
    if (
      !choice.eligible ||
      selectedIds.has(choice.id) ||
      selections.length >= settings.selectionLimit
    ) {
      return
    }
    allowPageUnload.current = false
    const nextSelections = freezeSelections([
      ...selections,
      {
        beneficiaryId: choice.id,
        isFeatured: mode === "all_featured",
      },
    ])
    persistLatestCatalogDraft(mode, nextSelections, changeReason)
    setSelections(nextSelections)
    announceCatalogChange(
      `${advocateCatalogChoiceLabel(choice)} added. ${selections.length + 1} of ${settings.selectionLimit} selected.`,
    )
    setMessage(null)
    window.requestAnimationFrame(() => beneficiarySearch.current?.focus())
  }

  function removeBeneficiary(beneficiaryId: string) {
    const removedIndex = selections.findIndex(
      (selection) => selection.beneficiaryId === beneficiaryId,
    )
    if (removedIndex < 0) return
    allowPageUnload.current = false
    const remainingSelections = selections.filter(
      (selection) => selection.beneficiaryId !== beneficiaryId,
    )
    const focusSelection =
      remainingSelections[
        Math.min(removedIndex, remainingSelections.length - 1)
      ] ?? null
    const choice = choiceById.get(beneficiaryId)

    const nextSelections = freezeSelections(remainingSelections)
    persistLatestCatalogDraft(mode, nextSelections, changeReason)
    setSelections(nextSelections)
    announceCatalogChange(
      `${choice ? advocateCatalogChoiceLabel(choice) : "Child"} removed. ${remainingSelections.length} of ${settings.selectionLimit} selected.`,
    )
    setMessage(null)
    window.requestAnimationFrame(() => {
      if (focusSelection === null) {
        beneficiarySearch.current?.focus()
        return
      }
      removeButtons.current.get(focusSelection.beneficiaryId)?.focus()
    })
  }

  function moveBeneficiary(beneficiaryId: string, direction: "up" | "down") {
    allowPageUnload.current = false
    const moved = moveAdvocateCatalogSelection(
      selections,
      beneficiaryId,
      direction,
    )
    persistLatestCatalogDraft(mode, moved, changeReason)
    setSelections(moved)
    const nextIndex = moved.findIndex(
      (selection) => selection.beneficiaryId === beneficiaryId,
    )
    const choice = choiceById.get(beneficiaryId)
    if (moved !== selections && nextIndex >= 0 && choice) {
      announceCatalogChange(
        `${advocateCatalogChoiceLabel(choice)} moved to position ${nextIndex + 1} of ${moved.length}.`,
      )
    }
    setMessage(null)
  }

  function stayOnCatalog() {
    pendingLinkAnchor.current = null
    allowPageUnload.current = false
    navigationDialogOpen.current = false
    setPendingNavigation(null)
    window.requestAnimationFrame(restorePendingNavigationFocus)
  }

  function discardAndNavigate() {
    if (pendingNavigation === null) return
    const linkAnchor = pendingLinkAnchor.current
    pendingLinkAnchor.current = null
    pendingNavigationFocus.current = null
    allowPageUnload.current = true
    discardUnsavedCatalog()
    navigationDialogOpen.current = false
    setPendingNavigation(null)
    if (linkAnchor?.isConnected === true) {
      linkNavigationBypass.current = linkAnchor
      linkAnchor.click()
      window.setTimeout(() => {
        allowPageUnload.current = false
        if (linkNavigationBypass.current === linkAnchor) {
          linkNavigationBypass.current = null
        }
      }, 1_000)
      return
    }
    window.location.assign(pendingNavigation.href)
  }

  function toggleFeatured(beneficiaryId: string, isFeatured: boolean) {
    allowPageUnload.current = false
    const nextSelections = freezeSelections(
      selections.map((selection) =>
        selection.beneficiaryId === beneficiaryId
          ? { ...selection, isFeatured }
          : selection,
      ),
    )
    persistLatestCatalogDraft(mode, nextSelections, changeReason)
    setSelections(nextSelections)
    setMessage(null)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit || saveInFlight.current) return

    const beneficiaryIds = canonicalSelections.map(
      (selection) => selection.beneficiaryId,
    )
    const featuredBeneficiaryIds = canonicalSelections
      .filter((selection) => selection.isFeatured)
      .map((selection) => selection.beneficiaryId)

    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(settings.slug)}/catalog`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: advocateVersion,
            mode,
            beneficiaryIds,
            featuredBeneficiaryIds,
            changeReason: normalizedReason,
          }),
        },
      )

      let responseBody: unknown
      try {
        responseBody = await response.json()
      } catch {
        responseBody = null
      }
      const result = parseAdvocateCatalogSaveResponse(
        responseBody,
        advocateVersion,
      )
      if (result === null) throw new Error("catalog_update_failed")
      if (!result.ok) {
        if (
          result.code === "version_conflict" ||
          result.code === "eligibility_changed"
        ) {
          setStaleLocked(true)
        }
        throw new Error(result.code)
      }
      if (!response.ok) throw new Error("catalog_update_failed")

      const nextSavedSelections = freezeSelections(canonicalSelections)
      setAdvocateVersion(result.advocateVersion)
      setSavedMode(mode)
      setSavedSelections(nextSavedSelections)
      setSelections(nextSavedSelections)
      setChangeReason("")
      clearCatalogDraft()
      setMessage({ kind: "success", text: "Child catalog saved." })
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      setMessage({
        kind: "error",
        text: catalogMutationErrorMessage(code),
      })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const configurationIssue =
    mode === "all_featured" && canonicalSelections.length === 0
      ? "Choose at least one child to feature."
      : mode === "selected" && canonicalSelections.length === 0
        ? "Choose at least one child for this portal."
        : ineligibleSelections.length > 0
          ? "Remove every unavailable child before saving. Existing public settings remain unchanged until you save."
          : null

  return (
    <section aria-labelledby="catalog-settings-title">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <h2
          ref={catalogHeading}
          id="catalog-settings-title"
          tabIndex={-1}
          className="text-2xl font-bold"
        >
          Child catalog
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Choose which children appear on {settings.displayName}, which children
          appear first, and their display order.
        </p>

        {staleLocked ? (
          <div
            role="alert"
            className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
          >
            <p className="font-semibold">Reload required</p>
            <p className="mt-1">
              Editing is locked because a newer settings version is available.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 min-h-11 rounded-md border border-amber-800 px-4 py-2 font-semibold hover:bg-amber-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-800"
            >
              Reload latest settings
            </button>
          </div>
        ) : null}

        <form onSubmit={save} className="mt-6">
          <fieldset disabled={saving || staleLocked}>
            <legend className="text-base font-semibold text-gray-950">
              Catalog mode
            </legend>
            <div className="mt-3 grid gap-3">
              {MODE_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md border border-gray-200 p-4"
                >
                  <input
                    type="radio"
                    name="catalog-mode"
                    value={option.value}
                    checked={mode === option.value}
                    onChange={() => chooseMode(option.value)}
                    className="mt-1 h-5 w-5 shrink-0"
                  />
                  <span>
                    <span className="block font-semibold text-gray-950">
                      {option.label}
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-gray-600">
                      {option.description}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {mode === "all" ? (
            <div className="mt-6 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
              New eligible children will appear automatically. No individual
              catalog selection is stored in this mode.
            </div>
          ) : (
            <div className="mt-7">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-gray-950">
                    Chosen children
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {selections.length} of {settings.selectionLimit} selected.
                    The order below controls the public catalog.
                  </p>
                </div>
              </div>

              {selections.length === 0 ? (
                <p className="mt-3 rounded-md border border-gray-200 p-4 text-sm text-gray-600">
                  No children are selected yet. Use the search below to add one.
                </p>
              ) : (
                <ol className="mt-3 grid gap-3">
                  {selections.map((selection, index) => {
                    const choice = choiceById.get(selection.beneficiaryId)
                    if (!choice) return null
                    const unavailable = !choice.eligible
                    const choiceLabel = advocateCatalogChoiceLabel(choice)
                    return (
                      <li
                        key={selection.beneficiaryId}
                        className={
                          unavailable
                            ? "rounded-md border border-amber-300 bg-amber-50 p-4"
                            : "rounded-md border border-gray-200 p-4"
                        }
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-950">
                              {index + 1}. {choiceLabel}
                            </p>
                            {choice.username !== null ? (
                              <p className="mt-1 break-all text-sm text-gray-600">
                                @{choice.username}
                                {choice.status !== null
                                  ? `, ${choice.status}`
                                  : null}
                              </p>
                            ) : null}
                            {unavailable ? (
                              <p className="mt-2 text-sm font-semibold text-amber-900">
                                This saved selection can no longer be displayed
                                safely. Remove it before saving.
                              </p>
                            ) : null}
                          </div>
                          <button
                            ref={(button) => {
                              if (button === null) {
                                removeButtons.current.delete(
                                  selection.beneficiaryId,
                                )
                              } else {
                                removeButtons.current.set(
                                  selection.beneficiaryId,
                                  button,
                                )
                              }
                            }}
                            type="button"
                            onClick={() =>
                              removeBeneficiary(selection.beneficiaryId)
                            }
                            disabled={saving || staleLocked}
                            aria-label={`Remove ${choiceLabel}`}
                            className="min-h-11 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
                          >
                            Remove
                          </button>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              moveBeneficiary(selection.beneficiaryId, "up")
                            }
                            disabled={saving || staleLocked || index === 0}
                            aria-label={`Move ${choiceLabel} up`}
                            className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                          >
                            Move up
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              moveBeneficiary(selection.beneficiaryId, "down")
                            }
                            disabled={
                              saving ||
                              staleLocked ||
                              index === selections.length - 1
                            }
                            aria-label={`Move ${choiceLabel} down`}
                            className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                          >
                            Move down
                          </button>
                          {mode === "selected" ? (
                            <label className="flex min-h-11 items-center gap-2 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={selection.isFeatured}
                                onChange={(event) =>
                                  toggleFeatured(
                                    selection.beneficiaryId,
                                    event.target.checked,
                                  )
                                }
                                disabled={saving || staleLocked}
                                aria-label={`Feature ${choiceLabel}`}
                                className="h-5 w-5"
                              />
                              Feature this child
                            </label>
                          ) : (
                            <span className="rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-900">
                              Featured
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}

              <div className="mt-7 border-t border-gray-200 pt-6">
                <label
                  htmlFor="catalog-beneficiary-search"
                  className="block text-sm font-semibold text-gray-900"
                >
                  Find a child to add
                </label>
                <input
                  ref={beneficiarySearch}
                  id="catalog-beneficiary-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  disabled={saving || staleLocked}
                  placeholder="Search by name or username"
                  className="mt-2 block min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
                />

                {visibleChoices.length === 0 ? (
                  <p className="mt-3 text-sm text-gray-600">
                    No eligible unselected children match this search.
                  </p>
                ) : (
                  <ul className="mt-3 grid gap-2">
                    {visibleChoices.map((choice) => (
                      <li
                        key={choice.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 p-3"
                      >
                        <span className="min-w-0">
                          <span className="block font-semibold text-gray-950">
                            {choice.name}
                          </span>
                          <span className="mt-1 block break-all text-sm text-gray-600">
                            @{choice.username}
                          </span>
                        </span>
                        <button
                          type="button"
                          onClick={() => addBeneficiary(choice)}
                          disabled={
                            saving ||
                            staleLocked ||
                            selections.length >= settings.selectionLimit
                          }
                          className="min-h-11 rounded-md border border-blue-700 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                          aria-label={`Add ${advocateCatalogChoiceLabel(choice)}`}
                        >
                          Add child
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {matchingChoices.length > visibleChoices.length ? (
                  <p className="mt-3 text-sm text-gray-600">
                    Showing the first 100 matches. Refine the search to find a
                    specific child.
                  </p>
                ) : null}
              </div>
            </div>
          )}

          {configurationIssue ? (
            <p
              role="alert"
              className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950"
            >
              {configurationIssue}
            </p>
          ) : null}

          <label className="mt-6 block text-sm font-semibold text-gray-900">
            Change note
            <input
              type="text"
              value={changeReason}
              onChange={(event) => updateChangeReason(event.target.value)}
              minLength={1}
              maxLength={500}
              required
              disabled={saving || staleLocked}
              aria-describedby="catalog-change-note-help"
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 font-normal focus:border-blue-700 focus:outline-none focus:ring-2 focus-visible:ring-blue-200 disabled:bg-gray-100"
            />
          </label>
          <p
            id="catalog-change-note-help"
            className="mt-1 text-sm text-gray-600"
          >
            Required, 1 to 500 characters on one line. This note is recorded in
            the audit history.
          </p>

          {dirty && draftPersistenceAvailable === false ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
            >
              This browser is blocking tab recovery. Save or reset these changes
              before leaving this page. Supported browser transitions will still
              ask before discarding them.
            </p>
          ) : null}

          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              aria-live="polite"
              className={
                message.kind === "error"
                  ? "mt-4 text-sm font-semibold text-red-700"
                  : "mt-4 text-sm font-semibold text-green-700"
              }
            >
              {message.text}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="min-h-11 rounded-md bg-blue-700 px-5 py-2 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              {saving ? "Saving..." : "Save child catalog"}
            </button>
            {dirty ? (
              <button
                type="button"
                onClick={resetUnsavedCatalog}
                disabled={saving || staleLocked}
                className="min-h-11 rounded-md border border-gray-400 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Reset to saved catalog
              </button>
            ) : null}
            {dirty ? (
              <span className="text-sm text-amber-800">
                You have unsaved changes.
              </span>
            ) : null}
          </div>
          <p className="sr-only" role="status" aria-live="polite">
            {catalogAnnouncement.text ? (
              <span key={catalogAnnouncement.sequence}>
                {catalogAnnouncement.text}
              </span>
            ) : null}
          </p>
        </form>
      </div>
      {pendingNavigation ? (
        <dialog
          ref={navigationDialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="catalog-unsaved-title"
          aria-describedby="catalog-unsaved-description"
          onCancel={(event) => {
            event.preventDefault()
            stayOnCatalog()
          }}
          className="m-auto w-[calc(100%-2rem)] max-w-md border-0 bg-transparent p-0 backdrop:bg-black/60"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-2xl">
            <h3
              id="catalog-unsaved-title"
              className="text-xl font-bold text-gray-950"
            >
              Discard unsaved catalog changes?
            </h3>
            <p
              id="catalog-unsaved-description"
              className="mt-3 text-sm leading-6 text-gray-700"
            >
              Going to {pendingNavigation.label} will discard the changes on
              this page.
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <button
                ref={stayButton}
                type="button"
                onClick={stayOnCatalog}
                className="min-h-11 rounded-md border border-gray-400 px-4 py-2 font-semibold text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
              >
                Stay on this page
              </button>
              <button
                ref={discardButton}
                type="button"
                onClick={discardAndNavigate}
                className="min-h-11 rounded-md bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                Discard changes
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </section>
  )
}
