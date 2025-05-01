import { LatLngBounds } from "leaflet";
import { SponsorPeople } from "./index";

export interface FiltersProps {
  onFilterChange: (filters: { gender: string; ageRange: [number, number]; status: string[] }) => void;
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
  onResetView?: () => void;
}

export interface ChildListingsProps {
  peopleData: SponsorPeople[];
  selectedChildId: string | null;
  selectedCountry: string | null;
  isLoading?: boolean;
  setSelectedChildId: (id: string | null) => void;
}

export interface ChildCardProps {
    people: SponsorPeople;
    isSelected?: boolean;
    id: string;
    onNext?: () => void;
    onPrevious?: () => void;
    hasNext?: boolean;
    hasPrevious?: boolean;
    onOpenDialog?: () => void;
}

export interface SponsorshipDetailsProps {
  childId?: string
}
