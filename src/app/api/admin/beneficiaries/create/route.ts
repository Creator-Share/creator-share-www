import { NextResponse } from "next/server"
import { createClient } from "@/utils/supabase/server"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { Beneficiaries, Status, BeneficiaryType } from "@/types/admin.types"
import { notifyChildCreated } from "@/services/telegram"
import { calculateAge } from "@/utils/ageCalculator"

export async function POST(req: Request) {
  const supabase = await createClient()
  const auth = await requireSuperAdmin(supabase)
  if (!auth.ok) return auth.response
  try {
    let body;
    try {
      body = await req.json();
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate required fields
    const requiredFields = ['name', 'username', 'gender', 'biography'];
    const missingFields = requiredFields.filter(field => !body[field]);
    if (missingFields.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missingFields.join(', ')}` },
        { status: 400 }
      );
    }

    const birthDateIsEstimate =
      Boolean(body.birth_date_is_estimate) ||
      Boolean(body.metadata?.birth_date_is_estimate)

    // Sanitize and validate input data
    const data: Partial<Beneficiaries> = {
      name: String(body.name).trim(),
      username: String(body.username).trim(),
      gender: body.gender === 'Boy' || body.gender === 'Girl' ? body.gender : 'Boy',
      birth_date: body.birth_date || undefined,
      biography: String(body.biography).trim(),
      budget_goal: Math.max(0, Number(body.budget_goal) || 0),
      budget_raised: Math.max(0, Number(body.budget_raised) || 0),
      status: (body.status || 'New') as Status,
      country: body.country ? String(body.country).trim() : 'Unknown Country',
      location_str: body.location_str ? String(body.location_str).trim() : 'Unknown Location',
      location_geo: body.location_geo || null,
      video_url: body.video_url ? String(body.video_url).trim() : '',
      active_subscriptions: 0,
      metadata: {
        ...(body.metadata || {}),
        birth_date_is_estimate: birthDateIsEstimate,
      },
      beneficiary_type: 'CHILD' as BeneficiaryType,
      introduction: String(body.biography).trim()
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
