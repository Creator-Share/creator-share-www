import { NextRequest, NextResponse } from "next/server"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"
import {
  filterExistingMediaRows,
  getDirectMediaUrl,
  MediaRow,
} from "@/utils/supabase/media"

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
    .from("public_activities")
    .select("*")
    .eq("beneficiary_id", id)
    .order("created_at", { ascending: false })

  if (activitiesError) {
    return NextResponse.json({ error: activitiesError.message }, { status: 500 })
  }

  const safe = activities || []
  if (safe.length === 0) return NextResponse.json({ activities: [] })

  // Batch-fetch all media for these activities in a single query.
  const activityIds = safe.map((a) => a.id).filter(Boolean)

  const { data: allMedia, error: mediaError } = await supabase
    .from("public_media")
    .select("*")
    .in("parent_id", activityIds)
    .order("created_at", { ascending: true })

  if (mediaError) {
    console.error("Failed to fetch activity media:", mediaError)
    // Return activities without media rather than failing the whole request.
  }

  // Group media by parent_id for O(n) lookup.
  const serviceSupabase = createServiceRoleClient()
  const existingMedia = await filterExistingMediaRows(serviceSupabase, (allMedia || []) as unknown as MediaRow[])

  const mediaByParent: Record<string, MediaRow[]> = {}
  for (const m of existingMedia) {
    const key = String(m.parent_id)
    if (!mediaByParent[key]) mediaByParent[key] = []
    mediaByParent[key].push(m)
  }

  const result = safe.map((activity) => {
    const images_url: string[] = []
    const videos_url: string[] = []

    for (const m of mediaByParent[String(activity.id)] || []) {
      try {
        const url = getDirectMediaUrl(m as unknown as MediaRow)
        if (m.type === "IMAGE") images_url.push(url)
        else if (m.type === "VIDEO") videos_url.push(url)
      } catch {
        // skip rows missing required fields
      }
    }

    return { ...activity, images_url, videos_url }
  })

  return NextResponse.json({ activities: result })
}
