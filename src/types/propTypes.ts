import { LatLngBounds } from "leaflet";
import { ChildSponsorship } from "./index";

export interface FiltersProps {
  onFilterChange: (filters: { gender: string; ageRange: [number, number]; status: string[] }) => void;
  variant?: 'sidebar';
}

export interface ChildMapProps {
  childData: ChildSponsorship[];
  onMarkerClick: (id: string) => void;
  onBoundsChange: (bounds: LatLngBounds) => void;
  onResetView?: () => void;
  onFilterChange: (filters: { gender: string; ageRange: [number, number]; status: string[] }) => void;
}

export interface ChildListingsProps {
  childrenData: ChildSponsorship[];
  selectedChildId: string | null;
  selectedCountry: string | null;
  isLoading?: boolean;
  setSelectedChildId: (id: string | null) => void;
}

export interface ChildCardProps {
  child: ChildSponsorship;
  isSelected?: boolean;
  id: string;
  onNext?: () => void;
  onPrevious?: () => void;
  hasNext?: boolean;
  hasPrevious?: boolean;
  onOpenDialog?: () => void;
}

export interface SponsorshipDetailsProps {
  childId?: string;
}
