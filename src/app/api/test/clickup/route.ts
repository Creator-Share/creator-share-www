import { NextResponse } from "next/server"

/**
 * Diagnostic test endpoint for ClickUp Chat integration.
 * API Reference: https://developer.clickup.com/reference/createchatmessage
 *
 * GET  /api/test/clickup  – shows required env vars
 * POST /api/test/clickup  – probes multiple ClickUp API endpoint variants
 *                           to find which one works for this workspace, then
 *                           sends a test message to #Live Updates.
 */

async function probeUrl(
  url: string,
  method: "GET" | "POST",
  headers: Record<string, string>,
  body?: string,
): Promise<{ url: string; status: number; ok: boolean; body: unknown }> {
  try {
    const res = await fetch(url, { method, headers, body })
    const text = await res.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
    return { url, status: res.status, ok: res.ok, body: parsed }
  } catch (err) {
    return {
      url,
      status: 0,
      ok: false,
      body: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function GET() {
  return NextResponse.json({
    message: "Use POST to run ClickUp Chat diagnostics",
    reference: "https://developer.clickup.com/reference/createchatmessage",
    requiredEnvVars: ["CLICKUP_API_TOKEN", "CLICKUP_WORKSPACE_ID"],
    optionalEnvVars: {
      CLICKUP_CHANNEL_NAME: "Channel name to look up (default: 'Live Updates')",
      CLICKUP_CHANNEL_ID: "Direct API channel ID override (skips lookup)",
    },
  })
}

export async function POST() {
  const apiToken = process.env.CLICKUP_API_TOKEN
  const workspaceId = process.env.CLICKUP_WORKSPACE_ID
  const channelName = process.env.CLICKUP_CHANNEL_NAME ?? "Live Updates"
  const directChannelId = process.env.CLICKUP_CHANNEL_ID

  if (!apiToken) {
    return NextResponse.json(
      { error: "CLICKUP_API_TOKEN is not set" },
      { status: 400 },
    )
  }
  if (!workspaceId) {
    return NextResponse.json(
      { error: "CLICKUP_WORKSPACE_ID is not set" },
      { status: 400 },
    )
  }

  const authHeaders = { Authorization: apiToken, "Content-Type": "application/json" }

  // ── Step 1: Probe all known channel-listing endpoint variants ────────────
  // Correct per https://developer.clickup.com/reference/createchatmessage:
  // GET /api/v3/workspaces/{workspace_id}/chat/channels
  const channelListVariants = [
    `https://api.clickup.com/api/v3/workspaces/${workspaceId}/chat/channels`,
    `https://api.clickup.com/api/v3/workspaces/${workspaceId}/channels`,
    `https://api.clickup.com/api/v3/team/${workspaceId}/channels`,
  ]

  const channelProbes = await Promise.all(
    channelListVariants.map((url) => probeUrl(url, "GET", authHeaders)),
  )

  // Find the first variant that returned 2xx
  const workingChannelProbe = channelProbes.find((p) => p.ok)

  // ── Step 2: Resolve the channel ID ──────────────────────────────────────
  let resolvedChannelId: string | null = directChannelId ?? null
  let channelResolutionNote = directChannelId
    ? `Using CLICKUP_CHANNEL_ID directly: ${directChannelId}`
    : "No direct CLICKUP_CHANNEL_ID set"

  if (!resolvedChannelId && workingChannelProbe) {
    const data = workingChannelProbe.body as Record<string, unknown>
    const channels: Array<{ id: string; name?: string }> = Array.isArray(
      workingChannelProbe.body,
    )
      ? (workingChannelProbe.body as Array<{ id: string; name?: string }>)
      : ((data.channels as Array<{ id: string; name?: string }>) ?? [])

    const target = channelName.toLowerCase()
    const found = channels.find(
      (c) =>
        c.name?.toLowerCase() === target ||
        c.name?.toLowerCase().includes(target),
    )

    if (found) {
      resolvedChannelId = found.id
      channelResolutionNote = `Found via lookup: "${found.name}" → ${found.id}`
    } else {
      channelResolutionNote = `Lookup succeeded but no channel named "${channelName}" found. Available: ${channels.map((c) => c.name).join(", ") || "(none)"}`
    }
  }

  // ── Step 3: Probe message-send endpoint variants ────────────────────────
  const testContent = [
    "🤖 **ClickUp Chat Test**",
    "",
    "✅ Test message from Creator Share",
    `📅 Time: ${new Date().toISOString()}`,
    `🔧 Environment: ${process.env.NODE_ENV ?? "development"}`,
  ].join("\n")

  const channelIdToTest = resolvedChannelId ?? `UNRESOLVED_use_CLICKUP_CHANNEL_ID`

  // Correct per https://developer.clickup.com/reference/createchatmessage:
  // POST /api/v3/workspaces/{workspace_id}/chat/channels/{channel_id}/messages
  // Required body: { type: "message", content, content_format }
  const messageVariants = [
    {
      url: `https://api.clickup.com/api/v3/workspaces/${workspaceId}/chat/channels/${channelIdToTest}/messages`,
      body: JSON.stringify({ type: "message", content: testContent, content_format: "text/md" }),
    },
    {
      url: `https://api.clickup.com/api/v3/channel/${channelIdToTest}/message`,
      body: JSON.stringify({ type: "message", content: testContent, content_format: "text/md" }),
    },
  ]

  const messageProbes = await Promise.all(
    messageVariants.map((v) =>
      probeUrl(v.url, "POST", authHeaders, v.body),
    ),
  )

  const messageSent = messageProbes.some((p) => p.ok)

  // ── Step 4: Full diagnostic report ──────────────────────────────────────
  return NextResponse.json(
    {
      config: { workspaceId, channelName, directChannelId: directChannelId ?? "(not set)" },
      channelListProbes: channelProbes,
      channelResolution: { resolvedChannelId, note: channelResolutionNote },
      messageSendProbes: messageProbes,
      success: messageSent,
    },
    { status: messageSent ? 200 : 502 },
  )
}
