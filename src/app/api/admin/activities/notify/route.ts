import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { requireSuperAdminRequest } from "@/utils/auth/requireSuperAdminRequest"
import { sendActivityNotificationEmail } from "@/utils/email"

// New endpoint to send email notifications AFTER media is uploaded
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const auth = await requireSuperAdminRequest(supabase, req)
    if (!auth.ok) return auth.response

    const body = await req.json()
    const { activityId, beneficiaryId, selectedSponsorshipIds } = body

    if (!activityId || !beneficiaryId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      )
    }

    // Fetch the activity
    const { data: activity } = await supabase
      .from("activities")
      .select("*")
      .eq("id", activityId)
      .eq("beneficiary_id", beneficiaryId)
      .single()

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 })
    }

    // Only send emails if created_by is 'admin'
    if (activity.created_by !== "admin") {
      return NextResponse.json({ success: true, emailsSent: 0, emailsFailed: 0, message: "Notifications skipped (not admin)" }, { status: 200 })
    }

    const sponsorshipIds = selectedSponsorshipIds || []

    // Fetch activity subscribers (public opt-in list, separate from subscriptions)
    const { data: subscribers, error: subError } = await supabase
      .from("activity_subscriptions")
      .select("email")
      .eq("beneficiary_id", beneficiaryId)

    if (subError) {
      console.error("ACTIVITY_NOTIFICATION_AUDIENCE_UNAVAILABLE")
      return NextResponse.json({ error: "Notification audience unavailable" }, { status: 503 })
    }

    // Explicit selection permits the existing administrator override of opt-out.
    // Without a selection, only public activity subscribers receive this message.
    let sponsorRows: Array<{ email: string | null }> = []
    if (sponsorshipIds.length > 0) {
      const result = await supabase
        .from("subscriptions")
        .select("email")
        .eq("beneficiary_id", beneficiaryId)
        .eq("status", "complete")
        .not("email", "is", null)
        .in("id", sponsorshipIds)
      if (result.error) {
        console.error("ACTIVITY_NOTIFICATION_AUDIENCE_UNAVAILABLE")
        return NextResponse.json({ error: "Notification audience unavailable" }, { status: 503 })
      }
      sponsorRows = result.data || []
    }

    // Fetch beneficiary name
    const { data: beneficiaryData } = await supabase
      .from("beneficiaries")
      .select("name")
      .eq("id", beneficiaryId)
      .single()

    if (!beneficiaryData) {
      console.error("❌ Could not find beneficiary data for:", beneficiaryId)
      return NextResponse.json({ error: "Beneficiary not found" }, { status: 404 })
    }

    type AudienceMember = { email: string; name?: string | null }
    const audienceMap = new Map<string, AudienceMember>()

    // Always include public activity subscribers
    if (!subError && Array.isArray(subscribers)) {
      for (const sub of subscribers) {
        if (sub?.email) {
          audienceMap.set(sub.email, { email: sub.email })
        }
      }
    }

    // Include sponsors only when specific sponsorship IDs were selected
    if (sponsorshipIds.length > 0) {
      for (const sponsor of sponsorRows) {
        if (sponsor.email) audienceMap.set(sponsor.email, { email: sponsor.email })
      }
    }

    if (beneficiaryData && beneficiaryData.name && audienceMap.size > 0) {
      // Fetch media URLs
      const imageUrls: string[] = []
      const videoUrls: string[] = []
      const documentUrls: string[] = []

      const { data: mediaRecords } = await supabase
        .from("media")
        .select("*")
        .eq("parent_id", activityId)

      if (mediaRecords && mediaRecords.length > 0) {
        const {
          filterExistingMediaRows,
          getDirectMediaUrl,
          getExternalActivityImageUrl,
        } = await import("@/utils/supabase/media")

        const serviceSupabase = createServiceRoleClient()
        const existingMediaRecords = await filterExistingMediaRows(
          serviceSupabase,
          mediaRecords as unknown as import("@/utils/supabase/media").MediaRow[],
        )

        for (const mediaRecord of existingMediaRecords) {
          try {
            const media = mediaRecord as unknown as import("@/utils/supabase/media").MediaRow

            if (mediaRecord.type === "IMAGE") {
              imageUrls.push(getExternalActivityImageUrl(media))
            } else if (mediaRecord.type === "VIDEO") {
              videoUrls.push(getDirectMediaUrl(media))
            } else if (mediaRecord.type === "DOCUMENT") {
              documentUrls.push(getDirectMediaUrl(media))
            }
          } catch (urlError) {
            console.error("❌ Error generating URL for media:", urlError)
          }
        }
      }

      const outcomes = await Promise.allSettled(
        Array.from(audienceMap.values()).map((member) =>
          sendActivityNotificationEmail(
            member.email,
            beneficiaryData,
            {
              title: activity.title || "",
              description: activity.description || "",
              imageUrls,
              videoUrls,
              documentUrls,
            },
            member.name,
            beneficiaryId,
          ),
        ),
      )
      const emailsSent = outcomes.filter(
        (outcome) => outcome.status === "fulfilled" && outcome.value.success,
      ).length
      const emailsFailed = outcomes.length - emailsSent
      if (emailsFailed > 0) {
        console.error("ACTIVITY_NOTIFICATION_DELIVERY_INCOMPLETE", { emailsSent, emailsFailed })
      }
      // These counts describe transport acceptance, not delivery to an inbox.
      // Do not automatically retry a partial or ambiguous delivery.
      return NextResponse.json({ success: emailsFailed === 0, emailsSent, emailsFailed })
    }

    return NextResponse.json({ success: true, emailsSent: 0, emailsFailed: 0, message: "No audience to notify" }, { status: 200 })
  } catch {
    console.error("ACTIVITY_NOTIFICATION_FAILED")
    return NextResponse.json(
      { error: "Activity notification failed" },
      { status: 500 },
    )
  }
}
