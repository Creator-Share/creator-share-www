import { LatLngBounds } from "leaflet"
import { Beneficiaries } from "./index"

export interface FiltersProps {
  onFilterChange: (filters: {
    gender: string
    ageRange: [number, number]
    status: string[]
    search?: string
  }) => void
  beneficiaryType?: "CHILD" | "ANIMAL"
}

export interface BeneficiaryMapProps {
  beneficiaryData: {
    id: string
    name: string
    location_geo: {
      coordinates: [number, number]
    } | null
    image_url?: string
    country: string
  }[]
  onMarkerClick: (id: string) => void
  onBoundsChange: (bounds: LatLngBounds) => void
  onResetView?: () => void
}

export interface BeneficiaryListingsProps {
  beneficiaryData: Beneficiaries[]
  selectedBeneficiaryId: string | null
  selectedCountry: string | null
  isLoading?: boolean
  setSelectedBeneficiaryId: (id: string | null) => void
  mapBounds?: LatLngBounds
  beneficiaryType?: "CHILD" | "ANIMAL"
}

export interface BeneficiaryCardProps {
  beneficiary: Beneficiaries
  isSelected?: boolean
  id: string
  onNext?: () => void
  onPrevious?: () => void
  hasNext?: boolean
  hasPrevious?: boolean
  onOpenDialog?: () => void
  beneficiaryType?: "CHILD" | "ANIMAL"
}

export interface SponsorshipDetailsProps {
  beneficiaryId?: string
  hideStatus?: boolean
  hideAmount?: boolean
}

// SponsorDialogProps removed; SponsorDialog replaced by BeneficiaryActivityModal
