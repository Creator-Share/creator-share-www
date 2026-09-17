import { readFileSync } from "node:fs"
import Module, { createRequire } from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

import {
  classifyPasswordChangeResponse,
  classifyPasswordRecoveryRequestResponse,
  classifyPasswordRecoveryVerificationResponse,
  normalizePasswordRecoveryEmail,
} from "../../src/lib/auth/passwordRecoveryClient"

type SponsorshipCryptoModule =
  typeof import("../../src/lib/sponsorships/crypto")
type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

/* The parity check loads the canonical server implementation only in this
 * Node test. The client helper remains free of server-only imports. */
const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/auth/password-recovery-client.spec.ts"),
)
let sponsorshipCrypto: SponsorshipCryptoModule
try {
  sponsorshipCrypto = testRequire(
    "../../src/lib/sponsorships/crypto",
  ) as SponsorshipCryptoModule
} finally {
  nodeModule._load = originalModuleLoad
}

const { normalizeSponsorEmailV1 } = sponsorshipCrypto

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

test.describe("password recovery client contracts", () => {
  test("stays aligned with canonical server email normalization", () => {
    const accepted = [
      "  Ａlice.Sponsor+Launch@Ｅxample.COM  ",
      "First.Last+tag@gmail.com",
      "Usér@Exämple.com",
      "a@b",
      `${"a".repeat(64)}@example.com`,
      `name@${"a".repeat(63)}.com`,
    ]
    const rejected = [
      "",
      "plain-address",
      "two@@example.com",
      ".first@example.com",
      "last.@example.com",
      "two..dots@example.com",
      "space inside@example.com",
      "line@example.com\nBcc: victim@example.com",
      'quoted"local@example.com',
      "local@[127.0.0.1]",
      "user@-example.com",
      "user@example-.com",
      "user@example..com",
      `${"a".repeat(65)}@example.com`,
      `user@${"a".repeat(64)}.com`,
      `${"é".repeat(33)}@example.com`,
    ]

    for (const candidate of accepted) {
      expect(normalizePasswordRecoveryEmail(candidate)).toBe(
        normalizeSponsorEmailV1(candidate),
      )
    }
    for (const candidate of rejected) {
      expect(normalizePasswordRecoveryEmail(candidate)).toBeNull()
      expect(() => normalizeSponsorEmailV1(candidate)).toThrow()
    }
  })

  test("accepts only the exact uniform issuance response", () => {
    expect(
      classifyPasswordRecoveryRequestResponse(202, {
        status: "check-email",
      }),
    ).toBe("accepted")
    expect(
      classifyPasswordRecoveryRequestResponse(400, {
        error: "invalid-request",
      }),
    ).toBe("rejected")

    for (const [status, body] of [
      [200, { message: "Code sent to your email." }],
      [200, { status: "check-email" }],
      [202, { status: "check-email", email: "sponsor@example.com" }],
      [202, { status: "sent" }],
      [202, null],
      [400, { error: "invalid-request", detail: "contact" }],
      [503, { error: "unavailable" }],
    ] as const) {
      expect(classifyPasswordRecoveryRequestResponse(status, body)).toBe(
        "ambiguous",
      )
    }
  })

  test("exactly classifies verification success and rejection", () => {
    expect(
      classifyPasswordRecoveryVerificationResponse(200, {
        message: "OTP verified successfully.",
      }),
    ).toBe("accepted")

    for (const error of ["verification-failed", "invalid-request"]) {
      expect(classifyPasswordRecoveryVerificationResponse(400, { error })).toBe(
        "rejected",
      )
    }

    for (const [status, body] of [
      [200, { message: "OTP verified successfully.", extra: true }],
      [200, { status: "verified" }],
      [400, { error: "provider-detail" }],
      [503, { error: "verification-unavailable" }],
      [200, null],
    ] as const) {
      expect(classifyPasswordRecoveryVerificationResponse(status, body)).toBe(
        "ambiguous",
      )
    }
  })

  test("exactly classifies password change responses", () => {
    expect(
      classifyPasswordChangeResponse(200, {
        message: "Password reset successful! User has been logged out.",
      }),
    ).toBe("accepted")
    expect(
      classifyPasswordChangeResponse(400, { error: "invalid-request" }),
    ).toBe("rejected")
    expect(classifyPasswordChangeResponse(401, { error: "unauthorized" })).toBe(
      "unauthorized",
    )

    for (const [status, body] of [
      [200, { message: "Password reset successful!" }],
      [
        200,
        {
          message: "Password reset successful! User has been logged out.",
          extra: true,
        },
      ],
      [400, { error: "provider-detail" }],
      [503, { error: "unavailable" }],
      [200, null],
    ] as const) {
      expect(classifyPasswordChangeResponse(status, body)).toBe("ambiguous")
    }
  })
})

test.describe("password recovery source privacy", () => {
  const requestPage = source("src/app/forgot-password/page.tsx")
  const verificationPage = source("src/app/forgot-password/verify/page.tsx")
  const verificationForm = source(
    "src/app/forgot-password/PasswordRecoveryVerificationForm.tsx",
  )
  const resetPage = source("src/app/forgot-password/reset/page.tsx")
  const helper = source("src/lib/auth/passwordRecoveryClient.ts")
  const combined = [
    requestPage,
    verificationPage,
    verificationForm,
    resetPage,
    helper,
  ].join("\n")

  test("keeps contact out of URLs, browser persistence, and history state", () => {
    expect(combined).not.toMatch(/(?:localStorage|sessionStorage)/)
    expect(combined).not.toMatch(/document\.cookie/)
    expect(combined).not.toMatch(/history\.(?:pushState|replaceState)/)
    expect(combined).not.toContain("?email=")
    expect(combined).not.toContain("encodeURIComponent")
    expect(verificationPage).not.toContain("useSearchParams")
  })

  test("transitions exact issuance inline with an already-code path", () => {
    expect(requestPage).toContain('type RecoveryStep = "request" | "verify"')
    expect(requestPage).toContain('setStep("verify")')
    expect(requestPage).toContain("<PasswordRecoveryVerificationForm")
    expect(requestPage).toContain("Already have a code")
    expect(requestPage).toContain("Enter a received code")
    expect(requestPage).toContain("operationEpoch")
    expect(requestPage).not.toContain("router.push")
    expect(requestPage).not.toContain("router.replace")
  })

  test("collects both fields in the reusable fresh-tab form", () => {
    expect(verificationPage).toContain("<PasswordRecoveryVerificationForm")
    expect(verificationForm).toContain('label="Email Address"')
    expect(verificationForm).toContain('label="Verification code"')
    expect(verificationForm).toContain('inputMode="email"')
    expect(verificationForm).toContain('autoComplete="one-time-code"')
    expect(verificationForm).toContain('pattern="[0-9]{6}"')
    expect(verificationForm).toContain('role="status"')
    expect(verificationForm).toContain("operationEpoch")
    expect(verificationForm).toMatch(
      /clearSensitiveState\(\)[\s\S]{0,100}router\.replace\("\/forgot-password\/reset"\)/,
    )
  })

  test("hardens password entry and exact response handling", () => {
    expect(resetPage).toContain("classifyPasswordChangeResponse")
    expect(resetPage).toContain('autoComplete="new-password"')
    expect(resetPage).toContain("aria-label={showPassword")
    expect(resetPage).toContain('type="button"')
    expect(resetPage).toContain("operationEpoch")
    expect(resetPage).toContain("clearTimeout")
    expect(resetPage).toContain("data.password !== data.confirmPassword")
    expect(resetPage).toContain(
      "value === password || PASSWORD_MISMATCH_MESSAGE",
    )
    expect(resetPage).toContain("handleSubmit(onSubmit, onInvalid)")
    expect(resetPage).not.toMatch(/responseBody\.error|throw new Error/)
  })
})
