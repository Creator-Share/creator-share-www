import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { generatePublicUrl } from "@/utils/supabase/media"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const beneficiary_id = searchParams.get("beneficiary_id")
  const q = searchParams.get("q")?.trim()

  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response

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

  const safeActivities = activities || []

  if (safeActivities.length === 0) {
    return NextResponse.json({ activities: [] })
  }

  // Batch-fetch all media records for the returned activities to avoid N+1 queries
  const activityIds = safeActivities.map((activity) => activity.id).filter(Boolean)

  const { data: allMedia, error: mediaError } = await supabase
    .from("media")
    .select("*")
    .in("parent_id", activityIds)
    .order("created_at", { ascending: true })

  if (mediaError) {
    console.error("Failed to fetch media for activities:", mediaError)
    return NextResponse.json({ error: mediaError.message }, { status: 500 })
  }

  // Group media by parent_id for quick lookup
  const mediaByParent: Record<string, typeof allMedia> = {}
  for (const media of allMedia || []) {
    const key = String(media.parent_id)
    if (!mediaByParent[key]) {
      mediaByParent[key] = []
    }
    mediaByParent[key].push(media)
  }

  const activitiesWithMedia = safeActivities.map((activity) => {
    const images_url: string[] = []
    const videos_url: string[] = []

    const mediaRecords = mediaByParent[String(activity.id)] || []

    for (const media of mediaRecords) {
      try {
        const url = generatePublicUrl(media as unknown as import('@/utils/supabase/media').MediaRow)
        if (media.type === "IMAGE") {
          images_url.push(url)
        } else if (media.type === "VIDEO") {
          videos_url.push(url)
        }
      } catch (err) {
        console.error(`Failed to generate URL for media ${media.id}:`, err)
      }
    }

    return {
      ...activity,
      images_url,
      videos_url,
    }
  })

  return NextResponse.json({ activities: activitiesWithMedia })
}
