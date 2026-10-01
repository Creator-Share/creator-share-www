"use client"

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react"
import { useRouter } from "next/navigation"

import { AdvocateRichTextEditor } from "@/components/advocates/admin/AdvocateRichTextEditor"
import {
  advocateBrandingFormFingerprint,
  buildAdvocateBrandingJsonPayload,
  buildAdvocateBrandingLogoFormData,
  isAdvocateBrandingRichTextWithinLimit,
  normalizeAdvocateBrandingFormColor,
  parseAdvocateBrandingSaveResponse,
  validateAdvocateBrandingLogoFile,
} from "@/lib/advocates/admin/brandingForm"
import {
  deriveAccessibleBrandInkColor,
  deriveAccessibleForegroundColor,
} from "@/lib/advocates/publicSiteTheme"

export interface AdvocateBrandingSettingsViewModel {
  slug: string
  displayName: string
  advocateVersion: number
  canEdit: boolean
  readOnlyReason: string | null
  primaryColor: string
  accentColor: string
  logoStoragePath: string | null
  logoUrl: string | null
  logoAltText: string | null
  openingHeaderHtml: string
  aboutBiographyHtml: string
}

type SaveStatus =
  | { kind: "idle"; message: "" }
  | { kind: "success" | "error" | "warning"; message: string }

function errorMessage(code: string): string {
  switch (code) {
    case "version_conflict":
      return "These settings changed in another session. Reload the latest version before saving again."
    case "forbidden":
      return "Your access no longer permits branding changes."
    case "portal_not_found":
      return "This advocate portal is no longer available."
    case "unauthorized":
      return "Your session expired. Sign in again before saving."
    case "source_too_large":
    case "output_too_large":
      return "The logo is too large to process. Choose a smaller image."
    case "unsupported_source":
      return "Choose a JPEG, PNG, or WebP logo."
    case "animated_source":
      return "Animated logos are not supported. Choose a still image."
    case "invalid_source":
      return "The logo could not be read. Choose another image."
    case "upload_in_progress":
      return "Another logo upload is already in progress for these settings. Wait a moment, then reload."
    case "rate_limited":
      return "Logo uploads are temporarily limited. Wait before trying again."
    case "logo_reconciliation_pending":
      return "The logo update is still being reconciled. Reload before trying another change."
    default:
      return "Creator Share could not save these settings. Try again."
  }
}

function readableFileError(
  code: ReturnType<typeof validateAdvocateBrandingLogoFile>,
): string {
  switch (code) {
    case "logo_empty":
      return "Choose a nonempty image file."
    case "logo_too_large":
      return "Choose a logo smaller than 5 MB."
    case "logo_type":
      return "Choose a JPEG, PNG, or WebP logo."
    default:
      return ""
  }
}

function initialFingerprint(settings: AdvocateBrandingSettingsViewModel) {
  return advocateBrandingFormFingerprint({
    primaryColor: settings.primaryColor,
    accentColor: settings.accentColor,
    logoStoragePath: settings.logoStoragePath,
    logoAltText: settings.logoAltText,
    openingHeaderHtml: settings.openingHeaderHtml,
    aboutBiographyHtml: settings.aboutBiographyHtml,
  })
}

export function BrandingSettingsClient({
  settings,
}: {
  settings: AdvocateBrandingSettingsViewModel
}) {
  const router = useRouter()
  const [primaryColor, setPrimaryColor] = useState(settings.primaryColor)
  const [accentColor, setAccentColor] = useState(settings.accentColor)
  const [logoAltText, setLogoAltText] = useState(settings.logoAltText ?? "")
  const [openingHeaderHtml, setOpeningHeaderHtml] = useState(
    settings.openingHeaderHtml,
  )
  const [aboutBiographyHtml, setAboutBiographyHtml] = useState(
    settings.aboutBiographyHtml,
  )
  const [changeReason, setChangeReason] = useState("")
  const [selectedLogo, setSelectedLogo] = useState<File | null>(null)
  const [selectedLogoUrl, setSelectedLogoUrl] = useState<string | null>(null)
  const [removeLogo, setRemoveLogo] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveLocked, setSaveLocked] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [status, setStatus] = useState<SaveStatus>({
    kind: "idle",
    message: "",
  })
  const [isRefreshPending, startRefresh] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const allowDiscardRef = useRef(false)

  useEffect(() => {
    if (!selectedLogo) {
      setSelectedLogoUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(selectedLogo)
    setSelectedLogoUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [selectedLogo])

  const normalizedPrimary =
    normalizeAdvocateBrandingFormColor(primaryColor) ?? settings.primaryColor
  const normalizedAccent =
    normalizeAdvocateBrandingFormColor(accentColor) ?? settings.accentColor
  const logoVisible =
    selectedLogo !== null || (!removeLogo && settings.logoStoragePath !== null)
  const logoPreviewUrl =
    selectedLogoUrl ?? (!removeLogo ? settings.logoUrl : null)
  const currentFingerprint = advocateBrandingFormFingerprint({
    primaryColor,
    accentColor,
    logoStoragePath: removeLogo ? null : settings.logoStoragePath,
    logoAltText: logoVisible ? logoAltText : null,
    openingHeaderHtml,
    aboutBiographyHtml,
  })
  const hasBrandingChanges =
    currentFingerprint !== initialFingerprint(settings) || selectedLogo !== null
  const hasUnsavedChanges =
    settings.canEdit &&
    !saveLocked &&
    (hasBrandingChanges || changeReason.trim().length > 0)

  useEffect(() => {
    if (!hasUnsavedChanges) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowDiscardRef.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        allowDiscardRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return
      }
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]")
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download") ||
        anchor.href === window.location.href
      ) {
        return
      }
      if (!window.confirm("Discard your unsaved branding changes?")) {
        event.preventDefault()
        event.stopImmediatePropagation()
      } else {
        allowDiscardRef.current = true
      }
    }

    window.addEventListener("beforeunload", handleBeforeUnload)
    document.addEventListener("click", handleDocumentClick, true)
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload)
      document.removeEventListener("click", handleDocumentClick, true)
    }
  }, [hasUnsavedChanges])

  const formDisabled =
    !settings.canEdit || saving || saveLocked || conflict || isRefreshPending
  const primaryForeground = useMemo(
    () => deriveAccessibleForegroundColor(normalizedPrimary),
    [normalizedPrimary],
  )
  const primaryInk = useMemo(
    () => deriveAccessibleBrandInkColor(normalizedPrimary),
    [normalizedPrimary],
  )
  const accentForeground = useMemo(
    () => deriveAccessibleForegroundColor(normalizedAccent),
    [normalizedAccent],
  )

  function handleLogoSelection(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0] ?? null
    if (!file) return
    const fileError = validateAdvocateBrandingLogoFile(file)
    if (fileError) {
      setSelectedLogo(null)
      event.target.value = ""
      setStatus({ kind: "error", message: readableFileError(fileError) })
      return
    }
    setSelectedLogo(file)
    setRemoveLogo(false)
    setStatus({ kind: "idle", message: "" })
  }

  function discardAndReload(): void {
    if (
      hasUnsavedChanges &&
      !window.confirm("Discard your changes and load the latest settings?")
    ) {
      return
    }
    allowDiscardRef.current = true
    window.location.reload()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (formDisabled) return
    if (!hasBrandingChanges) {
      setStatus({
        kind: "warning",
        message: "Make a branding change before saving.",
      })
      return
    }

    const canonicalPrimary = normalizeAdvocateBrandingFormColor(primaryColor)
    const canonicalAccent = normalizeAdvocateBrandingFormColor(accentColor)
    const canonicalReason = changeReason.trim()
    if (canonicalPrimary === null || canonicalAccent === null) {
      setStatus({
        kind: "error",
        message: "Enter each color as a six digit hexadecimal value.",
      })
      return
    }
    if (
      !isAdvocateBrandingRichTextWithinLimit(openingHeaderHtml) ||
      !isAdvocateBrandingRichTextWithinLimit(aboutBiographyHtml)
    ) {
      setStatus({
        kind: "error",
        message:
          "One of the rich text fields is too long. Shorten it before saving.",
      })
      return
    }
    if (logoVisible && logoAltText.trim().length === 0) {
      setStatus({
        kind: "error",
        message: "Add alternative text that identifies the logo.",
      })
      return
    }
    if (logoAltText.trim().length > 300) {
      setStatus({
        kind: "error",
        message: "Logo alternative text must be 300 characters or fewer.",
      })
      return
    }
    if (canonicalReason.length === 0 || canonicalReason.length > 500) {
      setStatus({
        kind: "error",
        message:
          "Add a change note of 500 characters or fewer for the audit history.",
      })
      return
    }

    const values = {
      expectedVersion: settings.advocateVersion,
      primaryColor: canonicalPrimary,
      accentColor: canonicalAccent,
      logoAltText: logoVisible ? logoAltText.trim() : null,
      openingHeaderHtml,
      aboutBiographyHtml,
      changeReason: canonicalReason,
    }

    setSaving(true)
    setStatus({ kind: "idle", message: "" })
    try {
      const response = selectedLogo
        ? await fetch(`/api/portal/${settings.slug}/logo`, {
            method: "POST",
            body: buildAdvocateBrandingLogoFormData({
              file: selectedLogo,
              values,
            }),
            cache: "no-store",
            credentials: "same-origin",
          })
        : await fetch(`/api/portal/${settings.slug}/branding`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              buildAdvocateBrandingJsonPayload({
                ...values,
                logoStoragePath: removeLogo ? null : settings.logoStoragePath,
              }),
            ),
            cache: "no-store",
            credentials: "same-origin",
          })

      let body: unknown = null
      try {
        body = await response.json()
      } catch {
        body = null
      }
      const result = parseAdvocateBrandingSaveResponse(
        body,
        settings.advocateVersion,
      )
      if (!response.ok || result === null || !result.ok) {
        const code = result && !result.ok ? result.code : "unknown"
        if (code === "version_conflict") setConflict(true)
        setStatus({ kind: "error", message: errorMessage(code) })
        return
      }

      setPrimaryColor(canonicalPrimary)
      setAccentColor(canonicalAccent)
      setChangeReason("")
      setSaveLocked(true)
      setStatus({
        kind: "success",
        message: "Branding saved. Refreshing the current portal settings.",
      })
      startRefresh(() => router.refresh())
    } catch {
      setStatus({
        kind: "error",
        message: "Creator Share could not reach the save service. Try again.",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
      <section
        aria-labelledby="advocate-branding-heading"
        className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8"
      >
        <h2 id="advocate-branding-heading" className="text-2xl font-bold">
          Branding
        </h2>
        <p className="mt-2 text-gray-600">
          Set the colors, logo, opening message, and organization biography
          shown on your public sponsorship experience.
        </p>

        {!settings.canEdit ? (
          <div
            role="note"
            className="mt-6 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950"
          >
            {settings.readOnlyReason}
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 space-y-8">
          <fieldset disabled={formDisabled} className="space-y-5">
            <legend className="text-lg font-bold text-gray-950">Colors</legend>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="advocate-primary-color"
                  className="text-sm font-semibold text-gray-900"
                >
                  Primary color
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Choose primary color"
                    value={normalizedPrimary}
                    onChange={(event) =>
                      setPrimaryColor(event.target.value.toUpperCase())
                    }
                    className="h-11 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1 disabled:cursor-not-allowed"
                  />
                  <input
                    id="advocate-primary-color"
                    value={primaryColor}
                    onChange={(event) =>
                      setPrimaryColor(event.target.value.toUpperCase())
                    }
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={7}
                    pattern="#[0-9A-Fa-f]{6}"
                    aria-describedby="advocate-color-format"
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="advocate-accent-color"
                  className="text-sm font-semibold text-gray-900"
                >
                  Accent color
                </label>
                <div className="mt-2 flex items-center gap-3">
                  <input
                    type="color"
                    aria-label="Choose accent color"
                    value={normalizedAccent}
                    onChange={(event) =>
                      setAccentColor(event.target.value.toUpperCase())
                    }
                    className="h-11 w-14 cursor-pointer rounded border border-gray-300 bg-white p-1 disabled:cursor-not-allowed"
                  />
                  <input
                    id="advocate-accent-color"
                    value={accentColor}
                    onChange={(event) =>
                      setAccentColor(event.target.value.toUpperCase())
                    }
                    inputMode="text"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={7}
                    pattern="#[0-9A-Fa-f]{6}"
                    aria-describedby="advocate-color-format"
                    className="min-h-11 min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm uppercase focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100"
                  />
                </div>
              </div>
            </div>
            <p id="advocate-color-format" className="text-sm text-gray-600">
              Enter six digit hexadecimal colors, for example #1C3C8C.
            </p>
          </fieldset>

          <fieldset disabled={formDisabled} className="space-y-4">
            <legend className="text-lg font-bold text-gray-950">Logo</legend>
            <div>
              <label
                htmlFor="advocate-logo-file"
                className="text-sm font-semibold text-gray-900"
              >
                Logo image
              </label>
              <p id="advocate-logo-help" className="mt-1 text-sm text-gray-600">
                Upload a still JPEG, PNG, or WebP image smaller than 5 MB.
                Creator Share removes metadata and creates a bounded WebP
                version.
              </p>
              <input
                ref={fileInputRef}
                id="advocate-logo-file"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-describedby="advocate-logo-help"
                onChange={handleLogoSelection}
                className="mt-3 block w-full rounded-md border border-gray-300 bg-white text-sm text-gray-700 file:mr-4 file:min-h-11 file:border-0 file:border-r file:border-gray-300 file:bg-gray-50 file:px-4 file:py-2 file:font-semibold file:text-gray-800 hover:file:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
            </div>

            {logoVisible ? (
              <div>
                <label
                  htmlFor="advocate-logo-alt"
                  className="text-sm font-semibold text-gray-900"
                >
                  Logo alternative text
                </label>
                <input
                  id="advocate-logo-alt"
                  value={logoAltText}
                  onChange={(event) => setLogoAltText(event.target.value)}
                  maxLength={300}
                  required
                  aria-describedby="advocate-logo-alt-help"
                  className="mt-2 min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100"
                />
                <p
                  id="advocate-logo-alt-help"
                  className="mt-1 text-sm text-gray-600"
                >
                  Briefly identify the organization or person represented by the
                  logo.
                </p>
              </div>
            ) : null}

            {settings.canEdit && (logoVisible || removeLogo) ? (
              <button
                type="button"
                disabled={formDisabled}
                onClick={() => {
                  if (removeLogo) {
                    setRemoveLogo(false)
                    setLogoAltText(settings.logoAltText ?? "")
                  } else {
                    setSelectedLogo(null)
                    setRemoveLogo(true)
                    setLogoAltText("")
                    if (fileInputRef.current) fileInputRef.current.value = ""
                  }
                }}
                className="min-h-11 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                {removeLogo ? "Undo logo removal" : "Remove logo"}
              </button>
            ) : null}
          </fieldset>

          <AdvocateRichTextEditor
            label="Opening header"
            description="Use a section heading, paragraphs, emphasis, lists, or a quote. Links and images are not permitted."
            value={openingHeaderHtml}
            heading="h2"
            disabled={formDisabled}
            onChange={setOpeningHeaderHtml}
          />

          <AdvocateRichTextEditor
            label="About us biography"
            description="Describe the organization using section headings, paragraphs, emphasis, lists, or quotes."
            value={aboutBiographyHtml}
            heading="h3"
            disabled={formDisabled}
            onChange={setAboutBiographyHtml}
          />

          {settings.canEdit ? (
            <div>
              <label
                htmlFor="advocate-branding-reason"
                className="text-sm font-semibold text-gray-900"
              >
                Change note
              </label>
              <textarea
                id="advocate-branding-reason"
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                disabled={formDisabled}
                required
                maxLength={500}
                rows={3}
                aria-describedby="advocate-branding-reason-help"
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-100"
              />
              <p
                id="advocate-branding-reason-help"
                className="mt-1 text-sm text-gray-600"
              >
                This note is recorded in the forensic audit history.
              </p>
            </div>
          ) : null}

          <div
            role="status"
            aria-live="polite"
            className={
              status.kind === "idle"
                ? "sr-only"
                : `rounded-md border px-4 py-3 text-sm ${
                    status.kind === "success"
                      ? "border-green-200 bg-green-50 text-green-950"
                      : status.kind === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : "border-red-200 bg-red-50 text-red-950"
                  }`
            }
          >
            {status.message}
          </div>

          {conflict || saveLocked ? (
            <button
              type="button"
              onClick={discardAndReload}
              className="min-h-11 rounded-md border border-blue-700 px-5 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              {conflict ? "Reload latest settings" : "Reload saved settings"}
            </button>
          ) : null}

          {settings.canEdit ? (
            <div className="flex flex-wrap items-center gap-4 border-t border-gray-200 pt-6">
              <button
                type="submit"
                disabled={formDisabled || !hasBrandingChanges}
                className="min-h-11 rounded-md bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
              >
                {saving || isRefreshPending ? "Saving…" : "Save branding"}
              </button>
              <span className="text-sm text-gray-600">
                {hasUnsavedChanges ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
          ) : null}
        </form>
      </section>

      <aside
        aria-labelledby="advocate-branding-preview-heading"
        className="self-start overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm xl:sticky xl:top-6"
      >
        <div className="border-b border-gray-200 px-5 py-4">
          <h2
            id="advocate-branding-preview-heading"
            className="text-lg font-bold text-gray-950"
          >
            Live preview
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            A compact preview of the public portal treatment.
          </p>
        </div>
        <div className="bg-gray-50 p-4 sm:p-6">
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div
              className="flex min-h-24 items-center gap-4 px-5 py-6"
              style={{
                backgroundColor: normalizedPrimary,
                color: primaryForeground,
              }}
            >
              {logoPreviewUrl ? (
                // Dynamic tenant assets and local blob previews cannot use a
                // build-time Next Image host allowlist.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoPreviewUrl}
                  alt={logoAltText.trim() || settings.displayName}
                  className="max-h-16 max-w-36 rounded bg-white/95 object-contain p-2"
                />
              ) : null}
              <div className="min-w-0">
                <p className="truncate text-lg font-bold">
                  {settings.displayName}
                </p>
                <p className="mt-1 text-sm opacity-90">
                  Sponsorships with Creator Share
                </p>
              </div>
            </div>

            <div className="space-y-6 px-5 py-6">
              <div
                className="space-y-3 [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_h2]:text-xl [&_h2]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
                style={{ color: primaryInk }}
                dangerouslySetInnerHTML={{
                  __html:
                    openingHeaderHtml ||
                    "<h2>Your opening message will appear here</h2>",
                }}
              />

              <button
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="min-h-11 w-full rounded-md px-4 py-2 text-sm font-bold"
                style={{
                  backgroundColor: normalizedAccent,
                  color: accentForeground,
                }}
              >
                Sponsor a child
              </button>

              <div
                className="space-y-3 border-l-4 pl-4 text-sm leading-6 text-gray-700 [&_blockquote]:italic [&_h3]:text-base [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
                style={{ borderColor: normalizedAccent }}
                dangerouslySetInnerHTML={{
                  __html:
                    aboutBiographyHtml ||
                    "<p>Your organization biography will appear here.</p>",
                }}
              />
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
