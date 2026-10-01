/** Strict request decoding. Callers retain their own header and empty-body policy. */
export async function readBoundedUtf8Stream(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) return null
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = body.getReader()
  } catch {
    return null
  }
  const abort = () => { void reader.cancel().catch(() => undefined) }
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let text = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (signal?.aborted) return null
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) return null
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } catch {
    return null
  } finally {
    signal?.removeEventListener("abort", abort)
    // A rejected body must not delay the response while its producer cleans up.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
