import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Beneficiaries } from "@/types/admin.types"
import { notifyChildCreated } from "@/services/telegram"
import { calculateAge } from "@/utils/ageCalculator"

export async function POST(req: Request) {
  const supabase = await createClient()
  try {
    // Parse JSON request body
    const body = await req.json()

    const data: Partial<Beneficiaries> = {
      name: body.name,
      username: body.username,
      gender: body.gender,
      birth_date: body.birth_date,
      biography: body.biography,
      introduction: body.introduction,
      budget_goal: body.budget_goal || 0,
      budget_raised: body.budget_raised || 0,
      status: body.status,
      country: body.country,
      location_str: body.location_str,
      location_geo: body.location_geo,
      video_url: body.video_url,
      beneficiary_type: body.beneficiary_type,
    }

    const insertData = { ...data, status: "New" }
    if (!insertData.country) insertData.country = "Unknown Country"
    if (!insertData.location_str) insertData.location_str = "Unknown Location"
    
    const { data: inserted, error } = await supabase
      .from("beneficiaries")
      .insert([insertData])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Send Telegram notification for child beneficiaries
    if (inserted.beneficiary_type === "CHILD") {
      try {
        // Calculate age from birth_date using existing utility
        const age = inserted.birth_date ? calculateAge(inserted.birth_date) : null;

        const notificationData = {
          ...inserted,
          age
        };

        // Send notification asynchronously (don't wait for it)
        notifyChildCreated(notificationData).catch(error => {
          console.error('Telegram notification failed for child:', inserted.id, error);
        });
      } catch (notificationError) {
        console.error('Error preparing Telegram notification:', notificationError);
        // Don't fail the main operation if notification fails
      }
    }

    // File uploads are handled separately via /api/admin/beneficiaries/media/upload
    return NextResponse.json({ beneficiaryId: inserted.id, beneficiary: inserted }, { status: 201 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
