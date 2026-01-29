import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow, uploadFile } from "@/utils/supabase/media"

export async function POST(req: NextRequest) {
  console.log("🎬 [CREATE ACTIVITY] Starting activity creation")
  
  const formData = await req.formData()
  const title = formData.get("title") as string | null
  const description = formData.get("description") as string | null
  const activity_type = formData.get("activity_type") as string | null
  const activity_source = formData.get("activity_source") as string | null
  const beneficiary_id = formData.get("beneficiary_id") as string | null
  const is_public = formData.get("is_public") === "true"
  const selectedSponsorIds = formData.get("selected_sponsor_ids") as string | null

  console.log("📝 [CREATE ACTIVITY] Form data:", {
    title,
    description: description?.substring(0, 50) + "...",
    activity_type,
    activity_source,
    beneficiary_id,
    is_public,
    selectedSponsorIds
  })

  if (!description || !beneficiary_id || !activity_type || !activity_source) {
    console.error("❌ [CREATE ACTIVITY] Missing required fields")
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }

  // Parse selected sponsor IDs (comma-separated string)
  const sponsorIds = selectedSponsorIds
    ? selectedSponsorIds.split(",").filter((id) => id.trim().length > 0)
    : []
  const images: File[] = []
  const videos: File[] = []
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      if (key === "images") images.push(value)
      if (key === "videos") videos.push(value)
    }
  }

  const supabase = await createClient()

  console.log("💾 [CREATE ACTIVITY] Inserting activity into database")

  // Insert activity record first (we'll attach media via the media table)
  const { data: activityInserted, error: insertErr } = await supabase
    .from("activities")
    .insert([
      {
        title,
        description,
        activity_type,
        created_by: activity_source,
        beneficiary_id,
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single()

  if (insertErr) {
    console.error("❌ [CREATE ACTIVITY] Failed to insert activity:", insertErr)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  console.log("✅ [CREATE ACTIVITY] Activity inserted successfully, ID:", activityInserted?.id)

  const activityId = (activityInserted as unknown as MediaRow).id

  // Use media table references (store media ids in activity.metadata) instead of persisting public URLs
  const imageMediaIds: string[] = []
  for (const file of images) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

    // Insert media row for this image
    const { data: mediaInserted, error: mediaInsertErr } = await supabase
      .from("media")
      .insert([{ parent_id: activityId, extension: ext, type: "IMAGE" }])
      .select()
      .single()

    if (mediaInsertErr) {
      console.error("Activity image media insert failed:", mediaInsertErr)
      continue
    }

    const mediaRow = mediaInserted as unknown as MediaRow

    // Upload using centralized helper
    try {
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        contentType: file.type,
      })
      if (uploadErr) {
        console.error("Activity image upload error:", uploadErr)
      }
    } catch (e) {
      console.error("Unexpected error uploading activity image:", e)
    }

    imageMediaIds.push(mediaRow.id)
  }

  const videoMediaIds: string[] = []
  for (const file of videos) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

    // Insert media row for this video
    const { data: mediaInserted, error: mediaInsertErr } = await supabase
      .from("media")
      .insert([{ parent_id: activityId, extension: ext, type: "VIDEO" }])
      .select()
      .single()

    if (mediaInsertErr) {
      console.error("Activity video media insert failed:", mediaInsertErr)
      continue
    }

    const mediaRow = mediaInserted as unknown as MediaRow

    try {
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        contentType: file.type,
      })
      if (uploadErr) {
        console.error("Activity video upload error:", uploadErr)
      }
    } catch (e) {
      console.error("Unexpected error uploading activity video:", e)
    }

    videoMediaIds.push(mediaRow.id)
  }

  // Note: The activities table doesn't have a metadata field, so media is stored in the media table
  // with parent_id referencing the activity. No need to update the activity record.
  const inserted = activityInserted
  
  console.log("📸 [CREATE ACTIVITY] Media uploaded:", {
    images: imageMediaIds.length,
    videos: videoMediaIds.length
  })

  // Only notify subscribers/sponsors if created_by is 'admin'
  if (inserted?.created_by === "admin") {
    try {
      
      const { data: subscribers, error: subError } = await supabase
        .from("activity_subscriptions")
        .select("email")
        .eq("beneficiary_id", beneficiary_id)

      if (subError) {
        console.error("❌ Error fetching activity subscribers:", subError)
      } else {
      }

      // Fetch sponsors using same logic as /api/admin/messaging/sponsors
      console.log("📧 [CREATE ACTIVITY] Fetching sponsor information")
      
      // Step 1: Fetch subscriptions
      let sponsorQuery = supabase
        .from("subscriptions")
        .select("id, user_id, email_notification, customer_id")
        .eq("beneficiary_id", beneficiary_id)
        .eq("status", "complete")
      
      // If specific sponsors are selected, filter to only those
      if (sponsorIds.length > 0) {
        sponsorQuery = sponsorQuery.in("id", sponsorIds)
        console.log("📧 [CREATE ACTIVITY] Filtering to selected sponsors:", sponsorIds)
      } else {
        console.log("📧 [CREATE ACTIVITY] No sponsors selected - will send to all (if any)")
      }
      
      const { data: sponsorRows, error: sponsorError } = await sponsorQuery

      if (sponsorError) {
        console.error("❌ [CREATE ACTIVITY] Error fetching sponsor subscriptions:", sponsorError)
      } else {
        console.log("✅ [CREATE ACTIVITY] Found sponsor subscriptions:", sponsorRows?.length || 0)
      }
      
      // Step 2: For each subscription, get customer info from transaction_ledger or users
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
          
          // Try to get customer info from transaction_ledger
          const { data: transactions } = await supabase
            .from("transaction_ledger")
            .select("customer_email, customer_name, customer_id")
            .eq("beneficiary_id", beneficiary_id)
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
          
          // Fallback to users table
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
          } else {
            console.warn("⚠️ [CREATE ACTIVITY] No email found for subscription:", sub.id)
          }
        }
      }
      
      console.log("✅ [CREATE ACTIVITY] Compiled sponsor info list:", sponsorInfoList.length)

      // Fetch beneficiary name once for both audiences
      const { data: beneficiaryData } = await supabase
        .from("beneficiaries")
        .select("name")
        .eq("id", beneficiary_id)
        .single()

      if (!beneficiaryData) {
        console.error("❌ Could not find beneficiary data for:", beneficiary_id)
      }

      // Check if email service is configured
      if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
        console.warn("⚠️ Email service not configured - emails will not be sent")
        console.warn("⚠️ Set EMAIL_USER and EMAIL_PASSWORD environment variables")
      }

      const { sendActivityNotificationEmail } = await import("@/utils/email")

      // Map email to name for personalized greetings
      type AudienceMember = { email: string; name?: string | null }
      const audienceMap = new Map<string, AudienceMember>()

      // Add explicit activity subscribers (no name available for these)
      if (!subError && Array.isArray(subscribers)) {
        for (const sub of subscribers) {
          if (sub?.email) {
            audienceMap.set(sub.email, { email: sub.email })
          }
        }
      }

      // Add sponsor emails - only if sponsorIds were specified (opt-in for email)
      if (!sponsorError && sponsorIds.length > 0) {
        console.log("📧 [CREATE ACTIVITY] Adding sponsors to audience:", sponsorInfoList.length)
        for (const sponsor of sponsorInfoList) {
          if (sponsor.emailNotification === false) {
            console.log("⏭️ [CREATE ACTIVITY] Skipping sponsor (notifications disabled):", sponsor.email)
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
        

        // Fetch media URLs for email
        const imageUrls: string[] = []
        const videoUrls: string[] = []

        // Helper to generate public storage URLs
        const generatePublicUrls = async (ids: string[], type: "IMAGE" | "VIDEO") => {
          if (!ids || ids.length === 0) return []

          try {
            const { data: mediaRecords, error: mediaError } = await supabase
              .from("media")
              .select("*")
              .in("id", ids)

            if (mediaError) {
              console.error(`❌ Error fetching ${type.toLowerCase()} media records:`, mediaError)
              return []
            }

            if (!mediaRecords || mediaRecords.length === 0) {
              console.warn(
                `⚠️ No media records found for ${type.toLowerCase()} IDs:`,
                ids,
              )
              return []
            }

            const { getStorageKey } = await import("@/utils/supabase/media")
            const STORAGE_BUCKET = (await import("@/utils/supabase/buckets")).STORAGE_BUCKET

            const base = process.env.NEXT_PUBLIC_SUPABASE_URL
            if (!base) {
              console.error("❌ NEXT_PUBLIC_SUPABASE_URL not set")
              return []
            }
            const normalizedBase = base.replace(/\/$/, "")

            const urls: string[] = []
            for (const mediaRecord of mediaRecords) {
              try {
                // Use direct public URL for emails (no transformation)
                // This ensures compatibility with email clients
                const key = getStorageKey(
                  mediaRecord as unknown as import("@/utils/supabase/media").MediaRow,
                )
                const publicUrl = `${normalizedBase}/storage/v1/object/public/${STORAGE_BUCKET}/${encodeURI(
                  key,
                )}`
                urls.push(publicUrl)
              } catch (urlError) {
                console.error(`❌ Error generating ${type.toLowerCase()} URL for media:`, urlError)
              }
            }

            return urls
          } catch (error) {
            console.error(
              `❌ Error fetching ${type.toLowerCase()} URLs for email:`,
              error,
            )
            return []
          }
        }

        // Generate media URLs from the media IDs we tracked
        if (imageMediaIds.length > 0) {
          const urls = await generatePublicUrls(imageMediaIds, "IMAGE")
          imageUrls.push(...urls)
        }

        if (videoMediaIds.length > 0) {
          const urls = await generatePublicUrls(videoMediaIds, "VIDEO")
          videoUrls.push(...urls)
        }
        
        console.log("🖼️ [CREATE ACTIVITY] Generated media URLs:", {
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
                  title: inserted?.title || "",
                  description: inserted?.description || "",
                  imageUrls,
                  videoUrls,
                },
                member.name,
                beneficiary_id,
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
        
      } else {
        if (!beneficiaryData || !beneficiaryData.name) {
          console.warn("⚠️ No beneficiary data or name found")
        }
        if (audienceMap.size === 0) {
          console.warn("⚠️ No audience members found to notify")
        }
      }
    } catch (notifyError) {
      console.error("❌ Error in notification process:", notifyError)
    }
  }

  console.log("🎉 [CREATE ACTIVITY] Activity created successfully, ID:", activityId)
  return NextResponse.json({ activity: inserted }, { status: 201 })
}
