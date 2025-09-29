/**
 * Telegram Bot Service
 * Following SOLID principles for notification management
 */

import {
  TelegramMessage,
  TelegramNotificationService,
  TelegramConfig,
  TelegramApiResponse,
} from '@/types/telegram.types'
import { Beneficiaries } from "@/types"

// Single Responsibility Principle (SRP) - Telegram service only handles Telegram operations
export class TelegramBotService implements TelegramNotificationService {
  private readonly botToken: string;
  private readonly defaultChatId?: string;
  private readonly apiUrl: string;

  constructor(config: TelegramConfig) {
    this.botToken = config.botToken;
    this.defaultChatId = config.defaultChatId;
    this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
  }

  /**
   * Send a message to Telegram
   * @param message - The message text to send
   * @param chatId - Optional chat ID, uses default if not provided
   * @returns Promise<boolean> - Success status
   */
  async sendMessage(message: string, chatId?: string): Promise<boolean> {
    try {
      const targetChatId = chatId || this.defaultChatId;
      
      if (!targetChatId) {
        console.error('Telegram: No chat ID provided and no default chat ID configured');
        return false;
      }

      if (!message || message.trim().length === 0) {
        console.error('Telegram: Empty message provided');
        return false;
      }

      const telegramMessage: TelegramMessage = {
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      };

      const response = await fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: targetChatId,
          ...telegramMessage
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Telegram API error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        return false;
      }

      const responseData: TelegramApiResponse = await response.json();
      console.log('Telegram message sent successfully:', {
        messageId: responseData.result?.message_id,
        chatId: targetChatId
      });
      return true;
    } catch (error) {
      console.error('Telegram sendMessage error:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  /**
   * Send a photo to Telegram
   * @param photoUrl - URL to the photo
   * @param caption - Optional caption for the photo
   * @param chatId - Optional chat ID
   * @returns Promise<boolean> - Success status
   */
  async sendPhoto(photoUrl: string, caption?: string, chatId?: string): Promise<boolean> {
    try {
      const targetChatId = chatId || this.defaultChatId;
      
      if (!targetChatId) {
        console.error('Telegram: No chat ID provided and no default chat ID configured');
        return false;
      }

      if (!photoUrl || photoUrl.trim().length === 0) {
        console.error('Telegram: Empty photo URL provided');
        return false;
      }

      const response = await fetch(`${this.apiUrl}/sendPhoto`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: targetChatId,
          photo: photoUrl,
          caption: caption,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Telegram API photo error:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        return false;
      }

      const responseData: TelegramApiResponse = await response.json();
      console.log('Telegram photo sent successfully:', {
        messageId: responseData.result?.message_id,
        chatId: targetChatId
      });
      return true;
    } catch (error) {
      console.error('Telegram sendPhoto error:', {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  /**
   * Send a notification about a new child beneficiary
   * @param beneficiaryData - The beneficiary data
   * @param chatId - Optional chat ID
   */
  async sendChildCreatedNotification(beneficiaryData: Beneficiaries, chatId?: string): Promise<boolean> {
    try {
      // First, try to get the child's image
      const imageUrl = await this.getBeneficiaryImage(beneficiaryData.id);
      
      if (imageUrl) {
        // Send photo with caption
        const caption = this.formatChildCreatedMessage(beneficiaryData);
        return await this.sendPhoto(imageUrl, caption, chatId);
      } else {
        // Fallback to text message if no image
        const message = this.formatChildCreatedMessage(beneficiaryData);
        return await this.sendMessage(message, chatId);
      }
    } catch (error) {
      console.error('Error in sendChildCreatedNotification:', error);
      // Fallback to text message on error
      const message = this.formatChildCreatedMessage(beneficiaryData);
      return await this.sendMessage(message, chatId);
    }
  }

  /**
   * Get the first image URL for a beneficiary
   * @param beneficiaryId - The beneficiary ID
   * @returns Promise<string | null> - Image URL or null if not found
   */
  private async getBeneficiaryImage(beneficiaryId: string): Promise<string | null> {
    try {
      // Use the internal API to get beneficiary images
      const response = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/admin/beneficiaries/images/${beneficiaryId}`);
      
      if (!response.ok) {
        console.warn(`Failed to fetch images for beneficiary ${beneficiaryId}:`, response.status);
        return null;
      }

      const mediaData = await response.json();
      
      if (!Array.isArray(mediaData) || mediaData.length === 0) {
        console.log(`No images found for beneficiary ${beneficiaryId}`);
        return null;
      }

      // Filter for IMAGE type and get the first one
      const imageMedia = mediaData.filter((item: { type: string }) => item.type === "IMAGE");
      
      if (imageMedia.length === 0) {
        console.log(`No IMAGE type media found for beneficiary ${beneficiaryId}`);
        return null;
      }

      const firstImage = imageMedia[0];
      
      // Try to generate public URL using the media utility
      try {
        const { generatePublicUrl } = await import('@/utils/supabase/media');
        const publicUrl = generatePublicUrl(firstImage);
        console.log(`Generated public URL for beneficiary ${beneficiaryId}:`, publicUrl);
        return publicUrl;
      } catch (urlError) {
        console.warn('Failed to generate public URL, trying fallback:', urlError);
        // Fallback to image_url if available
        return firstImage.image_url || null;
      }
    } catch (error) {
      console.error(`Error fetching image for beneficiary ${beneficiaryId}:`, error);
      return null;
    }
  }

  /**
   * Format the child created message
   * @param beneficiaryData - The beneficiary data
   */
  private formatChildCreatedMessage(beneficiaryData: Beneficiaries): string {
    const {
      name,
      username,
      gender,
      age,
      country,
      location_str,
      budget_goal,
      introduction
    } = beneficiaryData;

    return `
🎉 <b>New Child Added!</b>

👤 <b>Name:</b> ${name}
🔗 <b>Username:</b> @${username}
👶 <b>Gender:</b> ${gender}
📅 <b>Age:</b> ${age || 'Not specified'}
🌍 <b>Country:</b> ${country || 'Not specified'}
📍 <b>Location:</b> ${location_str || 'Not specified'}
💰 <b>Goal:</b> $${budget_goal ? (budget_goal / 100).toFixed(2) : 'Not specified'}
📝 <b>Introduction:</b> ${introduction || 'No introduction provided'}

#NewChild #Beneficiary #CreatorShare
    `.trim();
  }
}

// Dependency Inversion Principle (DIP) - Factory function for easy testing and configuration
export function createTelegramService(): TelegramNotificationService {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  return new TelegramBotService({
    botToken,
    defaultChatId: process.env.TELEGRAM_CHAT_ID
  });
}

// Utility function for sending child creation notifications
export async function notifyChildCreated(beneficiaryData: Beneficiaries): Promise<void> {
  try {
    // Validate required environment variables
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN not configured - skipping notification');
      return;
    }

    const telegramService = createTelegramService();
    const success = await telegramService.sendChildCreatedNotification(beneficiaryData);
    
    if (!success) {
      console.warn('Telegram notification failed for child:', beneficiaryData.id);
    }
  } catch (error) {
    console.error('Failed to send Telegram notification:', {
      childId: beneficiaryData?.id,
      error: error instanceof Error ? error.message : error
    });
    // Don't throw - notification failure shouldn't break the main flow
  }
}