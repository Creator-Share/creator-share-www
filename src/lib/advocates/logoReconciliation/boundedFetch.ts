import "server-only"

export interface AdvocateLogoReconciliationFetchOptions {
  requestTimeoutMilliseconds: number
  invocationDeadlineAt: number
  now?: () => number
  fetchImplementation?: typeof fetch
}

function assertOptions(options: AdvocateLogoReconciliationFetchOptions): void {
  if (
    !Number.isSafeInteger(options.requestTimeoutMilliseconds) ||
    options.requestTimeoutMilliseconds < 1_000 ||
    options.requestTimeoutMilliseconds > 30_000 ||
    !Number.isSafeInteger(options.invocationDeadlineAt) ||
    options.invocationDeadlineAt < 1
  ) {
    throw new RangeError(
      "Advocate logo reconciliation fetch bounds are invalid",
    )
  }
}

function abortError(): DOMException {
  return new DOMException(
    "Advocate logo reconciliation request aborted",
    "AbortError",
  )
}

export function createBoundedAdvocateLogoReconciliationFetch(
  options: AdvocateLogoReconciliationFetchOptions,
): typeof fetch {
  assertOptions(options)
  const now = options.now ?? Date.now
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch

  return async (input, init) => {
    const remainingMilliseconds = options.invocationDeadlineAt - now()
    if (!Number.isFinite(remainingMilliseconds) || remainingMilliseconds < 1) {
      throw abortError()
    }
    const timeoutMilliseconds = Math.min(
      options.requestTimeoutMilliseconds,
      Math.floor(remainingMilliseconds),
    )
    if (timeoutMilliseconds < 1) throw abortError()

    // Fetch resolves at headers. Keep cancellation active while the SDK reads
    // the body, including cancellation inherited from a Request input.
    const upstreamSignal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const deadlineSignal = AbortSignal.timeout(timeoutMilliseconds)
    return fetchImplementation(input, {
      ...init,
      signal: upstreamSignal
        ? AbortSignal.any([upstreamSignal, deadlineSignal])
        : deadlineSignal,
    })
  }
}
