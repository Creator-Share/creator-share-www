import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const lat = searchParams.get("lat")
  const lon = searchParams.get("lon")
  const q = searchParams.get("q")

  let url: string

  if (lat && lon) {
    // Reverse geocoding
    url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`
  } else if (q) {
    // Search geocoding
    url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
  } else {
    return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
  }

  try {
    console.log('Fetching from Nominatim:', url)
    
    const response = await fetch(url, {
      headers: {
        "User-Agent": "CreatorShareApp/1.0 (contact@creatorshare.com)",
        "Accept-Language": "en",
        "Accept": "application/json",
      },
    })
    
    console.log('Nominatim response status:', response.status)
    
    if (!response.ok) {
      const errorText = await response.text()
      console.error('Nominatim error response:', errorText)
      return NextResponse.json(
        { error: `Failed to fetch from Nominatim: ${response.status} ${response.statusText}` },
        { status: 502 },
      )
    }
    
    const data = await response.json()
    console.log('Nominatim response data:', data)
    return NextResponse.json(data)
  } catch (error) {
    console.error('Proxy error:', error)
    return NextResponse.json(
      { error: `Error fetching from Nominatim: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 },
    )
  }
}
