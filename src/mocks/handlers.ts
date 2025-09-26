import { http, HttpResponse } from "msw"
import { Beneficiaries } from "@/types"

const mockChildren: Beneficiaries[] = [
  {
    id: "1",
    name: "John Doe",
    username: "john_doe",
    gender: "Boy",
    birth_date: new Date(
      Date.now() - 8 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    image_url: "https://example.com/john.jpg",
    biography: "John is a bright and energetic child who loves to learn.",
    country: "Tanzania",
    location_geo: { coordinates: [39.2833, -6.8235], type: "Point" },
    video_url: "https://example.com/john-video.mp4",
    introduction: "Meet John, a wonderful child from Tanzania",
    budget_goal: 1000,
    budget_raised: 200,
    status: "New",
    location_str: "Dar es Salaam, Tanzania",
    active_subscriptions: 0,
    metadata: {},
    beneficiary_type: "CHILD",
  },
  {
    id: "1",
    name: "John Doe",
    username: "john_doe",
    gender: "Boy",
    birth_date: new Date(
      Date.now() - 8 * 365 * 24 * 60 * 60 * 1000,
    ).toISOString(),
    image_url: "https://example.com/john.jpg",
    biography: "John is a bright and energetic child who loves to learn.",
    country: "Tanzania",
    location_geo: { coordinates: [39.2833, -6.8235], type: "Point" },
    video_url: "https://example.com/john-video.mp4",
    introduction: "Meet John, a wonderful child from Tanzania",
    budget_goal: 1000,
    budget_raised: 200,
    status: "New",
    location_str: "Dar es Salaam, Tanzania",
    active_subscriptions: 0,
    metadata: {},
    beneficiary_type: "CHILD",
  },
]

export const handlers = [
  http.get("/api/children/get", () => {
    return HttpResponse.json({ people: mockChildren })
  }),

  http.get("/api/children/getByAgeAndGender", ({ request }) => {
    const url = new URL(request.url)
    const gender = url.searchParams.get("gender")
    const ageRange = url.searchParams.get("ageRange")?.split(",").map(Number)
    const status = url.searchParams.get("status")?.split(",")

    let filteredChildren = [...mockChildren]

    if (gender) {
      filteredChildren = filteredChildren.filter(
        (child) => child.gender === gender,
      )
    }

    if (ageRange) {
      const now = Date.now()
      filteredChildren = filteredChildren.filter((child) => {
        const ageInYears =
          (now - new Date(child.birth_date).getTime()) /
          (365 * 24 * 60 * 60 * 1000)
        return ageInYears >= ageRange[0] && ageInYears <= ageRange[1]
      })
    }

    if (status) {
      filteredChildren = filteredChildren.filter((child) =>
        status.includes(child.status),
      )
    }

    return HttpResponse.json({ people: filteredChildren })
  }),
]
