import "server-only"

// Telegram configuration (KISS + SOC)
export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN ?? "",
  chatId: process.env.TELEGRAM_CHAT_ID ?? "",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
}
