import { NextResponse } from "next/server"
import { createTelegramService } from "@/services/telegram"

export async function POST() {
  try {
    // Check if Telegram is configured
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ 
        error: "Telegram bot token not configured" 
      }, { status: 400 })
    }

    if (!process.env.TELEGRAM_CHAT_ID) {
      return NextResponse.json({ 
        error: "Telegram chat ID not configured" 
      }, { status: 400 })
    }

    // Create a test message
    const testMessage = `
🤖 <b>Telegram Bot Test</b>

✅ Bot is working correctly!
📅 Time: ${new Date().toISOString()}
🔧 Environment: ${process.env.NODE_ENV || 'development'}

#Test #TelegramBot #CreatorShare
    `.trim();

    // Send test message
    const telegramService = createTelegramService()
    const success = await telegramService.sendMessage(testMessage)

    if (success) {
      return NextResponse.json({ 
        message: "Test message sent successfully",
        timestamp: new Date().toISOString()
      })
    } else {
      return NextResponse.json({ 
        error: "Failed to send test message" 
      }, { status: 500 })
    }
  } catch (error) {
    console.error('Telegram test error:', error)
    return NextResponse.json({ 
      error: error instanceof Error ? error.message : "Unknown error" 
    }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ 
    message: "Use POST method to test Telegram bot",
    requiredEnvVars: [
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID"
    ]
  })
}