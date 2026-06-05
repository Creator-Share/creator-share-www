import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

// New endpoint to send email notifications AFTER media is uploaded
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { activityId, beneficiaryId, selectedSponsorshipIds } = body

    if (!activityId || !beneficiaryId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      )
    }

    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    // Fetch the activity
    const { data: activity } = await supabase
      .from("activities")
      .select("*")
      .eq("id", activityId)
      .single()

    if (!activity) {
      return NextResponse.json({ error: "Activity not found" }, { status: 404 })
    }

    // Only send emails if created_by is 'admin'
    if (activity.created_by !== "admin") {
      return NextResponse.json({ message: "Notifications skipped (not admin)" }, { status: 200 })
    }

    const sponsorshipIds = selectedSponsorshipIds || []

    // Fetch activity subscribers (public opt-in list, separate from subscriptions)
    const { data: subscribers, error: subError } = await supabase
      .from("activity_subscriptions")
      .select("email")
      .eq("beneficiary_id", beneficiaryId)

    if (subError) {
      console.error("❌ Error fetching activity subscribers:", subError)
    }

    // Fetch subscriptions with email directly (no heuristic N+1).
    // When no specific sponsorship IDs are provided, filter by email_notification.
    // When specific IDs are provided, skip the opt-out filter so admins can
    // override for transactional messages.
    let sponsorQuery = supabase
      .from("subscriptions")
      .select("id, email, email_notification")
      .eq("beneficiary_id", beneficiaryId)
      .eq("status", "complete")
      .not("email", "is", null)

    if (sponsorshipIds.length > 0) {
      sponsorQuery = sponsorQuery.in("id", sponsorshipIds)
    } else {
      // Default: only include sponsors who haven't opted out
      sponsorQuery = sponsorQuery.or("email_notification.is.null,email_notification.neq.false")
    }

    const { data: sponsorRows, error: sponsorError } = await sponsorQuery

    if (sponsorError) {
      console.error("❌ [NOTIFY ACTIVITY] Error fetching sponsor subscriptions:", sponsorError)
    }

    type SponsorInfo = {
      subscriptionId: string
      email: string
      name: string | null
    }

    const sponsorInfoList: SponsorInfo[] = []

    if (sponsorRows && sponsorRows.length > 0) {
      // Check for any subscriptions where email is NULL despite the DB filter
      // (shouldn't happen, but be safe)
      const missingEmailIds = sponsorRows
        .filter((s) => !s.email)
        .map((s) => s.id)

      if (missingEmailIds.length > 0) {
        console.warn(
          "⚠️ [NOTIFY ACTIVITY] Subscriptions returned with NULL email despite filter:",
          missingEmailIds,
        )
        // Fall back to batch FK join for any that slipped through
        const { data: txRows } = await supabase
          .from("transaction_ledger")
          .select("subscription_id, customer_email, customer_name")
          .in("subscription_id", missingEmailIds)
          .not("customer_email", "is", null)

        if (txRows && txRows.length > 0) {
          const emailMap = new Map(txRows.map((tx) => [tx.subscription_id, tx]))

          for (const sub of sponsorRows) {
            if (sub.email) {
              sponsorInfoList.push({
                subscriptionId: sub.id,
                email: sub.email,
                name: null,
              })
            } else {
              const tx = emailMap.get(sub.id)
              if (tx) {
                sponsorInfoList.push({
                  subscriptionId: sub.id,
                  email: tx.customer_email,
                  name: tx.customer_name || null,
                })
              } else {
                console.warn("⚠️ [NOTIFY ACTIVITY] Unresolvable subscription (no email, no tledger match):", sub.id)
              }
            }
          }
        } else {
          // No tledger matches either — log and skip unresolvable
          for (const sub of sponsorRows) {
            if (sub.email) {
              sponsorInfoList.push({
                subscriptionId: sub.id,
                email: sub.email,
                name: null,
              })
            } else {
              console.warn("⚠️ [NOTIFY ACTIVITY] Unresolvable subscription (no email, no tledger match):", sub.id)
            }
          }
        }
      } else {
        // Fast path: all subscriptions have email directly
        for (const sub of sponsorRows) {
          sponsorInfoList.push({
            subscriptionId: sub.id,
            email: sub.email!,
            name: null,
          })
        }
      }
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

    const { sendActivityNotificationEmail } = await import("@/utils/email")

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
    if (!sponsorError && sponsorshipIds.length > 0) {
      for (const sponsor of sponsorInfoList) {
        audienceMap.set(sponsor.email, {
          email: sponsor.email,
          name: sponsor.name,
        })
      }
    }

    if (beneficiaryData && beneficiaryData.name && audienceMap.size > 0) {
      type EmailResult = { success: boolean; error?: unknown; messageId?: string }

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

      await Promise.allSettled(
        Array.from(audienceMap.values()).map(async (member) => {
          try {
            const emailResult: EmailResult = await sendActivityNotificationEmail(
              member.email,
              beneficiaryData,
              {
                title: activity?.title || "",
                description: activity?.description || "",
                imageUrls,
                videoUrls,
                documentUrls,
              },
              member.name,
              beneficiaryId,
            )

            return emailResult
          } catch (emailErr) {
            console.error("❌ Error sending activity notification email to", member.email, ":", emailErr)
            return { success: false, error: emailErr }
          }
        }),
      )
      return NextResponse.json({ success: true, emailsSent: audienceMap.size }, { status: 200 })
    }

    return NextResponse.json({ message: "No audience to notify" }, { status: 200 })
  } catch (error) {
    console.error("❌ [NOTIFY ACTIVITY] Fatal error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
