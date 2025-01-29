type Geography = {
  coordinates: [number, number];
  type: 'Point';
};
export interface People {
    id: string;
    name: string;
    // location: string;
    // age: number;
    birth_date: number;
    image: string;
    biography: string;
    country_group: string;
    time_in_site: string;
    budget_goal: number;
    budget_raised: number;
    status: string;
    country:string;
    location_geo: Geography;
  }

export interface loginForm {
    email: string;
    password: string;
  }

export interface RoleAssignment {
  roles: {
    name: string;
  };
}