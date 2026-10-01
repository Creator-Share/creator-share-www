const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const ADVOCATE_CATALOG_MODES = Object.freeze([
  "all",
  "all_featured",
  "selected",
] as const)

export const MAX_ADVOCATE_CATALOG_SELECTIONS = 1_000

export type AdvocateCatalogMode = (typeof ADVOCATE_CATALOG_MODES)[number]

export interface AdvocateCatalogSelection {
  beneficiaryId: string
  isFeatured: boolean
}

export interface AdvocateCatalogChoice {
  id: string
  name: string | null
  username: string | null
  status: string | null
  eligible: boolean
  blockedReason: "unavailable" | null
}

export interface AdvocateCatalogDraft {
  schemaVersion: 2
  advocateId: string
  actorUserId: string
  advocateVersion: number
  savedFingerprint: string
  mode: AdvocateCatalogMode
  selections: readonly AdvocateCatalogSelection[]
  changeReason: string
}

export type AdvocateCatalogSaveResult =
  | { ok: true; advocateVersion: number; requestId: string }
  | { ok: false; code: string; requestId: string }

const CATALOG_MODE_SET = new Set<string>(ADVOCATE_CATALOG_MODES)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  )
}

export function isAdvocateCatalogMode(
  value: unknown,
): value is AdvocateCatalogMode {
  return typeof value === "string" && CATALOG_MODE_SET.has(value)
}

export function normalizeAdvocateCatalogSelections(
  value: readonly unknown[],
): readonly AdvocateCatalogSelection[] | null {
  if (value.length > MAX_ADVOCATE_CATALOG_SELECTIONS) return null

  const seen = new Set<string>()
  const selections: AdvocateCatalogSelection[] = []
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ["beneficiaryId", "isFeatured"]) ||
      typeof candidate.beneficiaryId !== "string" ||
      !UUID_PATTERN.test(candidate.beneficiaryId) ||
      seen.has(candidate.beneficiaryId) ||
      typeof candidate.isFeatured !== "boolean"
    ) {
      return null
    }
    seen.add(candidate.beneficiaryId)
    selections.push(
      Object.freeze({
        beneficiaryId: candidate.beneficiaryId,
        isFeatured: candidate.isFeatured,
      }),
    )
  }
  return Object.freeze(selections)
}

export function isValidAdvocateCatalogConfiguration(
  mode: AdvocateCatalogMode,
  selections: readonly AdvocateCatalogSelection[],
): boolean {
  if (selections.length > MAX_ADVOCATE_CATALOG_SELECTIONS) return false
  switch (mode) {
    case "all":
      return selections.length === 0
    case "all_featured":
      return (
        selections.length >= 1 &&
        selections.every((selection) => selection.isFeatured)
      )
    case "selected":
      return selections.length >= 1
  }
}

export function selectionsForAdvocateCatalogMode(
  mode: AdvocateCatalogMode,
  selections: readonly AdvocateCatalogSelection[],
): readonly AdvocateCatalogSelection[] {
  if (mode === "all") return Object.freeze([])
  if (mode === "all_featured") {
    return Object.freeze(
      selections.map((selection) =>
        Object.freeze({
          beneficiaryId: selection.beneficiaryId,
          isFeatured: true,
        }),
      ),
    )
  }
  return Object.freeze(
    selections.map((selection) => Object.freeze({ ...selection })),
  )
}

export function moveAdvocateCatalogSelection(
  selections: readonly AdvocateCatalogSelection[],
  beneficiaryId: string,
  direction: "up" | "down",
): readonly AdvocateCatalogSelection[] {
  const currentIndex = selections.findIndex(
    (selection) => selection.beneficiaryId === beneficiaryId,
  )
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= selections.length) {
    return selections
  }

  const next = [...selections]
  const current = next[currentIndex]
  next[currentIndex] = next[targetIndex]
  next[targetIndex] = current
  return Object.freeze(next)
}

export function advocateCatalogFingerprint(
  mode: AdvocateCatalogMode,
  selections: readonly AdvocateCatalogSelection[],
): string {
  return JSON.stringify({
    mode,
    selections: selectionsForAdvocateCatalogMode(mode, selections),
  })
}

export function parseAdvocateCatalogDraft(
  value: unknown,
  expected: Readonly<{
    advocateId: string
    actorUserId: string
    advocateVersion: number
    savedFingerprint: string
    allowedBeneficiaryIds: ReadonlySet<string>
    selectionLimit: number
  }>,
): AdvocateCatalogDraft | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "advocateId",
      "actorUserId",
      "advocateVersion",
      "savedFingerprint",
      "mode",
      "selections",
      "changeReason",
    ]) ||
    value.schemaVersion !== 2 ||
    value.advocateId !== expected.advocateId ||
    value.actorUserId !== expected.actorUserId ||
    typeof value.advocateVersion !== "number" ||
    !Number.isSafeInteger(value.advocateVersion) ||
    value.advocateVersion < 0 ||
    typeof value.savedFingerprint !== "string" ||
    value.savedFingerprint !== expected.savedFingerprint ||
    !isAdvocateCatalogMode(value.mode) ||
    !Array.isArray(value.selections) ||
    typeof value.changeReason !== "string" ||
    value.changeReason.length > 500 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value.changeReason)
  ) {
    return null
  }

  const selections = normalizeAdvocateCatalogSelections(value.selections)
  const canonicalSelections =
    selections === null
      ? null
      : selectionsForAdvocateCatalogMode(value.mode, selections)
  if (
    selections === null ||
    canonicalSelections === null ||
    selections.length > expected.selectionLimit ||
    selections.some(
      (selection) =>
        !expected.allowedBeneficiaryIds.has(selection.beneficiaryId),
    ) ||
    JSON.stringify(selections) !== JSON.stringify(canonicalSelections) ||
    advocateCatalogFingerprint(value.mode, canonicalSelections) ===
      expected.savedFingerprint
  ) {
    return null
  }

  return Object.freeze({
    schemaVersion: 2 as const,
    advocateId: expected.advocateId,
    actorUserId: expected.actorUserId,
    advocateVersion: expected.advocateVersion,
    savedFingerprint: value.savedFingerprint,
    mode: value.mode,
    selections: canonicalSelections,
    changeReason: value.changeReason,
  })
}

export function parseAdvocateCatalogSaveResponse(
  value: unknown,
  expectedVersion: number,
): AdvocateCatalogSaveResult | null {
  if (!isRecord(value)) return null

  if (
    value.ok === true &&
    hasExactKeys(value, ["ok", "requestId", "advocateVersion"]) &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId) &&
    typeof value.advocateVersion === "number" &&
    Number.isSafeInteger(value.advocateVersion) &&
    value.advocateVersion === expectedVersion + 1
  ) {
    return {
      ok: true,
      advocateVersion: value.advocateVersion,
      requestId: value.requestId,
    }
  }

  if (
    value.ok === false &&
    hasExactKeys(value, ["ok", "requestId", "code"]) &&
    typeof value.requestId === "string" &&
    UUID_PATTERN.test(value.requestId) &&
    typeof value.code === "string" &&
    value.code.length >= 1 &&
    value.code.length <= 64
  ) {
    return { ok: false, code: value.code, requestId: value.requestId }
  }

  return null
}
