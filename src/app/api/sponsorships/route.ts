import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const supabase = await createClient();

    const type = searchParams.get("type");
    const gender = searchParams.get("gender");
    const ageRange = searchParams.get("ageRange");
    const status = searchParams.get("status");

    let query = supabase
      .from("sponsorships")
      .select(`
        *,
        child_details(*),
        street_involved_details(*),
        child_labor_details(*),
        family_details(*),
        puppy_details(*)
      `);

    if (type) {
      query = query.eq("sponsorship_type", type);
    }

    if (status) {
      const statusArray = status.split(",");
      query = query.in("status", statusArray);
    }

    // Add type-specific filters
    if (type === "CHILD" || type === "STREET_INVOLVED" || type === "CHILD_LABOR") {
      if (gender) {
        const detailsTable = `${type.toLowerCase()}_details`;
        query = query.eq(`${detailsTable}.gender`, gender);
      }

      if (ageRange) {
        const [minAge, maxAge] = ageRange.split(",").map(Number);
        const detailsTable = `${type.toLowerCase()}_details`;
        
        if (type === "CHILD") {
          // For children, we use birth_date
          const maxDate = new Date();
          maxDate.setFullYear(maxDate.getFullYear() - minAge);
          const minDate = new Date();
          minDate.setFullYear(minDate.getFullYear() - maxAge - 1);

          query = query
            .gte(`${detailsTable}.birth_date`, minDate.toISOString())
            .lt(`${detailsTable}.birth_date`, maxDate.toISOString());
        } else {
          // For others, we use direct age field
          query = query
            .gte(`${detailsTable}.age`, minAge)
            .lte(`${detailsTable}.age`, maxAge);
        }
      }
    }

    const { data: sponsorships, error } = await query;

    if (error) {
      console.error("Error fetching sponsorships:", error);
      return NextResponse.json(
        { error: "Failed to fetch sponsorships" },
        { status: 500 }
      );
    }

    // Transform the data based on sponsorship type
    const transformedSponsorships = sponsorships.map(sponsorship => {
      const detailsKey = `${sponsorship.sponsorship_type.toLowerCase()}_details`;
      const details = sponsorship[detailsKey];

      const transformed = {
        ...sponsorship,
        ...details
      };

      // Remove all type-specific detail objects
      delete transformed.child_details;
      delete transformed.street_involved_details;
      delete transformed.child_labor_details;
      delete transformed.family_details;
      delete transformed.puppy_details;

      return transformed;
    });

    return NextResponse.json({ sponsorships: transformedSponsorships });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const data = await req.json();

    // First create the sponsorship record
    const { data: sponsorship, error: sponsorshipError } = await supabase
      .from("sponsorships")
      .insert({
        sponsorship_type: data.sponsorship_type,
        status: data.status,
        location_str: data.location_str,
        location_geo: data.location_geo,
        story: data.story,
        budget_goal: data.budget_goal,
        budget_raised: data.budget_raised,
        monthly_support_cost: data.monthly_support_cost,
      })
      .select()
      .single();

    if (sponsorshipError) {
      console.error("Error creating sponsorship:", sponsorshipError);
      return NextResponse.json(
        { error: "Failed to create sponsorship" },
        { status: 500 }
      );
    }

    // Then create the type-specific details
    const detailsTable = `${data.sponsorship_type.toLowerCase()}_details`;
    const detailsData = {
      sponsorship_id: sponsorship.id,
      name: data.name,
      gender: data.gender,
      country: data.country,
      ...(data.sponsorship_type === "CHILD" && {
        birth_date: data.birth_date,
        biography: data.biography,
        video_url: data.video_url,
        introduction: data.introduction,
      }),
      ...(data.sponsorship_type === "STREET_INVOLVED" && {
        age: data.age,
        background_story: data.background_story,
        current_situation: data.current_situation,
      }),
      ...(data.sponsorship_type === "CHILD_LABOR" && {
        age: data.age,
        background_story: data.background_story,
      }),
      ...(data.sponsorship_type === "FAMILY" && {
        family_name: data.family_name,
        members_count: data.members_count,
      }),
      ...(data.sponsorship_type === "PUPPY" && {
        breed: data.breed,
        age_months: data.age_months,
        medical_history: data.medical_history,
        vaccination_status: data.vaccination_status,
      }),
    };

    const { error: detailsError } = await supabase
      .from(detailsTable)
      .insert(detailsData);

    if (detailsError) {
      console.error("Error creating details:", detailsError);
      // Rollback sponsorship creation
      await supabase
        .from("sponsorships")
        .delete()
        .eq("id", sponsorship.id);
      return NextResponse.json(
        { error: "Failed to create details" },
        { status: 500 }
      );
    }

    // Return the created sponsorship with its details
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
      .eq("id", sponsorship.id)
      .single();

    if (fetchError) {
      console.error("Error fetching created sponsorship:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch created sponsorship" },
        { status: 500 }
      );
    }

    // Transform the response
    const detailsKey = `${fullSponsorship.sponsorship_type.toLowerCase()}_details`;
    const details = fullSponsorship[detailsKey];

    const transformed = {
      ...fullSponsorship,
      ...details
    };

    // Remove all type-specific detail objects
    delete transformed.child_details;
    delete transformed.street_involved_details;
    delete transformed.child_labor_details;
    delete transformed.family_details;
    delete transformed.puppy_details;

    return NextResponse.json(transformed);
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
