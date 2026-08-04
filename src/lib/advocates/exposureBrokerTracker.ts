export const ADVOCATE_EXPOSURE_PAGE_RETRY_DELAYS_MILLISECONDS = Object.freeze([
  0, 5_000, 30_000, 120_000,
] as const)

type TimerHandle = number

type ScheduleTimer = (
  callback: () => void,
  delayMilliseconds: number,
) => TimerHandle

export interface AdvocateExposurePageRetryControllerOptions {
  clearTimer?: (handle: TimerHandle) => void
  isCurrentEligiblePath: () => boolean
  isVisible: () => boolean
  onAccepted?: () => void
  recordExposure: () => Promise<boolean>
  retryDelaysMilliseconds?: readonly number[]
  scheduleTimer?: ScheduleTimer
}

export interface AdvocateExposurePageRetryController {
  dispose: () => void
  notifyEnvironmentChange: () => void
  start: () => void
}

function defaultScheduleTimer(
  callback: () => void,
  delayMilliseconds: number,
): TimerHandle {
  return window.setTimeout(callback, delayMilliseconds)
}

function defaultClearTimer(handle: TimerHandle): void {
  window.clearTimeout(handle)
}

function assertValidRetrySchedule(values: readonly number[]): void {
  if (
    values.length < 1 ||
    values.length > 6 ||
    values[0] !== 0 ||
    values.some(
      (value) =>
        !Number.isSafeInteger(value) || value < 0 || value > 10 * 60_000,
    )
  ) {
    throw new RangeError("Invalid advocate exposure page retry schedule")
  }
}

/**
 * Adds a finite page-level retry budget around the client's independent,
 * bounded transport retry budget. A delayed retry becomes ready when its timer
 * elapses, but it cannot start until the same eligible path is visible again.
 */
export function createAdvocateExposurePageRetryController(
  options: AdvocateExposurePageRetryControllerOptions,
): AdvocateExposurePageRetryController {
  const retryDelays =
    options.retryDelaysMilliseconds ??
    ADVOCATE_EXPOSURE_PAGE_RETRY_DELAYS_MILLISECONDS
  assertValidRetrySchedule(retryDelays)

  const scheduleTimer = options.scheduleTimer ?? defaultScheduleTimer
  const clearTimer = options.clearTimer ?? defaultClearTimer

  let attemptsStarted = 0
  let completed = false
  let disposed = false
  let inFlight = false
  let ready = false
  let started = false
  let timer: TimerHandle | null = null

  const dispose = () => {
    if (disposed) return
    disposed = true
    ready = false
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
  }

  const attemptIfReady = () => {
    if (disposed || completed || inFlight || !ready) return
    if (!options.isCurrentEligiblePath()) {
      dispose()
      return
    }
    if (!options.isVisible()) return

    ready = false
    attemptsStarted += 1
    inFlight = true

    let request: Promise<boolean>
    try {
      request = options.recordExposure()
    } catch {
      request = Promise.resolve(false)
    }

    void request.then(
      (accepted) => {
        inFlight = false
        if (disposed) return
        if (accepted) {
          completed = true
          options.onAccepted?.()
          return
        }
        armNextAttempt()
      },
      () => {
        inFlight = false
        if (!disposed) armNextAttempt()
      },
    )
  }

  const armNextAttempt = () => {
    if (
      disposed ||
      completed ||
      inFlight ||
      ready ||
      timer !== null ||
      attemptsStarted >= retryDelays.length
    ) {
      return
    }
    if (!options.isCurrentEligiblePath()) {
      dispose()
      return
    }

    const delay = retryDelays[attemptsStarted]
    if (delay === 0) {
      ready = true
      attemptIfReady()
      return
    }

    timer = scheduleTimer(() => {
      timer = null
      if (disposed || completed) return
      ready = true
      attemptIfReady()
    }, delay)
  }

  return Object.freeze({
    dispose,
    notifyEnvironmentChange() {
      if (disposed || completed) return
      if (!options.isCurrentEligiblePath()) {
        dispose()
        return
      }
      attemptIfReady()
    },
    start() {
      if (started || disposed) return
      started = true
      armNextAttempt()
    },
  })
}
