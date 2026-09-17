export class ResponseBodyLimitError extends Error {
  constructor() {
    super("response_body_limit_exceeded")
    this.name = "ResponseBodyLimitError"
  }
}

/** Read decoded text without buffering more than the permitted response bytes. */
export async function readBoundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
    throw new RangeError("invalid_response_body_limit")
  }
  const declaredLength = response.headers.get("content-length")
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maximumBytes
  ) {
    void response.body?.cancel().catch(() => undefined)
    throw new ResponseBodyLimitError()
  }
  const reader = response.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let text = ""
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maximumBytes) throw new ResponseBodyLimitError()
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    // Cancellation is best effort and must not conceal the read result.
    void reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
