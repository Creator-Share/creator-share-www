import "server-only"

import nodemailer from "nodemailer"

import type { SponsorWelcomeEmailTransportConfig } from "@/lib/sponsorships/email/sponsorWelcomeEmailConfig"
import { sponsorWelcomeMessageId } from "@/lib/sponsorships/email/sponsorWelcomeEmailMessageId"
import {
  SponsorWelcomeEmailTransportError,
  type SponsorWelcomeEmailTransport,
} from "@/lib/sponsorships/email/sponsorWelcomeEmailWorker"

interface NodemailerTransport {
  sendMail(message: Record<string, unknown>): Promise<{
    accepted?: unknown
    rejected?: unknown
  }>
}

export interface SponsorWelcomeEmailTransportDependencies {
  createTransport?: (options: Record<string, unknown>) => NodemailerTransport
}

export { sponsorWelcomeMessageId }

export function createNodemailerSponsorWelcomeEmailTransport(
  config: SponsorWelcomeEmailTransportConfig,
  dependencies: SponsorWelcomeEmailTransportDependencies = {},
): SponsorWelcomeEmailTransport {
  const transportOptions: Record<string, unknown> = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.username, pass: config.password },
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    connectionTimeout: Math.min(10_000, config.timeoutMilliseconds),
    greetingTimeout: Math.min(10_000, config.timeoutMilliseconds),
    socketTimeout: config.timeoutMilliseconds,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  }
  const createTransport =
    dependencies.createTransport ??
    ((options: Record<string, unknown>) =>
      nodemailer.createTransport(options) as NodemailerTransport)
  const transport = createTransport(transportOptions)

  return {
    async send(message) {
      let timeout: ReturnType<typeof setTimeout> | null = null
      try {
        const messageId = sponsorWelcomeMessageId(message.outboxId)
        if (message.providerMessageId !== messageId) {
          throw new SponsorWelcomeEmailTransportError()
        }
        const result = await Promise.race([
          transport.sendMail({
            from: { name: "Creator Share", address: config.fromAddress },
            to: message.recipientEmail,
            subject: message.subject,
            text: message.text,
            html: message.html,
            messageId,
            disableFileAccess: true,
            disableUrlAccess: true,
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new SponsorWelcomeEmailTransportError()),
              config.timeoutMilliseconds,
            )
          }),
        ])
        if (
          !Array.isArray(result.accepted) ||
          result.accepted.length < 1 ||
          (Array.isArray(result.rejected) && result.rejected.length > 0)
        ) {
          throw new SponsorWelcomeEmailTransportError()
        }
        return { providerMessageId: messageId }
      } catch {
        throw new SponsorWelcomeEmailTransportError()
      } finally {
        if (timeout !== null) clearTimeout(timeout)
      }
    },
  }
}
