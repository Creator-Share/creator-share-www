import { http, HttpResponse } from "msw";
import { SponsorPeople } from "@/types";

const mockChildren: SponsorPeople[] = [
  {
    id: "1",
    name: "John Doe",
    username: "john_doe",
    gender: "Male",
    birth_date: Date.now() - (8 * 365 * 24 * 60 * 60 * 1000), // 8 years old
    image_url: "https://example.com/john.jpg",
    biography: "John is a bright and energetic child who loves to learn.",
    country_group: "East Africa",
    time_in_site: "2 years",
    budget_goal: 1000,
    budget_raised: 200,
    status: "New",
    country: "Tanzania",
    location_geo: {
      coordinates: [39.2833, -6.8235], // Dar es Salaam coordinates
      type: "Point"
    },
    video_url: "https://example.com/john-video.mp4",
    introduction: "Meet John, a wonderful child from Tanzania"
  },
  {
    id: "2",
    name: "Sarah Smith",
    username: "sarah_smith",
    gender: "Female",
    birth_date: Date.now() - (10 * 365 * 24 * 60 * 60 * 1000), // 10 years old
    image_url: "https://example.com/sarah.jpg",
    biography: "Sarah is passionate about art and helping others.",
    country_group: "East Africa",
    time_in_site: "1 year",
    budget_goal: 1000,
    budget_raised: 500,
    status: "Partially Funded",
    country: "Tanzania",
    location_geo: {
      coordinates: [39.2833, -6.8235], // Dar es Salaam coordinates
      type: "Point"
    },
    video_url: "https://example.com/sarah-video.mp4",
    introduction: "Meet Sarah, an aspiring artist from Tanzania"
  }
];

export const handlers = [
  http.get("/api/children/get", () => {
    return HttpResponse.json({ people: mockChildren });
  }),

  http.get("/api/children/getByAgeAndGender", ({ request }) => {
    const url = new URL(request.url);
    const gender = url.searchParams.get("gender");
    const ageRange = url.searchParams.get("ageRange")?.split(",").map(Number);
    const status = url.searchParams.get("status")?.split(",");

    let filteredChildren = [...mockChildren];

    if (gender) {
      filteredChildren = filteredChildren.filter(child => child.gender === gender);
    }

    if (ageRange) {
      const now = Date.now();
      filteredChildren = filteredChildren.filter(child => {
        const ageInYears = (now - child.birth_date) / (365 * 24 * 60 * 60 * 1000);
        return ageInYears >= ageRange[0] && ageInYears <= ageRange[1];
      });
    }

    if (status) {
      filteredChildren = filteredChildren.filter(child => 
        status.includes(child.status)
      );
    }

    return HttpResponse.json({ people: filteredChildren });
  })
];
