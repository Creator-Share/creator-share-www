export function sponsorWelcomeMessageId(outboxId: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      outboxId,
    )
  ) {
    throw new Error("sponsor_welcome_email_message_id_invalid")
  }
  return `<sponsor-welcome.${outboxId}@creatorshare.com>`
}
