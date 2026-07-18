"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"

import { parseSponsorClaimFragment } from "./claimFragment"

type ClaimView =
  | "loading"
  | "intro"
  | "starting"
  | "check-email"
  | "completing"
  | "success"
  | "invalid-link"
  | "auth-error"
  | "invalid-or-expired"
  | "email-mismatch"
  | "account-conflict"
  | "unauthenticated"
  | "unavailable"

type StartResponse = {
  status?: "ready" | "check-email" | "unavailable"
}

type CompleteResponse = {
  linkedSubscriptionCount?: number
  error?:
    | "unauthenticated"
    | "invalid-or-expired"
    | "email-mismatch"
    | "account-conflict"
    | "unavailable"
}

function replacePageState(state: string) {
  const url = new URL(window.location.href)
  url.hash = ""
  url.search = ""
  url.searchParams.set("state", state)
  window.history.replaceState(null, "", `${url.pathname}${url.search}`)
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    return {} as T
  }
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-100 border-t-[#2b7ff9]"
    />
  )
}

function ShieldIcon({ success = false }: { success?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${
        success ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-[#1c3c8c]"
      }`}
    >
      {success ? (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
          <path
            d="m5 12 4 4L19 6"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none">
          <path
            d="M12 3 5 6v5c0 4.8 2.9 8.2 7 10 4.1-1.8 7-5.2 7-10V6l-7-3Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 12 11 13.5l3.5-4"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </span>
  )
}

export default function ClaimAccountClient() {
  const started = useRef(false)
  const [view, setView] = useState<ClaimView>("loading")
  const [linkedCount, setLinkedCount] = useState<number | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function completeClaim() {
      setView("completing")
      const response = await fetch("/api/sponsor-account/complete", {
        method: "POST",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      }).catch(() => null)

      if (!response) {
        replacePageState("unavailable")
        setView("unavailable")
        return
      }

      const result = await readJson<CompleteResponse>(response)
      if (
        response.ok &&
        Number.isSafeInteger(result.linkedSubscriptionCount) &&
        (result.linkedSubscriptionCount ?? -1) >= 0
      ) {
        setLinkedCount(result.linkedSubscriptionCount ?? 0)
        replacePageState("complete")
        setView("success")
        return
      }

      const errorView: ClaimView =
        result.error === "unauthenticated" ||
        result.error === "invalid-or-expired" ||
        result.error === "email-mismatch" ||
        result.error === "account-conflict" ||
        result.error === "unavailable"
          ? result.error
          : "unavailable"
      replacePageState(errorView)
      setView(errorView)
    }

    async function startClaim(payload: { token: string; email: string }) {
      setView("starting")
      const response = await fetch("/api/sponsor-account/start", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }).catch(() => null)

      if (!response) {
        replacePageState("unavailable")
        setView("unavailable")
        return
      }

      const result = await readJson<StartResponse>(response)
      if (result.status === "ready") {
        replacePageState("ready")
        await completeClaim()
        return
      }
      if (result.status === "unavailable") {
        replacePageState("unavailable")
        setView("unavailable")
        return
      }

      replacePageState("check-email")
      setView("check-email")
    }

    const currentUrl = new URL(window.location.href)
    const privateFragment = currentUrl.hash
    currentUrl.hash = ""
    window.history.replaceState(
      null,
      "",
      `${currentUrl.pathname}${currentUrl.search}`,
    )

    if (privateFragment) {
      const payload = parseSponsorClaimFragment(privateFragment)
      if (!payload) {
        replacePageState("invalid-link")
        setView("invalid-link")
        return
      }
      void startClaim(payload)
      return
    }

    const state = currentUrl.searchParams.get("state")
    if (state === "ready") {
      void completeClaim()
    } else if (state === "auth-error") {
      setView("auth-error")
    } else if (state === "check-email") {
      setView("check-email")
    } else if (state === "complete") {
      setView("success")
    } else if (
      state === "invalid-or-expired" ||
      state === "email-mismatch" ||
      state === "account-conflict" ||
      state === "unauthenticated" ||
      state === "unavailable"
    ) {
      setView(state)
    } else {
      setView("intro")
    }
  }, [])

  const loading =
    view === "loading" || view === "starting" || view === "completing"

  let heading = "Secure your sponsorship account"
  let body =
    "Use the private link in your Creator Share welcome email to begin. You will not need to create or remember a password."

  if (view === "starting") {
    heading = "Preparing your secure sign-in"
    body = "This should take only a moment."
  } else if (view === "completing") {
    heading = "Linking your sponsorships"
    body = "We are securely connecting your sponsorship history to your account."
  } else if (view === "check-email") {
    heading = "Check your email"
    body =
      "If the welcome link is eligible, we sent a secure sign-in link. Open it on this device and in this browser. If nothing arrives within a few minutes, the welcome link may have expired."
  } else if (view === "success") {
    heading = "Welcome to the family"
    body =
      linkedCount === null
        ? "Your sponsorship account is ready."
        : linkedCount === 1
          ? "Your account is ready, and one sponsorship is now linked."
          : `Your account is ready, and ${linkedCount} sponsorships are now linked.`
  } else if (view === "invalid-link") {
    heading = "This welcome link is incomplete"
    body =
      "Open the original link from your Creator Share welcome email. If it still does not work, contact our support team."
  } else if (view === "auth-error") {
    heading = "That sign-in link has expired"
    body =
      "Return to your Creator Share welcome email and open the account link again to request a fresh secure sign-in."
  } else if (view === "invalid-or-expired") {
    heading = "This account link is no longer available"
    body =
      "The link may have expired or already been used. If your sponsorships are missing, contact our support team."
  } else if (view === "email-mismatch") {
    heading = "Use the email from your sponsorship"
    body =
      "The email confirmed by your sign-in does not match this sponsorship. Return to the original welcome email and try again with that address."
  } else if (view === "account-conflict") {
    heading = "These sponsorships are already linked"
    body =
      "We could not move this sponsorship history to the signed-in account. Contact our support team and we will help review it safely."
  } else if (view === "unauthenticated") {
    heading = "Your secure sign-in was not completed"
    body =
      "Return to your welcome email and begin again. Be sure to open the secure sign-in link in this browser."
  } else if (view === "unavailable") {
    heading = "We could not finish just now"
    body =
      "Your sponsorship is safe. Please return to the welcome email and try again in a few minutes."
  }

  return (
    <main className="flex min-h-[calc(100vh-7rem)] items-center justify-center px-0 py-8 sm:px-4 sm:py-12">
      <section
        aria-labelledby="claim-heading"
        aria-busy={loading}
        className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm sm:px-10 sm:py-12"
      >
        {loading ? <Spinner /> : <ShieldIcon success={view === "success"} />}

        <div className="mt-6" role="status" aria-live="polite">
          <h1
            id="claim-heading"
            className="text-2xl font-bold tracking-tight text-[#03150e] sm:text-3xl"
          >
            {heading}
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-slate-600">
            {body}
          </p>
        </div>

        {view === "success" && (
          <Link
            href="/app"
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#2b7ff9] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1c66cf] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
          >
            Manage my sponsorships
          </Link>
        )}

        {!loading && view !== "success" && view !== "check-email" && (
          <Link
            href="/"
            className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#2b7ff9] px-5 py-3 font-semibold text-white transition-colors hover:bg-[#1c66cf] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
          >
            Return to Creator Share
          </Link>
        )}

        {view === "check-email" && (
          <p className="mt-8 text-sm leading-6 text-slate-500">
            You can close this page after opening the secure email link. No
            password is required.
          </p>
        )}

        {(view === "invalid-link" ||
          view === "invalid-or-expired" ||
          view === "email-mismatch" ||
          view === "account-conflict") && (
          <p className="mt-5 text-sm text-slate-500">
            Need help?{" "}
            <a
              className="font-semibold text-[#1c66cf] underline decoration-blue-200 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
              href="mailto:support@creatorshare.com"
            >
              Contact support
            </a>
          </p>
        )}
      </section>
    </main>
  )
}
