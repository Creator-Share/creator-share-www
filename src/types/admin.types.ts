type Geography = {
    coordinates: [number, number];
    type: 'Point';
  };
export type People = {
    id: string;
    name: string;
    birth_date: string;
    biography: string;
    budget_goal: number;
    budget_raised: number;
    status: string;
    country: string;
    location_str: string;
    location_geo: Geography;
    image: string;
    gender: string;
  };

