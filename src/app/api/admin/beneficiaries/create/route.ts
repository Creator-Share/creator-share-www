import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { Beneficiaries, BeneficiaryType, Status } from "@/types/admin.types"

export async function POST(req: Request) {
  const supabase = await createClient()
  try {
    // Handle FormData instead of JSON
    const formData = await req.formData()
    
    // Handle location_geo as JSON string
    const locationGeo = formData.get('location_geo') as string
    const parsedLocationGeo = locationGeo ? JSON.parse(locationGeo) : null

    const data: Partial<Beneficiaries> = {
      name: formData.get('name') as string,
      username: formData.get('username') as string,
      gender: formData.get('gender') as 'Boy' | 'Girl',
      birth_date: formData.get('birth_date') as string,
      biography: formData.get('biography') as string,
      introduction: formData.get('introduction') as string,
      budget_goal: formData.get('budget_goal') ? parseInt(formData.get('budget_goal') as string) : 0,
      budget_raised: formData.get('budget_raised') ? parseInt(formData.get('budget_raised') as string) : 0,
      status: formData.get('status') as Status,
      country: formData.get('country') as string,
      location_str: formData.get('location_str') as string,
      location_geo: parsedLocationGeo, // Use parsed JSON
      video_url: formData.get('video_url') as string,
      beneficiary_type: formData.get('beneficiary_type') as BeneficiaryType,
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

    // TODO: Handle file uploads (images and videos) here
    // For now, just return the created beneficiary
    return NextResponse.json({ beneficiary: inserted }, { status: 201 })
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}
