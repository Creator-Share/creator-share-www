"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"

import {
  advocatePublicMetricsFingerprint,
  moveAdvocatePublicMetric,
  orderedAdvocatePublicMetricOptions,
  parseAdvocatePublicMetricsSaveResponse,
  type AdvocatePublicMetricKey,
} from "@/lib/advocates/admin/publicMetricsForm"

export interface AdvocatePublicMetricSettingsViewModel {
  slug: string
  displayName: string
  advocateVersion: number
  selectedMetricKeys: readonly AdvocatePublicMetricKey[]
}

type SaveMessage = Readonly<{
  kind: "success" | "error"
  text: string
}> | null

function publicMetricMutationErrorMessage(code: string): string {
  switch (code) {
    case "version_conflict":
      return "These public metric settings changed in another session. Reload the latest settings before making another change."
    case "no_change":
      return "Those public metric choices are already saved. No change was made."
    case "forbidden":
      return "Your public metric permission changed. Reload the page or contact a portal administrator."
    case "invalid_request":
      return "Review the selected metrics and change note, then try again."
    default:
      return "The public metric settings could not be saved. Try again."
  }
}

export function PublicMetricSettingsClient({
  settings,
}: {
  settings: AdvocatePublicMetricSettingsViewModel
}) {
  const [advocateVersion, setAdvocateVersion] = useState(
    settings.advocateVersion,
  )
  const [savedMetricKeys, setSavedMetricKeys] = useState<
    readonly AdvocatePublicMetricKey[]
  >(() => Object.freeze([...settings.selectedMetricKeys]))
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<
    readonly AdvocatePublicMetricKey[]
  >(() => Object.freeze([...settings.selectedMetricKeys]))
  const [changeReason, setChangeReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [staleLocked, setStaleLocked] = useState(false)
  const [message, setMessage] = useState<SaveMessage>(null)

  const dirty =
    advocatePublicMetricsFingerprint(selectedMetricKeys) !==
    advocatePublicMetricsFingerprint(savedMetricKeys)
  const orderedOptions = useMemo(
    () => orderedAdvocatePublicMetricOptions(selectedMetricKeys),
    [selectedMetricKeys],
  )
  const normalizedReason = changeReason.trim()
  const canSubmit =
    dirty &&
    !saving &&
    !staleLocked &&
    normalizedReason.length >= 1 &&
    normalizedReason.length <= 500

  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", warnBeforeUnload)
    return () => window.removeEventListener("beforeunload", warnBeforeUnload)
  }, [dirty])

  function toggleMetric(key: AdvocatePublicMetricKey, selected: boolean) {
    setMessage(null)
    setSelectedMetricKeys((current) =>
      selected
        ? current.includes(key)
          ? current
          : Object.freeze([...current, key])
        : Object.freeze(current.filter((candidate) => candidate !== key)),
    )
  }

  function moveMetric(key: AdvocatePublicMetricKey, direction: "up" | "down") {
    setMessage(null)
    setSelectedMetricKeys((current) =>
      moveAdvocatePublicMetric(current, key, direction),
    )
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return

    setSaving(true)
    setMessage(null)
    try {
      const response = await fetch(
        `/api/portal/${encodeURIComponent(settings.slug)}/public-metrics`,
        {
          method: "POST",
          credentials: "same-origin",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedVersion: advocateVersion,
            metricKeys: selectedMetricKeys,
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
      const result = parseAdvocatePublicMetricsSaveResponse(
        responseBody,
        advocateVersion,
      )
      if (result === null) throw new Error("public_metrics_update_failed")
      if (!result.ok) {
        if (result.code === "version_conflict") setStaleLocked(true)
        throw new Error(result.code)
      }
      if (!response.ok) throw new Error("public_metrics_update_failed")

      setAdvocateVersion(result.advocateVersion)
      setSavedMetricKeys(Object.freeze([...selectedMetricKeys]))
      setChangeReason("")
      setMessage({
        kind: "success",
        text: "Public metric settings saved.",
      })
    } catch (error) {
      const code = error instanceof Error ? error.message : ""
      setMessage({
        kind: "error",
        text: publicMetricMutationErrorMessage(code),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="public-metric-settings-title">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
        <h2
          id="public-metric-settings-title"
          className="text-2xl font-bold text-gray-950"
        >
          Public metrics
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-600">
          Choose which impact totals appear on {settings.displayName}. Selected
          metrics appear in the order shown below.
        </p>

        <aside
          id="public-metric-privacy-note"
          className="mt-5 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950"
        >
          <h3 className="font-semibold">How public totals protect privacy</h3>
          <p className="mt-1">
            Published values are delayed lower bounds, not live private
            analytics. A selected value may remain Pending until enough new
            activity can be released safely. Public totals never identify an
            individual sponsor.
          </p>
        </aside>

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
          <fieldset
            disabled={saving || staleLocked}
            aria-describedby="public-metric-privacy-note"
          >
            <legend className="text-base font-semibold text-gray-950">
              Metrics and display order
            </legend>
            <div className="mt-3 grid gap-3">
              {orderedOptions.map((option) => {
                const selectedIndex = selectedMetricKeys.indexOf(option.key)
                const selected = selectedIndex >= 0
                return (
                  <div
                    key={option.key}
                    className="rounded-md border border-gray-200 p-4"
                  >
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) =>
                          toggleMetric(option.key, event.target.checked)
                        }
                        className="mt-1 h-5 w-5 shrink-0"
                      />
                      <span>
                        <span className="block font-semibold text-gray-950">
                          {selected ? `${selectedIndex + 1}. ` : ""}
                          {option.label}
                        </span>
                        <span className="mt-1 block text-sm leading-6 text-gray-600">
                          {option.description}
                        </span>
                      </span>
                    </label>

                    {selected ? (
                      <div
                        className="mt-3 flex flex-wrap gap-2 pl-8"
                        aria-label={`${option.label} display order`}
                      >
                        <button
                          type="button"
                          onClick={() => moveMetric(option.key, "up")}
                          disabled={selectedIndex === 0}
                          aria-label={`Move ${option.label} up`}
                          className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveMetric(option.key, "down")}
                          disabled={
                            selectedIndex === selectedMetricKeys.length - 1
                          }
                          aria-label={`Move ${option.label} down`}
                          className="min-h-11 rounded-md border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                        >
                          Move down
                        </button>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </fieldset>

          <label className="mt-6 block text-sm font-semibold text-gray-900">
            Change note
            <textarea
              value={changeReason}
              onChange={(event) => setChangeReason(event.target.value)}
              minLength={1}
              maxLength={500}
              rows={3}
              required
              disabled={saving || staleLocked}
              aria-describedby="public-metric-change-note-help"
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-2 font-normal focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-200 disabled:bg-gray-100"
            />
          </label>
          <p
            id="public-metric-change-note-help"
            className="mt-1 text-sm text-gray-600"
          >
            Required, 1 to 500 characters. This note is recorded in the audit
            history.
          </p>

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
              {saving ? "Saving..." : "Save public metrics"}
            </button>
            {dirty ? (
              <span className="text-sm text-amber-800">
                You have unsaved changes.
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </section>
  )
}
