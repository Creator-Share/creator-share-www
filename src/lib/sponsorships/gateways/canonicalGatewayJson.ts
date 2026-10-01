/** Stable UTF-16 key ordering, independent of the process locale and ICU data. */
export function canonicalGatewayJson(
  value: unknown,
  invalid: () => never,
): string | undefined {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid()
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalGatewayJson(item, invalid) ?? "null").join(",")}]`
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>
    const entries = Object.keys(record).sort().flatMap(key => {
      const encoded = canonicalGatewayJson(record[key], invalid)
      return encoded === undefined ? [] : [`${JSON.stringify(key)}:${encoded}`]
    })
    return `{${entries.join(",")}}`
  }
  if (value === undefined) return undefined
  return invalid()
}
