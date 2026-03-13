/**
 * ClickUp Chat Service
 * Following SOLID principles for notification management
 * API Reference: https://developer.clickup.com/docs/chat
 *
 * The browser URL view ID (e.g. "8cqwf2x-1117") is NOT the same as the
 * API channel ID. This service automatically resolves the real channel ID
 * by calling GET /api/v3/workspaces/{workspaceId}/channels and matching
 * by name, then caches the result for subsequent calls.
 */

import {
  ClickUpNotificationService,
  ClickUpConfig,
  ClickUpApiResponse,
} from "@/types/clickup.types"
import { SponsorshipNotificationData } from "@/types/telegram.types"
import { Beneficiaries } from "@/types"

const CLICKUP_API_BASE = "https://api.clickup.com/api/v3"

// Single Responsibility Principle (SRP) - ClickUp service only handles ClickUp operations
export class ClickUpChatService implements ClickUpNotificationService {
  private readonly apiToken: string;
  private readonly workspaceId: string;
  private readonly directChannelId?: string;
  private readonly channelName: string;
  /** In-process cache so we only look up the channel ID once per service instance */
  private resolvedChannelId: string | null = null;

  constructor(config: ClickUpConfig) {
    this.apiToken = config.apiToken;
    this.workspaceId = config.workspaceId;
    this.directChannelId = config.channelId;
    this.channelName = config.channelName ?? "Live Updates";
  }

  /**
   * Resolve the API channel ID.
   *
   * Priority order:
   * 1. CLICKUP_CHANNEL_ID (fast path — use directly if set, e.g. the view ID "8cqwf2x-1117").
   * 2. Workspace channel lookup by name (used when no direct ID is configured).
   *
   * The result is cached so subsequent calls skip the resolution.
   */
  private async resolveChannelId(): Promise<string | null> {
    if (this.resolvedChannelId) return this.resolvedChannelId;

    // Fast path: use the directly-provided channel ID (URL view ID works with the v3 endpoint)
    if (this.directChannelId) {
      this.resolvedChannelId = this.directChannelId;
      return this.directChannelId;
    }

    // Slow path: look up the channel by name from the workspace channels list
    const lookupId = await this.lookupChannelIdByName();
    if (lookupId) {
      this.resolvedChannelId = lookupId;
      return lookupId;
    }

    console.error(
      "ClickUp: Could not resolve channel ID. " +
        "Set CLICKUP_CHANNEL_ID (the view ID from the channel URL, e.g. '8cqwf2x-1117') or " +
        "set CLICKUP_WORKSPACE_ID so the service can look up the channel automatically.",
    );
    return null;
  }

  /**
   * Call GET /api/v3/workspaces/{workspaceId}/chat/channels and return the ID
   * of the channel whose name matches this.channelName.
   * Reference: https://developer.clickup.com/reference/createchatmessage
   */
  private async lookupChannelIdByName(): Promise<string | null> {
    try {
      const response = await fetch(
        `${CLICKUP_API_BASE}/workspaces/${this.workspaceId}/chat/channels`,
        {
          headers: {
            Authorization: this.apiToken,
          },
        },
      );

      if (!response.ok) {
        const rawBody = await response.text();
        let errorDetail: ClickUpApiResponse | string;
        try {
          errorDetail = JSON.parse(rawBody) as ClickUpApiResponse;
        } catch {
          errorDetail = rawBody;
        }
        console.error("ClickUp: Failed to fetch channels list:", {
          status: response.status,
          error: errorDetail,
        });
        return null;
      }

      const data: unknown = await response.json();
      const channels: Array<{ id: string; name?: string }> = Array.isArray(data)
        ? (data as Array<{ id: string; name?: string }>)
        : ((data as { channels?: Array<{ id: string; name?: string }> }).channels ?? []);

      const target = this.channelName.toLowerCase();
      const channel = channels.find(
        (c) =>
          c.name?.toLowerCase() === target ||
          c.name?.toLowerCase().includes(target),
      );

      if (!channel) {
        console.error(
          `ClickUp: Channel "${this.channelName}" not found in workspace ${this.workspaceId}.`,
          {
            available: channels.map((c) => c.name).join(", ") || "(none returned)",
          },
        );
        return null;
      }

      return channel.id;
    } catch (error) {
      console.error("ClickUp: Error during channel lookup:", {
        error: error instanceof Error ? error.message : error,
      });
      return null;
    }
  }

  /**
   * Post a message to the configured ClickUp Chat channel (#Live Updates)
   * @param message - Markdown-formatted message content
   * @returns Promise<boolean> - Success status
   */
  async sendMessage(message: string): Promise<boolean> {
    try {
      if (!message || message.trim().length === 0) {
        console.error("ClickUp: Empty message provided");
        return false;
      }

      const channelId = await this.resolveChannelId();
      if (!channelId) {
        console.error("ClickUp: Could not resolve channel ID — message not sent");
        return false;
      }

      // Correct endpoint per https://developer.clickup.com/reference/createchatmessage:
      // POST /api/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/messages
      const response = await fetch(
        `${CLICKUP_API_BASE}/workspaces/${this.workspaceId}/chat/channels/${channelId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: this.apiToken,
          },
          body: JSON.stringify({
            type: "message",         // required field per API reference
            content: message,
            content_format: "text/md",
          }),
        },
      );

      if (!response.ok) {
        // Safely parse the error body — ClickUp may return HTML on auth/404 errors
        const rawBody = await response.text();
        let errorData: ClickUpApiResponse | string;
        try {
          errorData = JSON.parse(rawBody) as ClickUpApiResponse;
        } catch {
          errorData = rawBody;
        }
        console.error("ClickUp Chat API error:", {
          status: response.status,
          statusText: response.statusText,
          error: errorData,
          channelId,
        });
        // Reset cache on 404 so we re-resolve next time
        if (response.status === 404) {
          this.resolvedChannelId = null;
        }
        return false;
      }

      return true;
    } catch (error) {
      console.error("ClickUp sendMessage error:", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return false;
    }
  }

  /**
   * Send a notification about a new child beneficiary to the #Live Updates channel
   * @param beneficiaryData - The beneficiary data
   */
  async sendChildCreatedNotification(
    beneficiaryData: Beneficiaries,
  ): Promise<boolean> {
    try {
      const message = this.formatChildCreatedMessage(beneficiaryData);
      return await this.sendMessage(message);
    } catch (error) {
      console.error("Error in ClickUp sendChildCreatedNotification:", error);
      return false;
    }
  }

  /**
   * Send a notification about a new sponsorship to the #Live Updates channel
   * @param sponsorshipData - The sponsorship data
   */
  async sendSponsorshipNotification(
    sponsorshipData: SponsorshipNotificationData,
  ): Promise<boolean> {
    try {
      const message = this.formatSponsorshipMessage(sponsorshipData);
      return await this.sendMessage(message);
    } catch (error) {
      console.error("Error sending ClickUp sponsorship notification:", {
        error: error instanceof Error ? error.message : error,
        sponsorshipData: {
          ...sponsorshipData,
          sponsorEmail: "[REDACTED]",
        },
      });
      return false;
    }
  }

  /**
   * Format the child created message in Markdown
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
      introduction,
    } = beneficiaryData;

    return [
      "🎉 **New Child Added!**",
      "",
      `👤 **Name:** ${name}`,
      `🔗 **Username:** @${username}`,
      `👶 **Gender:** ${gender}`,
      `📅 **Age:** ${age ?? "Not specified"}`,
      `🌍 **Country:** ${country ?? "Not specified"}`,
      `📍 **Location:** ${location_str ?? "Not specified"}`,
      `💰 **Goal:** $${budget_goal ? (budget_goal / 100).toFixed(2) : "Not specified"}`,
      `📝 **Introduction:** ${introduction ?? "No introduction provided"}`,
      "",
      "#NewChild #Beneficiary #CreatorShare",
    ].join("\n");
  }

  /**
   * Format the sponsorship received message in Markdown
   * @param sponsorshipData - The sponsorship data
   */
  private formatSponsorshipMessage(
    sponsorshipData: SponsorshipNotificationData,
  ): string {
    const {
      beneficiaryName,
      amount,
      interval,
      sponsorName,
      sponsorEmail,
      paymentMethod,
    } = sponsorshipData;

    const amountFormatted = `$${(amount / 100).toFixed(2)}`;
    const intervalText = interval === "month" ? "Monthly" : "Yearly";
    const sponsorDisplayName =
      sponsorName || sponsorEmail?.split("@")[0] || "Anonymous";

    return [
      "🎉 **New Sponsorship Received!**",
      "",
      `👤 **Beneficiary:** ${beneficiaryName}`,
      `💰 **Amount:** ${amountFormatted}`,
      `🔄 **Type:** ${intervalText} ${interval ? "Recurring" : "One-time"}`,
      `💳 **Payment Method:** ${paymentMethod}`,
      `👨‍💼 **Sponsor:** ${sponsorDisplayName}`,
      `📧 **Email:** ${sponsorEmail ?? "Not provided"}`,
      "",
      "#NewSponsorship #CreatorShare #ThankYou",
    ].join("\n");
  }
}

// Dependency Inversion Principle (DIP) - Factory function for easy testing and configuration
export function createClickUpService(): ClickUpNotificationService {
  const apiToken = process.env.CLICKUP_API_TOKEN;
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID;

  if (!apiToken) {
    throw new Error("CLICKUP_API_TOKEN environment variable is required");
  }
  if (!workspaceId) {
    throw new Error("CLICKUP_WORKSPACE_ID environment variable is required");
  }

  return new ClickUpChatService({
    apiToken,
    workspaceId,
    // Optional: direct API channel ID override (skips the workspace channel lookup)
    channelId: process.env.CLICKUP_CHANNEL_ID,
    // Optional: name of the channel to find (default: "Live Updates")
    channelName: process.env.CLICKUP_CHANNEL_NAME,
  });
}

/**
 * Utility function for sending child creation notifications to ClickUp #Live Updates
 */
export async function notifyClickUpChildCreated(
  beneficiaryData: Beneficiaries,
): Promise<void> {
  try {
    if (!process.env.CLICKUP_API_TOKEN || !process.env.CLICKUP_WORKSPACE_ID) {
      console.warn(
        "CLICKUP_API_TOKEN or CLICKUP_WORKSPACE_ID not configured - skipping ClickUp notification",
      );
      return;
    }

    const clickUpService = createClickUpService();
    const success =
      await clickUpService.sendChildCreatedNotification(beneficiaryData);

    if (!success) {
      console.warn(
        "ClickUp notification failed for child:",
        beneficiaryData.id,
      );
    }
  } catch (error) {
    console.error("Failed to send ClickUp child notification:", {
      childId: beneficiaryData?.id,
      error: error instanceof Error ? error.message : error,
    });
    // Don't throw - notification failure shouldn't break the main flow
  }
}

/**
 * Utility function for sending sponsorship notifications to ClickUp #Live Updates
 */
export async function notifyClickUpSponsorshipReceived(
  sponsorshipData: SponsorshipNotificationData,
): Promise<void> {
  try {
    if (!process.env.CLICKUP_API_TOKEN || !process.env.CLICKUP_WORKSPACE_ID) {
      console.warn(
        "CLICKUP_API_TOKEN or CLICKUP_WORKSPACE_ID not configured - skipping ClickUp sponsorship notification",
      );
      return;
    }

    const clickUpService = createClickUpService();
    const success =
      await clickUpService.sendSponsorshipNotification(sponsorshipData);

    if (!success) {
      console.warn("ClickUp sponsorship notification failed");
    }
  } catch (error) {
    console.error("Failed to send ClickUp sponsorship notification:", {
      error: error instanceof Error ? error.message : error,
    });
    // Don't throw - notification failure shouldn't break the main flow
  }
}
