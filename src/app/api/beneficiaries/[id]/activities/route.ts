import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { generatePublicUrl, MediaRow } from "@/utils/supabase/media"

/**
 * Public endpoint: fetch public activities for a beneficiary, with their
 * associated media URLs pre-resolved server-side to avoid client-side RLS
 * issues when querying the media table directly.
 *
 * GET /api/beneficiaries/[id]/activities
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) {
    return NextResponse.json({ error: "Missing beneficiary id" }, { status: 400 })
  }

  const supabase = await createClient()

  const { data: activities, error: activitiesError } = await supabase
    .from("activities")
    .select("*")
    .eq("beneficiary_id", id)
    .eq("is_public", true)
    .order("created_at", { ascending: false })

  if (activitiesError) {
    return NextResponse.json({ error: activitiesError.message }, { status: 500 })
  }

  const safe = activities || []
  if (safe.length === 0) return NextResponse.json({ activities: [] })

  // Batch-fetch all media for these activities in a single query.
  const activityIds = safe.map((a) => a.id).filter(Boolean)

  const { data: allMedia, error: mediaError } = await supabase
    .from("media")
    .select("*")
    .in("parent_id", activityIds)
    .order("created_at", { ascending: true })

  if (mediaError) {
    console.error("Failed to fetch activity media:", mediaError)
    // Return activities without media rather than failing the whole request.
  }

  // Group media by parent_id for O(n) lookup.
  const mediaByParent: Record<string, typeof allMedia> = {}
  for (const m of allMedia || []) {
    const key = String(m.parent_id)
    if (!mediaByParent[key]) mediaByParent[key] = []
    mediaByParent[key].push(m)
  }

  const result = safe.map((activity) => {
    const images_url: string[] = []
    const videos_url: string[] = []

    for (const m of mediaByParent[String(activity.id)] || []) {
      try {
        const url = generatePublicUrl(m as unknown as MediaRow)
        if (m.type === "IMAGE") images_url.push(url)
        else if (m.type === "VIDEO") videos_url.push(url)
      } catch {
        // skip unresolvable media rows
      }
    }

    return { ...activity, images_url, videos_url }
  })

  return NextResponse.json({ activities: result })
}
