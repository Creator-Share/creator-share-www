import { LatLngBounds } from "leaflet";
import { SponsorPeople } from "./index";

export interface FiltersProps {
  onFilterChange: (filters: { gender: string; age: string }) => void;
}

export interface ChildMapProps {
  childData: {
    id: string;
    name: string;
    location_geo: {
      coordinates: [number, number];
    };
    image_url: string;
    country: string;
  }[];
  onMarkerClick: (id: string) => void;
  onBoundsChange: (bounds: LatLngBounds) => void;
}

export interface ChildListingsProps {
  peopleData: SponsorPeople[];
  selectedChildId: string | null;
  selectedCountry: string | null;
}

export interface ChildCardProps {
    people: SponsorPeople;
    isSelected?: boolean;
    id: string;
}
