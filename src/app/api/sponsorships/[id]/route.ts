// src/app/api/sponsorships/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function extractId(req: NextRequest): string | null {
  const segments = req.nextUrl.pathname.split("/");
  return segments[segments.length - 1] || null;
}

export async function GET(req: NextRequest) {
  try {
    const id = extractId(req);
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const supabase = await createClient();
    const { searchParams } = req.nextUrl;
    const type = searchParams.get("type");

    const query = supabase
      .from("sponsorships")
      .select(`
        *,
        child_details(*),
        street_involved_details(*),
        child_labor_details(*),
        family_details(*),
        puppy_details(*)
      `)
      .eq("id", id);

    if (type) query.eq("sponsorship_type", type);

    const { data: sponsorship, error } = await query.single();

    if (error) return NextResponse.json({ error: "Failed to fetch sponsorship" }, { status: 500 });
    if (!sponsorship) return NextResponse.json({ error: "Sponsorship not found" }, { status: 404 });

    const transformed = {
      ...sponsorship,
      ...sponsorship[`${sponsorship.sponsorship_type.toLowerCase()}_details`]
    };

    delete transformed.child_details;
    delete transformed.street_involved_details;
    delete transformed.child_labor_details;
    delete transformed.family_details;
    delete transformed.puppy_details;

    return NextResponse.json({ sponsorship: transformed });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const id = extractId(req);
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const supabase = await createClient();
    const data = await req.json();

    const { error: sponsorshipError } = await supabase
      .from("sponsorships")
      .update({
        status: data.status,
        location_str: data.location_str,
        location_geo: data.location_geo,
        story: data.story,
        budget_goal: data.budget_goal,
        budget_raised: data.budget_raised,
        monthly_support_cost: data.monthly_support_cost
      })
      .eq("id", id);

    if (sponsorshipError) return NextResponse.json({ error: "Failed to update sponsorship" }, { status: 500 });

    const detailsTable = `${data.sponsorship_type.toLowerCase()}_details`;
    const detailsData = {
      name: data.name,
      gender: data.gender,
      country: data.country,
      ...(data.sponsorship_type === "CHILD" && {
        birth_date: data.birth_date,
        biography: data.biography,
        video_url: data.video_url,
        introduction: data.introduction
      }),
      ...(data.sponsorship_type === "STREET_INVOLVED" && {
        age: data.age,
        background_story: data.background_story,
        current_situation: data.current_situation
      }),
      ...(data.sponsorship_type === "CHILD_LABOR" && {
        age: data.age,
        background_story: data.background_story
      }),
      ...(data.sponsorship_type === "FAMILY" && {
        family_name: data.family_name,
        members_count: data.members_count
      }),
      ...(data.sponsorship_type === "PUPPY" && {
        breed: data.breed,
        age_months: data.age_months,
        medical_history: data.medical_history,
        vaccination_status: data.vaccination_status
      })
    };

    const { error: detailsError } = await supabase
      .from(detailsTable)
      .update(detailsData)
      .eq("sponsorship_id", id);

    if (detailsError) return NextResponse.json({ error: "Failed to update details" }, { status: 500 });

    const { data: fullSponsorship, error: fetchError } = await supabase
      .from("sponsorships")
      .select(`
        *,
        child_details(*),
        street_involved_details(*),
        child_labor_details(*),
        family_details(*),
        puppy_details(*)
      `)
      .eq("id", id)
      .single();

    if (fetchError) return NextResponse.json({ error: "Failed to fetch updated sponsorship" }, { status: 500 });

    const transformed = {
      ...fullSponsorship,
      ...fullSponsorship[`${fullSponsorship.sponsorship_type.toLowerCase()}_details`]
    };

    delete transformed.child_details;
    delete transformed.street_involved_details;
    delete transformed.child_labor_details;
    delete transformed.family_details;
    delete transformed.puppy_details;

    return NextResponse.json(transformed);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = extractId(req);
    if (!id) return NextResponse.json({ error: "Missing ID" }, { status: 400 });

    const supabase = await createClient();

    const { data: sponsorship, error: fetchError } = await supabase
      .from("sponsorships")
      .select("sponsorship_type")
      .eq("id", id)
      .single();

    if (fetchError || !sponsorship) return NextResponse.json({ error: "Failed to fetch sponsorship type" }, { status: 500 });

    await supabase.from("sponsorship_images").delete().eq("sponsorship_id", id);
    await supabase.from("sponsorship_activities").delete().eq("sponsorship_id", id);
    await supabase.from("subscriptions").delete().eq("sponsorship_id", id);
    await supabase.from("transaction_ledger").delete().eq("sponsorship_id", id);

    const detailsTable = `${sponsorship.sponsorship_type.toLowerCase()}_details`;
    await supabase.from(detailsTable).delete().eq("sponsorship_id", id);
    const { error: sponsorshipError } = await supabase.from("sponsorships").delete().eq("id", id);

    if (sponsorshipError) return NextResponse.json({ error: "Failed to delete sponsorship" }, { status: 500 });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
