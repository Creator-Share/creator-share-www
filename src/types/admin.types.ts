export type Geography = {
  coordinates: [number, number];
  type: 'Point';
};

export type SponsorshipType = 'STREET_INVOLVED' | 'CHILD_LABOR' | 'FAMILY' | 'PUPPY' | 'CHILD';

export type SponsorshipStatus = 'ACTIVE' | 'PENDING' | 'INACTIVE';

export interface BaseSponsorship {
  id?: string;
  created_at?: string;
  sponsorship_type: SponsorshipType;
  status: SponsorshipStatus;
  location_str: string;
  location_geo: Geography | null;
  story: string;
  budget_goal: number;
  budget_raised: number;
  monthly_support_cost: number;
}

export interface ChildSponsorshipAdmin extends BaseSponsorship {
  name: string;
  birth_date: string;
  gender: string;
  biography: string;
  country: string;
  video_url: string;
  introduction: string;
}

export interface StreetInvolvedSponsorshipAdmin extends BaseSponsorship {
  name: string;
  age: number;
  gender: string;
  background_story: string;
  current_situation: string;
}

export interface ChildLaborSponsorshipAdmin extends BaseSponsorship {
  name: string;
  age: number;
  gender: string;
  background_story: string;
}

export interface FamilySponsorshipAdmin extends BaseSponsorship {
  family_name: string;
  members_count: number;
}

export interface PuppySponsorshipAdmin extends BaseSponsorship {
  name: string;
  breed: string;
  age_months: number;
  gender: string;
  medical_history: string;
  vaccination_status: string;
}

export interface SponsorshipImage {
  id: string;
  sponsorship_id: string;
  image_url: string;
  order_index: number;
  created_at: string;
}

export interface SponsorshipFormData {
  images: File[];
  data: ChildSponsorshipAdmin | StreetInvolvedSponsorshipAdmin | ChildLaborSponsorshipAdmin | FamilySponsorshipAdmin | PuppySponsorshipAdmin;
}

export interface ImageUploadResponse {
  path: string;
  url: string;
}
