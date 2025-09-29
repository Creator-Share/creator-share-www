// Telegram configuration (KISS + SOC)
export const telegramConfig = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '8268585751:AAHf1JGEJ1QvdveRYqRTDvQzHqKBt9dnl80',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
  appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
}