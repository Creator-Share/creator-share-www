import { LatLngBounds } from "leaflet";
import { Beneficiaries } from "./index";

export interface FiltersProps {
  onFilterChange: (filters: { gender: string; ageRange: [number, number]; status: string[] }) => void;
}


export interface BeneficiaryMapProps {
  beneficiaryData: {
    id: string;
    name: string;
    location_geo: {
      coordinates: [number, number];
    } | null;
    image_url?: string;
    country: string;
  }[];
  onMarkerClick: (id: string) => void;
  onBoundsChange: (bounds: LatLngBounds) => void;
  onResetView?: () => void;
}

export interface BeneficiaryListingsProps {
  beneficiaryData: Beneficiaries[];
  selectedBeneficiaryId: string | null;
  selectedCountry: string | null;
  isLoading?: boolean;
  setSelectedBeneficiaryId: (id: string | null) => void;
}

export interface BeneficiaryCardProps {
    beneficiary: Beneficiaries;
    isSelected?: boolean;
    id: string;
    onNext?: () => void;
    onPrevious?: () => void;
    hasNext?: boolean;
    hasPrevious?: boolean;
    onOpenDialog?: () => void;
}

export interface SponsorshipDetailsProps {
  beneficiaryId?: string;
  hideStatus?: boolean;
}
