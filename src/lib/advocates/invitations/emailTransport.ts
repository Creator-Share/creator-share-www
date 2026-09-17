import "server-only"

import nodemailer from "nodemailer"

import { assertAdvocateStagingEmailRecipientAllowed } from "@/lib/stagingOutboundEmail"

import { advocateInvitationMessageId } from "./emailMessageId"
import type { AdvocateInvitationEmailTransportConfig } from "./emailConfig"
import {
  AdvocateInvitationEmailTransportError,
  type AdvocateInvitationEmailTransport,
} from "./emailWorker"

interface NodemailerTransport {
  sendMail(message: Record<string, unknown>): Promise<{
    accepted?: unknown
    rejected?: unknown
  }>
}

export interface AdvocateInvitationEmailTransportDependencies {
  createTransport?: (options: Record<string, unknown>) => NodemailerTransport
}

export function createNodemailerAdvocateInvitationEmailTransport(
  config: AdvocateInvitationEmailTransportConfig,
  dependencies: AdvocateInvitationEmailTransportDependencies = {},
): AdvocateInvitationEmailTransport {
  const createTransport =
    dependencies.createTransport ??
    ((options: Record<string, unknown>) =>
      nodemailer.createTransport(options) as NodemailerTransport)
  const transport = createTransport({
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
  })

  return {
    async send(message) {
      let timeout: ReturnType<typeof setTimeout> | null = null
      const expectedMessageId = advocateInvitationMessageId(message.outboxId)
      if (
        message.providerMessageId !== expectedMessageId ||
        message.providerIdempotencyKey !==
          `advocate-invitation:${message.outboxId}`
      ) {
        throw new AdvocateInvitationEmailTransportError()
      }
      if (config.stagingRecipientPolicy !== undefined) {
        try {
          assertAdvocateStagingEmailRecipientAllowed(
            message.recipientEmail,
            config.stagingRecipientPolicy,
          )
        } catch {
          throw new AdvocateInvitationEmailTransportError({
            confirmedNotSent: true,
            failureCode: "email_delivery_rejected",
          })
        }
      }

      try {
        const result = await Promise.race([
          transport.sendMail({
            from: { name: "Creator Share", address: config.fromAddress },
            to: message.recipientEmail,
            subject: message.subject,
            text: message.text,
            html: message.html,
            messageId: expectedMessageId,
            headers: {
              "X-Creator-Share-Delivery-Key": message.providerIdempotencyKey,
            },
            disableFileAccess: true,
            disableUrlAccess: true,
          }),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new AdvocateInvitationEmailTransportError()),
              config.timeoutMilliseconds,
            )
          }),
        ])
        const accepted = Array.isArray(result.accepted) ? result.accepted : []
        const rejected = Array.isArray(result.rejected) ? result.rejected : []
        if (accepted.length !== 1 || rejected.length > 0) {
          throw new AdvocateInvitationEmailTransportError({
            confirmedNotSent: accepted.length === 0,
            failureCode:
              rejected.length > 0
                ? "email_delivery_rejected"
                : "email_provider_unavailable",
          })
        }
        return { providerMessageId: expectedMessageId }
      } catch (error) {
        if (error instanceof AdvocateInvitationEmailTransportError) {
          throw error
        }
        throw new AdvocateInvitationEmailTransportError()
      } finally {
        if (timeout !== null) clearTimeout(timeout)
      }
    },
  }
}
