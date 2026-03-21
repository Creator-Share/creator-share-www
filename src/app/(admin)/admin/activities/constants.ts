export const ACTIVITY_THRESHOLDS = {
  OVERDUE_DAYS: 30,
  DUE_SOON_DAYS: 15,
} as const

export const ACTIVITY_STATUS_CONFIG = {
  overdue: {
    label: "Overdue",
    emoji: "🔴",
    color: "red.600",
    borderColor: "red.300",
    bgColor: "red.50",
    description: "No activity for over 30 days",
  },
  dueSoon: {
    label: "Due Soon",
    emoji: "🟡",
    color: "yellow.600",
    borderColor: "yellow.300",
    bgColor: "yellow.50",
    description: "No activity for 15-30 days",
  },
  upToDate: {
    label: "Up to Date",
    emoji: "🟢",
    color: "green.600",
    borderColor: "green.300",
    bgColor: "green.50",
    description: "Activity within last 15 days",
  },
  noActivities: {
    label: "No Activities",
    emoji: "⚫",
    color: "gray.600",
    borderColor: "gray.300",
    bgColor: "gray.50",
    description: "No activities recorded yet",
  },
  noPublicMedia: {
    label: "No public photos or videos",
    emoji: "📷",
    color: "purple.600",
    borderColor: "purple.300",
    bgColor: "purple.50",
    description:
      "No sponsor-visible activity includes an image or video yet (may also appear above)",
  },
} as const

export type ActivityStatus = keyof typeof ACTIVITY_STATUS_CONFIG
