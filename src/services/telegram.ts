/**
 * Telegram Bot Service
 * Following SOLID principles for notification management
 */

import {
  TelegramNotificationService,
  TelegramConfig,
  SponsorshipNotificationData,
} from "@/types/telegram.types"
import { Beneficiaries } from "@/types"
import { formatMoney } from "@/utils/currency"
import {
  filterExistingMediaRows,
  getExternalTelegramImageUrl,
  MediaRow,
} from "@/utils/supabase/media"
import { createServiceRoleClient } from "@/utils/supabase/server"

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

      const telegramMessage: { text: string; parse_mode?: 'HTML' | 'Markdown'; disable_web_page_preview?: boolean } = {
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
   * Send a notification about a new sponsorship
   * @param sponsorshipData - The sponsorship data
   * @param chatId - Optional chat ID
   */
  async sendSponsorshipNotification(
    sponsorshipData: SponsorshipNotificationData,
    chatId?: string
  ): Promise<boolean> {
    try {
      const message = this.formatSponsorshipMessage(sponsorshipData);
      return await this.sendMessage(message, chatId);
    } catch (error) {
      console.error('Error sending sponsorship notification:', {
        error: error instanceof Error ? error.message : error,
        sponsorshipData: {
          ...sponsorshipData,
          sponsorEmail: '[REDACTED]' // Don't log sensitive email data
        }
      });
      return false;
    }
  }

  /**
   * Get the first image URL for a beneficiary
   * @param beneficiaryId - The beneficiary ID
   * @returns Promise<string | null> - Image URL or null if not found
   */
  private async getBeneficiaryImage(beneficiaryId: string): Promise<string | null> {
    try {
      const supabase = createServiceRoleClient()
      const { data: mediaData, error } = await supabase
        .from("media")
        .select("*")
        .eq("parent_id", beneficiaryId)
        .eq("type", "IMAGE")
        .order("weight", { ascending: false })
        .limit(10)

      if (error) {
        console.warn(`Failed to fetch images for beneficiary ${beneficiaryId}:`, error)
        return null;
      }

      if (!mediaData || mediaData.length === 0) {
        return null;
      }

      const existingMedia = await filterExistingMediaRows(
        supabase,
        mediaData as unknown as MediaRow[],
      )
      if (existingMedia.length === 0) return null

      return getExternalTelegramImageUrl(existingMedia[0])
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

  /**
   * Format the sponsorship received message
   * @param sponsorshipData - The sponsorship data
   */
  private formatSponsorshipMessage(sponsorshipData: SponsorshipNotificationData): string {
    const {
      beneficiaryName,
      amount,
      chargedCurrency,
      interval,
      sponsorName,
      sponsorEmail,
      paymentMethod
    } = sponsorshipData;

    const amountFormatted = chargedCurrency
      ? formatMoney(amount, chargedCurrency)
      : `$${(amount / 100).toFixed(2)}`;
    const intervalText = interval === 'month' ? 'Monthly' : interval === 'one_time' ? 'One-time' : 'Yearly';
    const sponsorDisplayName = sponsorName || sponsorEmail?.split('@')[0] || 'Anonymous';

    return `
🎉 <b>New Sponsorship Received!</b>

👤 <b>Beneficiary:</b> ${beneficiaryName}
💰 <b>Amount:</b> ${amountFormatted}
🔄 <b>Type:</b> ${intervalText}${interval === 'month' || interval === 'year' ? ' Recurring' : ''}
💳 <b>Payment Method:</b> ${paymentMethod}
👨‍💼 <b>Sponsor:</b> ${sponsorDisplayName}
📧 <b>Email:</b> ${sponsorEmail || 'Not provided'}

#NewSponsorship #CreatorShare #ThankYou
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

/**
 * Add utility function for sponsorship notifications
 */
export async function notifySponsorshipReceived(sponsorshipData: SponsorshipNotificationData): Promise<void> {
  try {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN not configured - skipping sponsorship notification');
      return;
    }

    const telegramService = createTelegramService();
    const success = await telegramService.sendSponsorshipNotification(sponsorshipData);
    
    if (!success) {
      console.warn('Telegram sponsorship notification failed');
    }
  } catch (error) {
    console.error('Failed to send Telegram sponsorship notification:', {
      error: error instanceof Error ? error.message : error
    });
    // Don't throw - notification failure shouldn't break the main flow
  }
}
