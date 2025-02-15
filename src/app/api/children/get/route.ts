import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(req.url);

  try {
    const query = supabase
      .from("sponsor_people")
      .select("*")
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

        const { data, error } = await supabase.rpc("filter_by_polygon", {
          sw_lng: clampedSwCoords[1],
          sw_lat: clampedSwCoords[0],
          ne_lng: clampedNeCoords[1],
          ne_lat: clampedNeCoords[0],
        });

        if (error) {
          console.error("Supabase error:", error);
          return NextResponse.json({ error: "Database error" }, { status: 500 });
        }

        return NextResponse.json({ people: data });
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

    return NextResponse.json({ people: data });
  } catch (err) {
    console.error("Unexpected error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
