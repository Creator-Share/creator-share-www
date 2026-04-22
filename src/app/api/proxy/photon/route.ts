import { NextResponse } from "next/server"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")
  const limit = searchParams.get("limit") ?? "1"

  if (!q) {
    return NextResponse.json({ error: "Missing required parameter: q" }, { status: 400 })
  }

  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=${limit}`

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "CreatorShareApp/1.0 (contact@creatorshare.com)",
        "Accept": "application/json",
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error("Photon error response:", errorText)
      return NextResponse.json(
        { error: `Failed to fetch from Photon: ${response.status} ${response.statusText}` },
        { status: 502 },
      )
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error("Photon proxy error:", error)
    return NextResponse.json(
      { error: `Error fetching from Photon: ${error instanceof Error ? error.message : "Unknown error"}` },
      { status: 500 },
    )
  }
}
