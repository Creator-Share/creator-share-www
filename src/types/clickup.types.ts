import { Beneficiaries } from "./index"
import { SponsorshipNotificationData } from "./telegram.types"

// Re-export SponsorshipNotificationData for shared use
export type { SponsorshipNotificationData }

// Interface Segregation Principle (ISP) - Define specific interfaces
export interface ClickUpMessage {
  content: string;
  content_format?: "text/md" | "text/plain";
}

export interface ClickUpConfig {
  apiToken: string;
  /** Workspace/Team ID from the ClickUp URL: app.clickup.com/{workspaceId}/... */
  workspaceId: string;
  /** Optional: direct API channel ID if already known (NOT the URL view ID) */
  channelId?: string;
  /** Optional: channel name to look up automatically (default: "Live Updates") */
  channelName?: string;
}

// Interface for the ClickUp notification service
export interface ClickUpNotificationService {
  sendMessage(message: string): Promise<boolean>;
  sendChildCreatedNotification(beneficiaryData: Beneficiaries): Promise<boolean>;
  sendSponsorshipNotification(sponsorshipData: SponsorshipNotificationData): Promise<boolean>;
}

// ClickUp Chat API response shape
export interface ClickUpApiResponse {
  id?: string;
  content?: string;
  error?: string;
  err?: string;
  ECODE?: string;
}
