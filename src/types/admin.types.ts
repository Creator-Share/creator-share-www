export type Geography = {
    coordinates: [number, number];
    type: 'Point';
  };
  export interface SponsorPeople {
    id?: string;
    name: string;
    username: string;
    gender: string;
    birth_date: string;
    biography: string;
    budget_goal: number;
    budget_raised: number;
    status: string;
    country: string;
    location_geo: Geography | null;
    location_str: string;
    video_url: string;
    introduction: string;
  }
  
 export interface SponsorPeopleImage {
    id: string;
    sponsor_people_id: string;
    image_url: string;
    order_index: number;
    created_at: string;
  }

