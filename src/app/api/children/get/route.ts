import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { ChildSponsorship } from "@/types";

type RawChildSponsorship = ChildSponsorship & { child_details?: Partial<ChildSponsorship> };

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  try {
    const query = supabase
      .from("sponsorships")
      .select(`
        *,
        child_details(*)
      `)
      .eq('sponsorship_type', 'CHILD');

    const ne = searchParams.get("ne");
    const sw = searchParams.get("sw");

    if (ne && sw) {
      try {
        const neCoords = JSON.parse(ne);
        const swCoords = JSON.parse(sw);

        const clamp = (value: number, min: number, max: number): number =>
          Math.max(min, Math.min(max, value));

        const clampLat = (lat: number): number => clamp(lat, -90, 90);
        const clampLng = (lng: number): number => clamp(lng, -180, 180);

        const clampedNeCoords = [clampLat(neCoords[0]), clampLng(neCoords[1])];
        const clampedSwCoords = [clampLat(swCoords[0]), clampLng(swCoords[1])];

        const { data, error } = await supabase.rpc("filter_sponsorships_by_polygon", {
          sw_lng: clampedSwCoords[1],
          sw_lat: clampedSwCoords[0],
          ne_lng: clampedNeCoords[1],
          ne_lat: clampedNeCoords[0],
          sponsorship_type: 'CHILD'
        });

        if (error) {
          console.error("Supabase error:", error);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        // Transform data to match ChildSponsorship interface
        const transformedData = data.map((item: RawChildSponsorship) => ({
          ...item,
          ...item.child_details,
          child_details: undefined
        }));

        return NextResponse.json({ children: transformedData });
      } catch (e) {
        console.error("Error parsing coordinates:", e);
        return NextResponse.json(
          { error: "Invalid coordinate format or out-of-range values" },
          { status: 400 }
        );
      }
    }

    const { data, error } = await query;

    if (error) {
      console.error("Supabase error:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // Transform data to match ChildSponsorship interface
    const transformedData = data.map((item: RawChildSponsorship) => ({
      ...item,
      ...item.child_details,
      child_details: undefined
    }));

    return NextResponse.json({ children: transformedData });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
