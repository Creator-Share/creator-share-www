import { readFile, writeFile } from "node:fs/promises"

/**
 * Captures a tracked file before a tool rewrites it and returns an idempotent
 * restorer. Next.js edits fixture tsconfig includes during production builds,
 * so browser proofs use this to leave the checkout byte-for-byte unchanged.
 */
export async function preserveFile(path: string): Promise<() => Promise<void>> {
  const original = await readFile(path)
  let restored = false

  return async () => {
    if (restored) return
    restored = true
    await writeFile(path, original)
  }
}
