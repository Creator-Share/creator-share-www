import { createRequire } from "node:module"
import Module from "node:module"
import { resolve } from "node:path"

import { expect, test } from "@playwright/test"

type NodeModuleLoader = (
  request: string,
  parent: unknown,
  isMain: boolean,
) => unknown

const nodeModule = Module as unknown as { _load: NodeModuleLoader }
const originalModuleLoad = nodeModule._load
nodeModule._load = function mockedModuleLoad(
  this: unknown,
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {}
  if (request === "@/lib/auth/supabaseEmailProofIssuer") {
    return {
      EMAIL_PROOF_AMBIGUOUS_RETRY_AFTER_SECONDS: 3_900,
      EMAIL_PROOF_ISSUER_WORST_CASE_DURATION_MILLISECONDS: 42_000,
    }
  }
  return originalModuleLoad.call(this, request, parent, isMain)
}
const testRequire = createRequire(
  resolve(process.cwd(), "tests/advocates/staging-outbound-email.spec.ts"),
)
const { loadAdvocateInvitationEmailTransportConfig } = testRequire(
  "../../src/lib/advocates/invitations/emailConfig",
) as typeof import("../../src/lib/advocates/invitations/emailConfig")
const { createNodemailerAdvocateInvitationEmailTransport } = testRequire(
  "../../src/lib/advocates/invitations/emailTransport",
) as typeof import("../../src/lib/advocates/invitations/emailTransport")
const { advocateInvitationMessageId } = testRequire(
  "../../src/lib/advocates/invitations/emailMessageId",
) as typeof import("../../src/lib/advocates/invitations/emailMessageId")
const { loadSponsorWelcomeEmailTransportConfig } = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailConfig",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailConfig")
const {
  createNodemailerSponsorWelcomeEmailTransport,
  sponsorWelcomeMessageId,
} = testRequire(
  "../../src/lib/sponsorships/email/sponsorWelcomeEmailTransport",
) as typeof import("../../src/lib/sponsorships/email/sponsorWelcomeEmailTransport")
const {
  advocateStagingLegacyEmailTransportSecurityOptions,
  assertAdvocateStagingLegacyEmailAllowed,
  assertAdvocateStagingEmailRecipientAllowed,
  isAdvocateStagingEmailRecipientAllowed,
} = testRequire(
  "../../src/lib/stagingOutboundEmail",
) as typeof import("../../src/lib/stagingOutboundEmail")
nodeModule._load = originalModuleLoad

const OUTBOX_ID = "11111111-1111-4111-8111-111111111111"
const STAGING_ORIGIN = "https://advocate-staging.creatorshare.com"
const MAILBOX_IDENTITY = "creator-share-staging@ethereal.email"
const CANARY_RECIPIENT =
  "creator-share-ff029-0123456789abcdef0123456789abcdef@example.com"

function stagingEnvironment(
  overrides: Record<string, string | undefined> = {},
) {
  return {
    NODE_ENV: "production",
    NEXT_PUBLIC_BASE_URL: STAGING_ORIGIN,
    EMAIL_HOST: "smtp.ethereal.email",
    EMAIL_PORT: "587",
    EMAIL_SECURE: "false",
    EMAIL_USER: MAILBOX_IDENTITY,
    EMAIL_PASSWORD: "sandbox-password",
    EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    ...overrides,
  }
}

test.describe("exact advocate staging outbound email boundary", () => {
  test("requires Ethereal submission with mandatory STARTTLS", () => {
    expect(
      advocateStagingLegacyEmailTransportSecurityOptions(stagingEnvironment()),
    ).toEqual({
      requireTLS: true,
      tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    })

    for (const loadConfig of [
      loadAdvocateInvitationEmailTransportConfig,
      loadSponsorWelcomeEmailTransportConfig,
    ]) {
      expect(loadConfig(stagingEnvironment()).stagingRecipientPolicy).toEqual({
        mailboxIdentity: MAILBOX_IDENTITY,
        canaryContract: "creator-share-ff029-v1",
      })

      for (const invalid of [
        { EMAIL_HOST: "smtp.creatorshare.com" },
        { EMAIL_HOST: "smtp.ethereal.email." },
        { EMAIL_PORT: "25" },
        { EMAIL_PORT: "465", EMAIL_SECURE: "true" },
        { EMAIL_SECURE: "true" },
        { EMAIL_USER: "release@creatorshare.com" },
        { EMAIL_USER: "Creator-Share-Staging@ethereal.email" },
      ]) {
        expect(() => loadConfig(stagingEnvironment(invalid))).toThrow(
          /email (?:worker|configuration) is unavailable/,
        )
      }
    }
  })

  test("does not change production or local SMTP configuration", () => {
    const production = {
      NODE_ENV: "production",
      NEXT_PUBLIC_BASE_URL: "https://creatorshare.com",
      EMAIL_HOST: "smtp.creatorshare.com",
      EMAIL_PORT: "465",
      EMAIL_SECURE: "true",
      EMAIL_USER: "release@creatorshare.com",
      EMAIL_PASSWORD: "production-password",
      EMAIL_FROM: '"Creator Share" <noreply@creatorshare.com>',
    }
    const local = {
      ...production,
      NODE_ENV: "test",
      NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
      EMAIL_HOST: "127.0.0.1",
      EMAIL_PORT: "1025",
      EMAIL_SECURE: "false",
    }

    for (const environment of [production, local]) {
      expect(
        loadAdvocateInvitationEmailTransportConfig(environment),
      ).not.toHaveProperty("stagingRecipientPolicy")
      expect(
        loadSponsorWelcomeEmailTransportConfig(environment),
      ).not.toHaveProperty("stagingRecipientPolicy")
    }
  })

  test("allows only the staging mailbox and the fixed FF029 canary contract", () => {
    const policy =
      loadSponsorWelcomeEmailTransportConfig(
        stagingEnvironment(),
      ).stagingRecipientPolicy!

    expect(
      isAdvocateStagingEmailRecipientAllowed(MAILBOX_IDENTITY, policy),
    ).toBe(true)
    expect(
      isAdvocateStagingEmailRecipientAllowed(
        MAILBOX_IDENTITY.toUpperCase(),
        policy,
      ),
    ).toBe(true)
    expect(
      isAdvocateStagingEmailRecipientAllowed(CANARY_RECIPIENT, policy),
    ).toBe(true)

    for (const recipient of [
      "real-person@gmail.com",
      "creator-share-ff029-too-short@example.com",
      "creator-share-ff029-0123456789ABCDEF0123456789ABCDEF@example.com",
      ` ${MAILBOX_IDENTITY}`,
      `${MAILBOX_IDENTITY}\nBcc: person@gmail.com`,
    ]) {
      expect(isAdvocateStagingEmailRecipientAllowed(recipient, policy)).toBe(
        false,
      )
      expect(() =>
        assertAdvocateStagingEmailRecipientAllowed(recipient, policy),
      ).toThrow("advocate_staging_outbound_email_boundary_rejected")
      expect(() =>
        assertAdvocateStagingLegacyEmailAllowed(
          recipient,
          stagingEnvironment(),
        ),
      ).toThrow("advocate_staging_outbound_email_boundary_rejected")
    }

    expect(() =>
      assertAdvocateStagingLegacyEmailAllowed(
        MAILBOX_IDENTITY,
        stagingEnvironment(),
      ),
    ).not.toThrow()
    expect(() =>
      assertAdvocateStagingLegacyEmailAllowed(
        CANARY_RECIPIENT,
        stagingEnvironment(),
      ),
    ).not.toThrow()
    expect(() =>
      assertAdvocateStagingLegacyEmailAllowed(MAILBOX_IDENTITY, {
        ...stagingEnvironment(),
        EMAIL_HOST: "smtp.creatorshare.com",
      }),
    ).toThrow("advocate_staging_outbound_email_boundary_rejected")
  })

  test("both transports reject a noncanary recipient before SMTP", async () => {
    let invitationSends = 0
    let welcomeSends = 0
    const invitation = createNodemailerAdvocateInvitationEmailTransport(
      loadAdvocateInvitationEmailTransportConfig(stagingEnvironment()),
      {
        createTransport(options) {
          expect(options).toMatchObject({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false,
            requireTLS: true,
            tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
          })
          return {
            async sendMail() {
              invitationSends += 1
              return { accepted: ["accepted"], rejected: [] }
            },
          }
        },
      },
    )
    const welcome = createNodemailerSponsorWelcomeEmailTransport(
      loadSponsorWelcomeEmailTransportConfig(stagingEnvironment()),
      {
        createTransport(options) {
          expect(options).toMatchObject({
            host: "smtp.ethereal.email",
            port: 587,
            secure: false,
            requireTLS: true,
            tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
          })
          return {
            async sendMail() {
              welcomeSends += 1
              return { accepted: ["accepted"], rejected: [] }
            },
          }
        },
      },
    )

    await expect(
      invitation.send({
        outboxId: OUTBOX_ID,
        providerMessageId: advocateInvitationMessageId(OUTBOX_ID),
        providerIdempotencyKey: `advocate-invitation:${OUTBOX_ID}`,
        recipientEmail: "real-person@gmail.com",
        subject: "Invitation",
        text: "Invitation",
        html: "<p>Invitation</p>",
      }),
    ).rejects.toMatchObject({
      confirmedNotSent: true,
      failureCode: "email_delivery_rejected",
    })
    await expect(
      welcome.send({
        outboxId: OUTBOX_ID,
        providerMessageId: sponsorWelcomeMessageId(OUTBOX_ID),
        recipientEmail: "real-person@gmail.com",
        subject: "Welcome",
        text: "Welcome",
        html: "<p>Welcome</p>",
      }),
    ).rejects.toThrow("sponsor_welcome_email_transport_failed")

    expect(invitationSends).toBe(0)
    expect(welcomeSends).toBe(0)

    await expect(
      invitation.send({
        outboxId: OUTBOX_ID,
        providerMessageId: advocateInvitationMessageId(OUTBOX_ID),
        providerIdempotencyKey: `advocate-invitation:${OUTBOX_ID}`,
        recipientEmail: CANARY_RECIPIENT,
        subject: "Invitation",
        text: "Invitation",
        html: "<p>Invitation</p>",
      }),
    ).resolves.toEqual({
      providerMessageId: advocateInvitationMessageId(OUTBOX_ID),
    })
    await expect(
      welcome.send({
        outboxId: OUTBOX_ID,
        providerMessageId: sponsorWelcomeMessageId(OUTBOX_ID),
        recipientEmail: MAILBOX_IDENTITY,
        subject: "Welcome",
        text: "Welcome",
        html: "<p>Welcome</p>",
      }),
    ).resolves.toEqual({
      providerMessageId: sponsorWelcomeMessageId(OUTBOX_ID),
    })
    expect(invitationSends).toBe(1)
    expect(welcomeSends).toBe(1)
  })
})
