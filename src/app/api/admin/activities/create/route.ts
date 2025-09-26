import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { MediaRow, uploadFile } from "@/utils/supabase/media"

export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const title = formData.get("title") as string | null
  const description = formData.get("description") as string | null
  const beneficiary_id = formData.get("beneficiary_id") as string | null

  if (!description || !beneficiary_id) {
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

  // Only notify subscribers if created_by is 'admin'
  if (inserted?.created_by === "admin") {
    try {
      const { data: subscribers, error: subError } = await supabase
        .from("activity_subscriptions")
        .select("email")
        .eq("beneficiary_id", beneficiary_id)

      if (!subError && Array.isArray(subscribers)) {
        const { data: beneficiaryData } = await supabase
          .from("beneficiaries")
          .select("name")
          .eq("id", beneficiary_id)
          .single()

        const { sendActivityNotificationEmail } = await import("@/utils/email")
        if (beneficiaryData && beneficiaryData.name) {
          for (const sub of subscribers) {
            try {
              const emailResult = await sendActivityNotificationEmail(
                sub.email,
                beneficiaryData,
                inserted,
              )
              await supabase.from("email_logs").insert({
                email: sub.email,
                subject: `New update on ${beneficiaryData.name}`,
                status: emailResult.success ? "sent" : "failed",
                error: emailResult.error
                  ? JSON.stringify(emailResult.error)
                  : null,
                message_id: emailResult.messageId,
                created_at: new Date(),
              })
            } catch (emailErr) {
              console.error(
                "Error sending activity notification email:",
                emailErr,
              )
              await supabase.from("email_logs").insert({
                email: sub.email,
                subject: `New update on ${beneficiaryData.name}`,
                status: "failed",
                error:
                  emailErr instanceof Error
                    ? emailErr.message
                    : String(emailErr),
                created_at: new Date(),
              })
            }
          }
        }
      }
    } catch (notifyError) {
      console.error("Error notifying subscribers:", notifyError)
    }
  }

  return NextResponse.json({ activity: inserted }, { status: 201 })
}
