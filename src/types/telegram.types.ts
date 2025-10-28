import { Beneficiaries } from "./index"
// Interface Segregation Principle (ISP) - Define specific interfaces
export interface TelegramMessage {
  text: string;
  parse_mode?: 'HTML' | 'Markdown';
  disable_web_page_preview?: boolean;
}

export interface TelegramPhotoMessage {
  photo: string; // URL to the image
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown';
}

export interface TelegramVideoMessage {
  video: string; // URL to the video
  caption?: string;
  parse_mode?: 'HTML' | 'Markdown';
}

export interface SponsorshipNotificationData {
  sponsorName: string;
  sponsorEmail: string;
  amount: number;
  beneficiaryId?: string | null;
  beneficiaryName: string;
  paymentMethod: string;
  paymentReference: string;
  interval?: string;
}

export interface TelegramNotificationService {
  sendMessage(message: string, chatId?: string): Promise<boolean>;
  sendPhoto(photoUrl: string, caption?: string, chatId?: string): Promise<boolean>;
  sendChildCreatedNotification(beneficiaryData: Beneficiaries, chatId?: string): Promise<boolean>;
  sendSponsorshipNotification(sponsorshipData: SponsorshipNotificationData, chatId?: string): Promise<boolean>;
}

export interface TelegramConfig {
  botToken: string;
  defaultChatId?: string;
}

// Additional types for better type safety
export interface TelegramApiResponse {
  ok: boolean;
  result?: Record<string, unknown>;
  description?: string;
  error_code?: number;
}

export interface TelegramSendMessageResponse {
  ok: boolean;
  result?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text: string;
  };
  error_code?: number;
  description?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text: string;
  };
}