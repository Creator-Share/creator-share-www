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
      name: formData.get('name') as string,
      username: formData.get('username') as string,
      gender: formData.get('gender') as 'Boy' | 'Girl',
      birth_date: formData.get('birth_date')?.toString() || undefined,
      biography: formData.get('biography') as string,
      budget_goal: formData.get('budget_goal') ? parseInt(formData.get('budget_goal') as string) : 0,
      budget_raised: formData.get('budget_raised') ? parseInt(formData.get('budget_raised') as string) : 0,
      status: formData.get('status') as Status,
      country: formData.get('country') as string,
      location_str: formData.get('location_str') as string,
      location_geo: parsedLocationGeo, // Use parsed JSON
      video_url: formData.get('video_url') as string,
      beneficiary_type: formData.get('beneficiary_type') as BeneficiaryType,
    }

    const insertData = { ...data }
    if (!insertData.status) insertData.status = "New"
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

    // TODO: Handle file uploads (images and videos) here
    // For now, just return the created beneficiary
    return NextResponse.json({ 
      beneficiary: inserted, 
      beneficiaryId: inserted.id 
    }, { status: 201 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
