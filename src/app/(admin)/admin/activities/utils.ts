import {
  ACTIVITY_THRESHOLDS,
  ActivityStatus,
} from "./constants"
import { BeneficiaryWithActivity } from "@/types/admin.types"

export function getActivityStatus(
  daysSince: number,
  hasActivity: boolean
): ActivityStatus {
  if (!hasActivity) {
    return "noActivities"
  }

  if (daysSince > ACTIVITY_THRESHOLDS.OVERDUE_DAYS) {
    return "overdue"
  }

  if (daysSince > ACTIVITY_THRESHOLDS.DUE_SOON_DAYS) {
    return "dueSoon"
  }

  return "upToDate"
}

export interface CategorizedBeneficiaries {
  overdue: BeneficiaryWithActivity[]
  dueSoon: BeneficiaryWithActivity[]
  upToDate: BeneficiaryWithActivity[]
  noActivities: BeneficiaryWithActivity[]
}

export function categorizeBeneficiaries(
  beneficiaries: BeneficiaryWithActivity[]
): CategorizedBeneficiaries {
  const overdue: BeneficiaryWithActivity[] = []
  const dueSoon: BeneficiaryWithActivity[] = []
  const upToDate: BeneficiaryWithActivity[] = []
  const noActivities: BeneficiaryWithActivity[] = []

  beneficiaries.forEach((beneficiary) => {
    const status = getActivityStatus(
      beneficiary.days_since_last_activity ?? 0,
      beneficiary.last_activity_date !== null
    )

    switch (status) {
      case "overdue":
        overdue.push(beneficiary)
        break
      case "dueSoon":
        dueSoon.push(beneficiary)
        break
      case "upToDate":
        upToDate.push(beneficiary)
        break
      case "noActivities":
        noActivities.push(beneficiary)
        break
    }
  })

  return { overdue, dueSoon, upToDate, noActivities }
}

export function formatLastActivityDate(date: string | null): string {
  if (!date) {
    return "Never"
  }

  const activityDate = new Date(date)
  const options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  }
  return `Last: ${activityDate.toLocaleDateString("en-US", options)}`
}

export function formatDaysSince(days: number, hasActivity: boolean): string {
  if (!hasActivity) {
    return "No updates"
  }

  if (days === 0) {
    return "Today"
  }

  if (days === 1) {
    return "1 day ago"
  }

  return `${days} days ago`
}
