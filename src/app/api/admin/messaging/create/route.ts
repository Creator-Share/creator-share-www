import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow, uploadFile, generatePublicUrl } from "@/utils/supabase/media"
import { sendActivityNotificationEmail } from "@/utils/email"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const title = formData.get("title") as string | null
  const description = formData.get("description") as string | null
  const beneficiary_id = formData.get("beneficiary_id") as string | null
  const is_public = formData.get("is_public") === "true"
  const selectedSponsorIds = formData.get("selected_sponsor_ids") as string | null

  if (!description || !beneficiary_id) {
    return NextResponse.json(
      { error: "Missing required fields: description and beneficiary_id" },
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

  // Insert activity record
  const { data: activityInserted, error: insertErr } = await supabase
    .from("activities")
    .insert([
      {
        title: title || null,
        description,
        activity_type: "UPDATE",
        activity_source: "admin",
        beneficiary_id,
        is_public,
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

  // Upload images
  const imageMediaIds: string[] = []
  for (const file of images) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

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

    try {
      const { error: uploadErr } = await uploadFile(supabase, mediaRow, file, {
        contentType: file.type,
      })
      if (uploadErr) {
        console.error("Activity image upload error:", uploadErr)
      } else {
        imageMediaIds.push(mediaRow.id)
      }
    } catch (e) {
      console.error("Unexpected error uploading activity image:", e)
    }
  }

  // Upload videos
  const videoMediaIds: string[] = []
  for (const file of videos) {
    const ext = (file.name.split(".").pop() || "").toLowerCase()

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
      } else {
        videoMediaIds.push(mediaRow.id)
      }
    } catch (e) {
      console.error("Unexpected error uploading activity video:", e)
    }
  }

  // Update activity with media references
  let inserted = activityInserted
  if (imageMediaIds.length > 0 || videoMediaIds.length > 0) {
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
  }

  // Send email notifications to selected sponsors
  if (sponsorIds.length > 0) {
    try {
      // Fetch sponsor information
      const { data: sponsorRows, error: sponsorError } = await supabase
        .from("subscriptions")
        .select("id, user_id, email_notification, users(email, first_name, last_name)")
        .eq("beneficiary_id", beneficiary_id)
        .in("id", sponsorIds)
        .eq("status", "complete")

      if (sponsorError) {
        console.error("Error fetching sponsor subscriptions:", sponsorError)
      } else if (sponsorRows && sponsorRows.length > 0) {
        // Fetch beneficiary name
        const { data: beneficiaryData } = await supabase
          .from("beneficiaries")
          .select("name")
          .eq("id", beneficiary_id)
          .single()

        if (beneficiaryData && beneficiaryData.name) {
          // Build list of recipients
          const recipients: Array<{ email: string; name: string | null }> = []

          for (const row of sponsorRows) {
            // Skip if email_notification is explicitly false
            if (row.email_notification === false) {
              continue
            }

            // Handle user data - may be an object or array
            const userData = Array.isArray(row.users) ? row.users[0] : row.users

            if (userData?.email) {
              const firstName = userData.first_name || null
              const lastName = userData.last_name || null
              const name =
                firstName && lastName
                  ? `${firstName} ${lastName}`
                  : firstName || lastName || null

              recipients.push({ email: userData.email, name })
            } else if (row.user_id) {
              // Try to fetch user email directly
              const { data: userData, error: userError } = await supabase
                .from("users")
                .select("email, first_name, last_name")
                .eq("id", row.user_id)
                .single()

              if (!userError && userData?.email) {
                const firstName = userData.first_name || null
                const lastName = userData.last_name || null
                const name =
                  firstName && lastName
                    ? `${firstName} ${lastName}`
                    : firstName || lastName || null

                recipients.push({ email: userData.email, name })
              }
            }
          }

          // Generate media URLs for email
          const imageUrls: string[] = []
          const videoUrls: string[] = []

          if (imageMediaIds.length > 0) {
            const { data: mediaRecords } = await supabase
              .from("media")
              .select("*")
              .in("id", imageMediaIds)

            if (mediaRecords) {
              for (const mediaRecord of mediaRecords) {
                try {
                  const publicUrl = generatePublicUrl(
                    mediaRecord as unknown as MediaRow,
                  )
                  imageUrls.push(publicUrl)
                } catch (e) {
                  console.error("Error generating image URL:", e)
                }
              }
            }
          }

          if (videoMediaIds.length > 0) {
            const { data: mediaRecords } = await supabase
              .from("media")
              .select("*")
              .in("id", videoMediaIds)

            if (mediaRecords) {
              for (const mediaRecord of mediaRecords) {
                try {
                  const publicUrl = generatePublicUrl(
                    mediaRecord as unknown as MediaRow,
                  )
                  videoUrls.push(publicUrl)
                } catch (e) {
                  console.error("Error generating video URL:", e)
                }
              }
            }
          }

          // Send emails to all recipients
          const emailResults = await Promise.allSettled(
            recipients.map(async (recipient) => {
              try {
                return await sendActivityNotificationEmail(
                  recipient.email,
                  { name: beneficiaryData.name },
                  {
                    title: title || "Update",
                    description,
                    imageUrls,
                    videoUrls,
                  },
                  recipient.name,
                )
              } catch (e) {
                console.error(
                  `Error sending email to ${recipient.email}:`,
                  e,
                )
                return { success: false, error: e }
              }
            }),
          )

          const successCount = emailResults.filter(
            (r) => r.status === "fulfilled" && r.value?.success,
          ).length
          console.log(
            `Sent ${successCount}/${recipients.length} email notifications`,
          )
        }
      }
    } catch (notifyError) {
      console.error("Error in email notification process:", notifyError)
      // Don't fail the request if email sending fails
    }
  }

  return NextResponse.json({ activity: inserted }, { status: 201 })
}

