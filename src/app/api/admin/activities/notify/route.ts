import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

// New endpoint to send email notifications AFTER media is uploaded
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  console.log("📧 [NOTIFY ACTIVITY] Starting email notification")
  
  try {
    const body = await req.json()
    const { activityId, beneficiaryId, selectedSponsorIds } = body

    if (!activityId || !beneficiaryId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
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

    const sponsorIds = selectedSponsorIds || []

    // Fetch activity subscribers
    const { data: subscribers, error: subError } = await supabase
      .from("activity_subscriptions")
      .select("email")
      .eq("beneficiary_id", beneficiaryId)

    if (subError) {
      console.error("❌ Error fetching activity subscribers:", subError)
    }

    // Fetch sponsors
    console.log("📧 [NOTIFY ACTIVITY] Fetching sponsor information")
    
    let sponsorQuery = supabase
      .from("subscriptions")
      .select("id, user_id, email_notification, customer_id")
      .eq("beneficiary_id", beneficiaryId)
      .eq("status", "complete")
    
    if (sponsorIds.length > 0) {
      sponsorQuery = sponsorQuery.in("id", sponsorIds)
      console.log("📧 [NOTIFY ACTIVITY] Filtering to selected sponsors:", sponsorIds)
    }
    
    const { data: sponsorRows, error: sponsorError } = await sponsorQuery

    if (sponsorError) {
      console.error("❌ [NOTIFY ACTIVITY] Error fetching sponsor subscriptions:", sponsorError)
    } else {
      console.log("✅ [NOTIFY ACTIVITY] Found sponsor subscriptions:", sponsorRows?.length || 0)
    }
    
    type SponsorInfo = {
      subscriptionId: string
      email: string
      name: string | null
      emailNotification: boolean | null
    }
    
    const sponsorInfoList: SponsorInfo[] = []
    
    if (sponsorRows && sponsorRows.length > 0) {
      for (const sub of sponsorRows) {
        let email: string | null = null
        let name: string | null = null
        
        const { data: transactions } = await supabase
          .from("transaction_ledger")
          .select("customer_email, customer_name, customer_id")
          .eq("beneficiary_id", beneficiaryId)
          .eq("subscription_type", "subscription")
          .not("customer_email", "is", null)
          .order("created_at", { ascending: false })
          .limit(10)
        
        if (transactions && transactions.length > 0) {
          let matchedTx = null
          if (sub.customer_id) {
            matchedTx = transactions.find(tx => tx.customer_id === sub.customer_id)
          }
          if (!matchedTx) {
            matchedTx = transactions[0]
          }
          
          if (matchedTx) {
            email = matchedTx.customer_email
            name = matchedTx.customer_name
          }
        }
        
        if (!email && sub.user_id) {
          const { data: userData } = await supabase
            .from("users")
            .select("email, first_name, last_name")
            .eq("id", sub.user_id)
            .single()
          
          if (userData) {
            email = userData.email
            name = userData.first_name && userData.last_name
              ? `${userData.first_name} ${userData.last_name}`
              : userData.first_name || userData.last_name || null
          }
        }
        
        if (email) {
          sponsorInfoList.push({
            subscriptionId: sub.id,
            email,
            name,
            emailNotification: sub.email_notification
          })
        }
      }
    }
    
    console.log("✅ [NOTIFY ACTIVITY] Compiled sponsor info list:", sponsorInfoList.length)

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

    if (!subError && Array.isArray(subscribers)) {
      for (const sub of subscribers) {
        if (sub?.email) {
          audienceMap.set(sub.email, { email: sub.email })
        }
      }
    }

    if (!sponsorError && sponsorIds.length > 0) {
      console.log("📧 [NOTIFY ACTIVITY] Adding sponsors to audience:", sponsorInfoList.length)
      for (const sponsor of sponsorInfoList) {
        if (sponsor.emailNotification === false) {
          console.log("⏭️ [NOTIFY ACTIVITY] Skipping sponsor (notifications disabled):", sponsor.email)
          continue
        }
        
        audienceMap.set(sponsor.email, {
          email: sponsor.email,
          name: sponsor.name,
        })
      }
    }

    if (beneficiaryData && beneficiaryData.name && audienceMap.size > 0) {
      const subject = `New update on ${beneficiaryData.name}`
      type EmailResult = { success: boolean; error?: unknown; messageId?: string }
      
      // Fetch media URLs (now they should exist!)
      const imageUrls: string[] = []
      const videoUrls: string[] = []

      const { data: mediaRecords } = await supabase
        .from("media")
        .select("*")
        .eq("parent_id", activityId)

      if (mediaRecords && mediaRecords.length > 0) {
        const { getStorageKey } = await import("@/utils/supabase/media")
        const { STORAGE_BUCKET } = await import("@/utils/supabase/buckets")

        const base = process.env.NEXT_PUBLIC_SUPABASE_URL
        if (base) {
          const normalizedBase = base.replace(/\/$/, "")

          for (const mediaRecord of mediaRecords) {
            try {
              const key = getStorageKey(
                mediaRecord as unknown as import("@/utils/supabase/media").MediaRow,
              )
              const publicUrl = `${normalizedBase}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(
                key,
              )}`
              
              if (mediaRecord.type === "IMAGE") {
                imageUrls.push(publicUrl)
              } else if (mediaRecord.type === "VIDEO") {
                videoUrls.push(publicUrl)
              }
            } catch (urlError) {
              console.error("❌ Error generating URL for media:", urlError)
            }
          }
        }
      }
      
      console.log("🖼️ [NOTIFY ACTIVITY] Generated media URLs:", {
        images: imageUrls.length,
        videos: videoUrls.length
      })

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
              },
              member.name,
              beneficiaryId,
            )
            
            try {
              await supabase.from("email_logs").insert({
                email: member.email,
                subject,
                status: emailResult.success ? "sent" : "failed",
                error: emailResult.error
                  ? JSON.stringify(emailResult.error)
                  : null,
                message_id: emailResult.messageId,
                created_at: new Date(),
              })
            } catch (logErr) {
              console.error("❌ Error logging email attempt:", logErr)
            }
            
            return emailResult
          } catch (emailErr) {
            console.error("❌ Error sending activity notification email to", member.email, ":", emailErr)
            try {
              await supabase.from("email_logs").insert({
                email: member.email,
                subject,
                status: "failed",
                error:
                  emailErr instanceof Error
                    ? emailErr.message
                    : String(emailErr),
                created_at: new Date(),
              })
            } catch (logErr) {
              console.error("❌ Error logging failed email attempt:", logErr)
            }
            return { success: false, error: emailErr }
          }
        }),
      )
      
      console.log("✅ [NOTIFY ACTIVITY] Emails sent successfully")
      return NextResponse.json({ success: true, emailsSent: audienceMap.size }, { status: 200 })
    }

    return NextResponse.json({ message: "No audience to notify" }, { status: 200 })
  } catch (error) {
    console.error("❌ [NOTIFY ACTIVITY] Fatal error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    )
  }
}
