import { NextRequest, NextResponse } from "next/server"
import { findInvalidPublicActivityProjectionField } from "@/config/beneficiaryValidation"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"

// Configure route for JSON requests (no large file uploads)
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || ""

  if (contentType.includes("multipart/form-data")) {
    console.error("❌ [CREATE ACTIVITY] Received FormData instead of JSON")
    return NextResponse.json(
      {
        error:
          "This endpoint now accepts JSON only (no files). Please use the split upload pattern.",
        details:
          "1. Send JSON to /api/admin/activities/create to create activity. 2. Send files to /api/admin/activities/media/create with the returned activityId.",
        documentation: "See docs/activity-upload-fix.md for migration guide",
      },
      { status: 400 },
    )
  }

  try {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response

    // Parse JSON body (lightweight - no files)
    const body = await req.json()

    const {
      title,
      description,
      activity_type,
      activity_source,
      beneficiary_id,
      is_public,
    } = body

    if (!description || !beneficiary_id || !activity_type || !activity_source) {
      console.error("❌ [CREATE ACTIVITY] Missing required fields")
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      )
    }

    const invalidProjectionField = findInvalidPublicActivityProjectionField({
      title: title ?? null,
      description,
      activity_type,
    })
    if (invalidProjectionField !== null) {
      return NextResponse.json(
        { error: `Invalid activity ${invalidProjectionField}` },
        { status: 400 },
      )
    }

    const { data: activityInserted, error: insertErr } = await supabase
      .from("activities")
      .insert([
        {
          title,
          description,
          activity_type,
          created_by: activity_source,
          beneficiary_id,
          is_public: typeof is_public === "boolean" ? is_public : false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single()

    if (insertErr) {
      console.error(
        "❌ [CREATE ACTIVITY] Failed to insert activity:",
        insertErr,
      )
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    const activityId = activityInserted?.id
    const inserted = activityInserted

    return NextResponse.json(
      { activity: inserted, activityId },
      { status: 201 },
    )
  } catch (error) {
    console.error("❌ [CREATE ACTIVITY] Fatal error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
