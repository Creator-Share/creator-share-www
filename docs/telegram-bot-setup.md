# Telegram Bot Setup Guide

This document explains how to set up and configure the Telegram bot integration for Creator Share notifications.

## Overview

The Telegram bot integration automatically sends notifications to your Telegram chat whenever a new child beneficiary is created in the admin panel. The implementation follows SOLID principles and includes proper error handling.

## Features

- ✅ Automatic notifications when new children are added
- ✅ Rich HTML-formatted messages with child details
- ✅ **Image support** - Sends child photos when available
- ✅ Graceful error handling (notifications won't break child creation)
- ✅ Configurable chat ID and bot token
- ✅ Test endpoint for verification
- ✅ Comprehensive logging

## Setup Instructions

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Start a chat with BotFather
3. Send `/newbot` command
4. Follow the prompts to create your bot:
   - Choose a name for your bot (e.g., "Creator Share Notifications")
   - Choose a username (must end with 'bot', e.g., "creator_share_bot")
5. BotFather will provide you with a bot token like: `{REPL}`

### 2. Get Your Chat ID

1. Add your bot to a group or start a private chat with it
2. Send any message to the bot (e.g., "/start")
3. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
4. Look for the `chat.id` in the response (it will be a number like `-123456789`)

### 3. Configure Environment Variables

Add the following variables to your `.env.local` file:

```bash
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN={REPL}
TELEGRAM_CHAT_ID=-123456789
```

### 4. Test the Integration

You can test the Telegram bot using the test endpoint:

```bash
# Test the bot (replace with your domain)
curl -X POST https://your-domain.com/api/test/telegram
```

Or visit: `https://your-domain.com/api/test/telegram` in your browser and use the POST method.

## Message Format

When a new child is created, the bot will send a message like this:

**With Image (preferred):**
- Photo of the child with caption containing all details

**Without Image (fallback):**
```
🎉 New Child Added!

👤 Name: John Doe
🔗 Username: @johndoe
👶 Gender: Boy
📅 Age: 12
🌍 Country: Philippines
📍 Location: Manila, Philippines
💰 Goal: $500.00
📝 Introduction: A bright young boy who loves to learn...

#NewChild #Beneficiary #CreatorShare
```

**Note:** If the child has an image uploaded, the notification will be sent as a photo with the details as the caption. If no image is available, it falls back to a text-only message.

## Architecture

The implementation follows SOLID principles:

### Single Responsibility Principle (SRP)
- `TelegramBotService`: Only handles Telegram operations
- `notifyChildCreated`: Only handles child creation notifications

### Open/Closed Principle (OCP)
- Service is extensible through interfaces
- Easy to add new notification types

### Liskov Substitution Principle (LSP)
- `TelegramNotificationService` interface allows for different implementations

### Interface Segregation Principle (ISP)
- Clean, focused interfaces
- No unnecessary dependencies

### Dependency Inversion Principle (DIP)
- Factory function for easy testing
- Environment-based configuration

## Error Handling

- Notifications are sent asynchronously and won't block child creation
- Comprehensive error logging
- Graceful fallbacks when Telegram is unavailable
- Environment variable validation

## Security Considerations

- Bot token is stored securely in environment variables
- No sensitive data is logged
- HTTPS-only communication with Telegram API

## Troubleshooting

### Bot Not Sending Messages
1. Check that `TELEGRAM_BOT_TOKEN` is correct
2. Verify `TELEGRAM_CHAT_ID` is correct
3. Ensure the bot has been started with `/start` command
4. Check server logs for error messages

### Common Issues
- **403 Forbidden**: Bot token is invalid or bot is blocked
- **400 Bad Request**: Chat ID is incorrect
- **Network errors**: Check internet connectivity and firewall settings

### Logs to Check
Look for these log messages:
- `Telegram message sent successfully` - Success
- `Telegram notification failed` - Failure
- `TELEGRAM_BOT_TOKEN not configured` - Missing configuration

## API Endpoints

### Test Endpoint
- **URL**: `/api/test/telegram`
- **Method**: `POST`
- **Purpose**: Test Telegram bot connectivity
- **Response**: Success/failure status

### Child Creation Integration
- **Location**: `/api/admin/beneficiaries/create`
- **Trigger**: Automatically when `beneficiary_type === "CHILD"`
- **Behavior**: Sends notification asynchronously

## Development

### Adding New Notification Types
1. Extend the `TelegramNotificationService` interface
2. Add new methods to `TelegramBotService`
3. Create utility functions for new notification types
4. Update the relevant API endpoints

### Testing
```typescript
import { createTelegramService } from '@/services/telegram'

const service = createTelegramService()
const success = await service.sendMessage('Test message')
console.log('Success:', success)
```

## Production Deployment

1. Ensure environment variables are set in production
2. Test the integration after deployment
3. Monitor logs for any notification failures
4. Consider setting up alerts for notification failures

---

For support or questions, please check the logs first and ensure all environment variables are properly configured.