import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { generatePublicUrl } from "@/utils/supabase/media"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const beneficiary_id = searchParams.get("beneficiary_id")
  const q = searchParams.get("q")?.trim()

  const supabase = await createClient()
  let query = supabase
    .from("activities")
    .select("*")
    .order("created_at", { ascending: false })

  if (beneficiary_id) {
    query = query.eq("beneficiary_id", beneficiary_id)
  }

  if (q && q.length > 0) {
    // Filter by title or description (case-insensitive contains)
    const pattern = `%${q}%`
    query = query.or(
      `title.ilike.${pattern},description.ilike.${pattern}`,
    )
  }

  const { data: activities, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Fetch media for each activity
  const activitiesWithMedia = await Promise.all(
    (activities || []).map(async (activity) => {
      const { data: mediaRecords } = await supabase
        .from("media")
        .select("*")
        .eq("parent_id", activity.id)
        .order("created_at", { ascending: true })

      const images_url: string[] = []
      const videos_url: string[] = []

      if (mediaRecords) {
        for (const media of mediaRecords) {
          try {
            const url = generatePublicUrl(media as unknown as import('@/utils/supabase/media').MediaRow)
            if (media.type === "IMAGE") {
              images_url.push(url)
            } else if (media.type === "VIDEO") {
              videos_url.push(url)
            }
          } catch (error) {
            console.error(`Failed to generate URL for media ${media.id}:`, error)
          }
        }
      }

      return {
        ...activity,
        images_url,
        videos_url,
      }
    })
  )

  return NextResponse.json({ activities: activitiesWithMedia })
}
