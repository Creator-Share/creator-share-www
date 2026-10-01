import { expect, test } from "@playwright/test"

import { createAdvocateExposurePageRetryController } from "../../src/lib/advocates/exposureBrokerTracker"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function timerHarness() {
  let nextId = 1
  const scheduled: Array<{
    callback: () => void
    cleared: boolean
    delay: number
    id: number
  }> = []

  return {
    clearTimer(id: number) {
      const timer = scheduled.find((candidate) => candidate.id === id)
      if (timer !== undefined) timer.cleared = true
    },
    pendingDelays() {
      return scheduled
        .filter((timer) => !timer.cleared)
        .map((timer) => timer.delay)
    },
    runNext() {
      const timer = scheduled.find((candidate) => !candidate.cleared)
      if (timer === undefined) throw new Error("Expected a scheduled timer")
      timer.cleared = true
      timer.callback()
    },
    scheduleTimer(callback: () => void, delay: number) {
      const id = nextId
      nextId += 1
      scheduled.push({ callback, cleared: false, delay, id })
      return id
    },
    scheduled,
  }
}

test("uses one finite page retry budget without overlapping client cycles", async () => {
  const timers = timerHarness()
  const requests: Array<ReturnType<typeof deferred<boolean>>> = []
  const controller = createAdvocateExposurePageRetryController({
    clearTimer: timers.clearTimer,
    isCurrentEligiblePath: () => true,
    isVisible: () => true,
    recordExposure: () => {
      const request = deferred<boolean>()
      requests.push(request)
      return request.promise
    },
    scheduleTimer: timers.scheduleTimer,
  })

  controller.start()
  controller.start()
  controller.notifyEnvironmentChange()
  expect(requests).toHaveLength(1)

  for (const [retryIndex, expectedDelay] of [
    5_000, 30_000, 120_000,
  ].entries()) {
    requests.at(-1)?.resolve(false)
    await flushPromises()
    expect(timers.pendingDelays()).toEqual([expectedDelay])

    controller.notifyEnvironmentChange()
    expect(requests).toHaveLength(retryIndex + 1)
    timers.runNext()
  }

  expect(requests).toHaveLength(4)
  requests[3].resolve(false)
  await flushPromises()
  expect(timers.pendingDelays()).toEqual([])

  controller.notifyEnvironmentChange()
  expect(requests).toHaveLength(4)
})

test("waits for visibility before consuming a ready attempt", async () => {
  const timers = timerHarness()
  const requests: Array<ReturnType<typeof deferred<boolean>>> = []
  let visible = false
  const controller = createAdvocateExposurePageRetryController({
    clearTimer: timers.clearTimer,
    isCurrentEligiblePath: () => true,
    isVisible: () => visible,
    recordExposure: () => {
      const request = deferred<boolean>()
      requests.push(request)
      return request.promise
    },
    retryDelaysMilliseconds: [0, 10],
    scheduleTimer: timers.scheduleTimer,
  })

  controller.start()
  controller.notifyEnvironmentChange()
  expect(requests).toHaveLength(0)

  visible = true
  controller.notifyEnvironmentChange()
  expect(requests).toHaveLength(1)
  requests[0].resolve(false)
  await flushPromises()
  expect(timers.pendingDelays()).toEqual([10])

  visible = false
  timers.runNext()
  expect(requests).toHaveLength(1)
  visible = true
  controller.notifyEnvironmentChange()
  expect(requests).toHaveLength(2)
})

test("marks an accepted path complete and never schedules it again", async () => {
  const timers = timerHarness()
  const request = deferred<boolean>()
  let accepted = 0
  let requestCount = 0
  const controller = createAdvocateExposurePageRetryController({
    clearTimer: timers.clearTimer,
    isCurrentEligiblePath: () => true,
    isVisible: () => true,
    onAccepted: () => {
      accepted += 1
    },
    recordExposure: () => {
      requestCount += 1
      return request.promise
    },
    scheduleTimer: timers.scheduleTimer,
  })

  controller.start()
  request.resolve(true)
  await flushPromises()
  controller.notifyEnvironmentChange()

  expect(requestCount).toBe(1)
  expect(accepted).toBe(1)
  expect(timers.pendingDelays()).toEqual([])
})

test("cancels delayed retries after a path change or disposal", async () => {
  const timers = timerHarness()
  let eligible = true
  let requestCount = 0
  const controller = createAdvocateExposurePageRetryController({
    clearTimer: timers.clearTimer,
    isCurrentEligiblePath: () => eligible,
    isVisible: () => true,
    recordExposure: async () => {
      requestCount += 1
      return false
    },
    retryDelaysMilliseconds: [0, 10],
    scheduleTimer: timers.scheduleTimer,
  })

  controller.start()
  await flushPromises()
  expect(timers.pendingDelays()).toEqual([10])
  const pathChangeTimer = timers.scheduled[0]

  eligible = false
  controller.notifyEnvironmentChange()
  expect(pathChangeTimer.cleared).toBe(true)
  pathChangeTimer.callback()
  expect(requestCount).toBe(1)

  const disposalTimers = timerHarness()
  const disposalController = createAdvocateExposurePageRetryController({
    clearTimer: disposalTimers.clearTimer,
    isCurrentEligiblePath: () => true,
    isVisible: () => true,
    recordExposure: async () => false,
    retryDelaysMilliseconds: [0, 10],
    scheduleTimer: disposalTimers.scheduleTimer,
  })
  disposalController.start()
  await flushPromises()
  const unmountTimer = disposalTimers.scheduled[0]
  disposalController.dispose()
  expect(unmountTimer.cleared).toBe(true)
})

test("does not arm a retry when the path changes during a client cycle", async () => {
  const timers = timerHarness()
  const request = deferred<boolean>()
  let eligible = true
  const controller = createAdvocateExposurePageRetryController({
    clearTimer: timers.clearTimer,
    isCurrentEligiblePath: () => eligible,
    isVisible: () => true,
    recordExposure: () => request.promise,
    retryDelaysMilliseconds: [0, 10],
    scheduleTimer: timers.scheduleTimer,
  })

  controller.start()
  eligible = false
  request.resolve(false)
  await flushPromises()

  expect(timers.pendingDelays()).toEqual([])
})

test("rejects an unbounded or malformed page retry policy", () => {
  const base = {
    isCurrentEligiblePath: () => true,
    isVisible: () => true,
    recordExposure: async () => true,
  }
  for (const retryDelaysMilliseconds of [
    [],
    [1],
    [0, -1],
    [0, 600_001],
    [0, 1, 2, 3, 4, 5, 6],
  ]) {
    expect(() =>
      createAdvocateExposurePageRetryController({
        ...base,
        retryDelaysMilliseconds,
      }),
    ).toThrow(RangeError)
  }
})
