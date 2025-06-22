import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "Missing lat or lon" }, { status: 400 });
  }

  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "CreatorShareDev/1.0 (your-email@example.com)",
        "Accept-Language": "en",
      },
    });
    if (!response.ok) {
      return NextResponse.json({ error: "Failed to fetch from Nominatim" }, { status: 502 });
    }
    const data = await response.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Error fetching from Nominatim" }, { status: 500 });
  }
}
