const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export const ADVOCATE_PUBLIC_METRIC_KEYS = Object.freeze([
  "children_sponsored",
  "gross_raised_usd",
  "direct_sponsorships",
  "post_visit_attributed_sponsorships",
] as const)

export type AdvocatePublicMetricKey =
  (typeof ADVOCATE_PUBLIC_METRIC_KEYS)[number]

export interface AdvocatePublicMetricOption {
  key: AdvocatePublicMetricKey
  label: string
  description: string
}

export const ADVOCATE_PUBLIC_METRIC_OPTIONS = Object.freeze([
  Object.freeze({
    key: "children_sponsored",
    label: "Children sponsored",
    description:
      "Children whose completed sponsorship was attributed to this portal.",
  }),
  Object.freeze({
    key: "gross_raised_usd",
    label: "Sponsorship funding",
    description:
      "Successful sponsorship payments attributed to this portal, before refunds, reversals, and disputes.",
  }),
  Object.freeze({
    key: "direct_sponsorships",
    label: "Direct sponsorships",
    description: "Sponsorships completed on this branded portal.",
  }),
  Object.freeze({
    key: "post_visit_attributed_sponsorships",
    label: "Sponsorships after a visit",
    description:
      "Sponsorships completed later on Creator Share within the official attribution window.",
  }),
] as const satisfies readonly AdvocatePublicMetricOption[])

const PUBLIC_METRIC_KEY_SET = new Set<string>(ADVOCATE_PUBLIC_METRIC_KEYS)

export type AdvocatePublicMetricsSaveResult =
  | { ok: true; advocateVersion: number; requestId: string }
  | { ok: false; code: string; requestId: string }

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

export function isAdvocatePublicMetricKey(
  value: unknown,
): value is AdvocatePublicMetricKey {
  return typeof value === "string" && PUBLIC_METRIC_KEY_SET.has(value)
}

export function normalizeAdvocatePublicMetricKeys(
  value: readonly unknown[],
): readonly AdvocatePublicMetricKey[] | null {
  if (value.length > ADVOCATE_PUBLIC_METRIC_KEYS.length) return null

  const seen = new Set<string>()
  const metricKeys: AdvocatePublicMetricKey[] = []
  for (const key of value) {
    if (!isAdvocatePublicMetricKey(key) || seen.has(key)) return null
    seen.add(key)
    metricKeys.push(key)
  }
  return Object.freeze(metricKeys)
}

export function orderedAdvocatePublicMetricOptions(
  selectedMetricKeys: readonly AdvocatePublicMetricKey[],
): readonly AdvocatePublicMetricOption[] {
  const optionsByKey = new Map(
    ADVOCATE_PUBLIC_METRIC_OPTIONS.map((option) => [option.key, option]),
  )
  const selected = selectedMetricKeys.flatMap((key) => {
    const option = optionsByKey.get(key)
    return option ? [option] : []
  })
  const selectedKeys = new Set(selectedMetricKeys)
  return Object.freeze([
    ...selected,
    ...ADVOCATE_PUBLIC_METRIC_OPTIONS.filter(
      (option) => !selectedKeys.has(option.key),
    ),
  ])
}

export function moveAdvocatePublicMetric(
  metricKeys: readonly AdvocatePublicMetricKey[],
  key: AdvocatePublicMetricKey,
  direction: "up" | "down",
): readonly AdvocatePublicMetricKey[] {
  const currentIndex = metricKeys.indexOf(key)
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= metricKeys.length) {
    return metricKeys
  }

  const next = [...metricKeys]
  const current = next[currentIndex]
  next[currentIndex] = next[targetIndex]
  next[targetIndex] = current
  return Object.freeze(next)
}

export function advocatePublicMetricsFingerprint(
  metricKeys: readonly AdvocatePublicMetricKey[],
): string {
  return JSON.stringify(metricKeys)
}

export function parseAdvocatePublicMetricsSaveResponse(
  value: unknown,
  expectedVersion: number,
): AdvocatePublicMetricsSaveResult | null {
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
