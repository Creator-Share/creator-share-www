import { LatLngBounds } from "leaflet"
import { Beneficiaries } from "./index"
import type { BeneficiaryTabType } from "@/config/beneficiaryTypes"

export interface FiltersProps {
  onFilterChange: (filters: {
    gender: string
    ageRange: [number, number]
    status: string[]
    search?: string
  }) => void
  beneficiaryType?: BeneficiaryTabType
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
  /** When true, a fresh filter-change fetch is in progress; stale cards are shown dimmed to preserve page height and scroll position. */
  isRefreshing?: boolean
  setSelectedBeneficiaryId?: (id: string | null) => void
  mapBounds?: LatLngBounds
  beneficiaryType?: BeneficiaryTabType
  /** Called when a card is clicked; container owns the modal. */
  onOpenModal?: (beneficiary: Beneficiaries) => void
  /** When true, suppresses the component's own card border/shadow/radius so a parent can provide the card frame. */
  noCard?: boolean
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
  beneficiaryType?: BeneficiaryTabType
}

export interface SponsorshipDetailsProps {
  beneficiaryId?: string
  hideStatus?: boolean
  hideAmount?: boolean
}

// SponsorDialogProps removed; SponsorDialog replaced by BeneficiaryModal
