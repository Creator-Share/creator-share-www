import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow, uploadFile } from "@/utils/supabase/media"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const title = formData.get("title") as string | null
  const description = formData.get("description") as string | null
  const activity_type = formData.get("activity_type") as string | null
  const activity_source = formData.get("activity_source") as string | null
  const beneficiary_id = formData.get("beneficiary_id") as string | null

  if (!description || !beneficiary_id || !activity_type || !activity_source) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 },
    )
  }
  const images: File[] = []
  const videos: File[] = []
  for (const [key, value] of formData.entries()) {
    if (value instanceof File && value.size > 0) {
      if (key === "images") images.push(value)
      if (key === "videos") videos.push(value)
    }
  }

  const supabase = await createClient()

  // Insert activity record first (we'll attach media via the media table)
  const { data: activityInserted, error: insertErr } = await supabase
    .from("activities")
    .insert([
      {
        title,
        description,
        activity_type,
        activity_source,
        beneficiary_id,
        created_at: new Date().toISOString(),
        created_by: "admin",
      },
    ])
    .select()
    .single()

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

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

  // Persist media references in activity.metadata.media (images/videos)
  let inserted = activityInserted
  try {
    const metadata = { media: { images: imageMediaIds, videos: videoMediaIds } }
    const { data: updatedActivity, error: updateErr } = await supabase
      .from("activities")
      .update({ metadata })
      .eq("id", activityId)
      .select()
      .single()

    if (updateErr) {
      console.error(
        "Failed to update activity with media references:",
        updateErr,
      )
    } else {
      inserted = updatedActivity || activityInserted
    }
  } catch (e) {
    console.error(
      "Unexpected error updating activity with media references:",
      e,
    )
  }

  // Only notify subscribers/sponsors if created_by is 'admin'
  if (inserted?.created_by === "admin") {
    try {
      console.log("📧 Starting email notification process for beneficiary:", beneficiary_id)
      
      const { data: subscribers, error: subError } = await supabase
        .from("activity_subscriptions")
        .select("email")
        .eq("beneficiary_id", beneficiary_id)

      if (subError) {
        console.error("❌ Error fetching activity subscribers:", subError)
      } else {
        console.log("✅ Found activity subscribers:", subscribers?.length || 0)
      }

      // Fetch sponsors (users who have active/complete subscriptions for this beneficiary)
      type UserData = {
        email: string
        first_name?: string | null
        last_name?: string | null
        name?: string | null
      }
      type SponsorRow = {
        user_id: string | null
        email_notification: boolean | null
        users: UserData | UserData[] | null
      }
      const { data: sponsorRows, error: sponsorError } = await supabase
        .from("subscriptions")
        .select("user_id, email_notification, users(email, first_name, last_name)")
        .eq("beneficiary_id", beneficiary_id)
        .eq("status", "complete")

      if (sponsorError) {
        console.error("❌ Error fetching sponsor subscriptions:", sponsorError)
      } else {
        console.log("✅ Found sponsor subscriptions:", sponsorRows?.length || 0)
        console.log("📋 Sponsor rows data:", JSON.stringify(sponsorRows, null, 2))
      }

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
            console.log("➕ Added activity subscriber:", sub.email)
          }
        }
      }

      // Add sponsor emails (respect email_notification flag if provided)
      if (!sponsorError && Array.isArray(sponsorRows)) {
        for (const row of sponsorRows as SponsorRow[]) {
          if (row?.email_notification === false) {
            console.log("⏭️ Skipping sponsor (email_notification=false):", row.user_id)
            continue
          }
          
          // Handle user data - may be an object or array
          const userData = Array.isArray(row.users)
            ? row.users[0]
            : row.users
          
          if (userData?.email) {
            // Construct name from first_name and last_name
            const name = userData.first_name && userData.last_name
              ? `${userData.first_name} ${userData.last_name}`
              : userData.first_name || userData.last_name || userData.name || null
            
            audienceMap.set(userData.email, {
              email: userData.email,
              name,
            })
            console.log("➕ Added sponsor:", userData.email, "Name:", name)
          } else {
            console.warn("⚠️ Sponsor row has no user email:", row.user_id)
            // Try to fetch user email directly if relationship didn't work
            if (row.user_id) {
              const { data: userData, error: userError } = await supabase
                .from("users")
                .select("email, first_name, last_name")
                .eq("id", row.user_id)
                .single()
              
              if (!userError && userData?.email) {
                const name = userData.first_name && userData.last_name
                  ? `${userData.first_name} ${userData.last_name}`
                  : userData.first_name || userData.last_name || null
                
                audienceMap.set(userData.email, {
                  email: userData.email,
                  name,
                })
                console.log("➕ Added sponsor (direct query):", userData.email, "Name:", name)
              } else {
                console.error("❌ Could not fetch user data for:", row.user_id, userError)
              }
            }
          }
        }
      }

      console.log("📊 Total audience size:", audienceMap.size)

      if (beneficiaryData && beneficiaryData.name && audienceMap.size > 0) {
        const subject = `New update on ${beneficiaryData.name}`

        type EmailResult = { success: boolean; error?: unknown; messageId?: string }
        
        console.log("📤 Sending emails to", audienceMap.size, "recipients")

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

            console.log(
              type === "IMAGE" ? "📸 Found" : "🎥 Found",
              mediaRecords.length,
              `${type.toLowerCase()} media records`,
            )

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
                console.log(
                  type === "IMAGE" ? "✅ Generated image URL:" : "✅ Generated video URL:",
                  publicUrl,
                )
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

        if (inserted?.metadata?.media?.images && Array.isArray(inserted.metadata.media.images)) {
          const urls = await generatePublicUrls(
            inserted.metadata.media.images,
            "IMAGE",
          )
          imageUrls.push(...urls)
          console.log("📧 Total image URLs for email:", imageUrls.length)
        } else {
          console.log("ℹ️ No images in activity metadata")
        }

        if (inserted?.metadata?.media?.videos && Array.isArray(inserted.metadata.media.videos)) {
          const urls = await generatePublicUrls(
            inserted.metadata.media.videos,
            "VIDEO",
          )
          videoUrls.push(...urls)
          console.log("📧 Total video URLs for email:", videoUrls.length)
        } else {
          console.log("ℹ️ No videos in activity metadata")
        }

        const results = await Promise.allSettled(
          Array.from(audienceMap.values()).map(async (member) => {
            try {
              console.log("📧 Sending email to:", member.email)
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
              )
              
              console.log("📧 Email result for", member.email, ":", emailResult.success ? "✅ sent" : "❌ failed", emailResult.error)
              
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
        
        const successCount = results.filter(r => r.status === "fulfilled" && r.value?.success).length
        const failCount = results.length - successCount
        console.log(`📊 Email sending complete: ${successCount} sent, ${failCount} failed`)
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

  return NextResponse.json({ activity: inserted }, { status: 201 })
}
