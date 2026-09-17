export type SubscriptionSubjectKind = "standard" | "blind" | "partnership"
export type SubscriptionPartnershipProject =
  "emergency" | "education" | "shelter" | "nutrition" | "general"

export interface SubscriptionSubjectInput {
  subjectKind: SubscriptionSubjectKind | null | undefined
  partnershipProject: SubscriptionPartnershipProject | null | undefined
  beneficiaryId: string | null
}

export interface SubscriptionSubjectPresentation {
  subjectKind: SubscriptionSubjectKind
  title: string
  subtitle: string | null
  canChooseChild: boolean
}

function humanizeProject(
  project: SubscriptionPartnershipProject | null | undefined,
): string {
  if (!project) return "Creator Share"
  return `${project[0].toUpperCase()}${project.slice(1)}`
}

/**
 * Canonical v2 rows must be classified by their server-owned subject kind.
 * The beneficiary-null fallback exists only for historical rows created
 * before subject_kind was persisted.
 */
export function presentSubscriptionSubject(
  input: SubscriptionSubjectInput,
): SubscriptionSubjectPresentation {
  if (input.subjectKind === "partnership") {
    return {
      subjectKind: "partnership",
      title: `${humanizeProject(input.partnershipProject)} Partnership`,
      subtitle: "Creator Share Partnership",
      canChooseChild: false,
    }
  }

  if (input.subjectKind === "blind") {
    return {
      subjectKind: "blind",
      title: "Awaiting Match",
      subtitle: "Blind Sponsorship",
      canChooseChild: true,
    }
  }

  if (input.subjectKind === "standard") {
    return {
      subjectKind: "standard",
      title: "Child Sponsorship",
      subtitle: null,
      canChooseChild: false,
    }
  }

  if (input.beneficiaryId === null) {
    return {
      subjectKind: "blind",
      title: "Awaiting Match",
      subtitle: "Blind Sponsorship",
      canChooseChild: true,
    }
  }

  return {
    subjectKind: "standard",
    title: "Child Sponsorship",
    subtitle: null,
    canChooseChild: false,
  }
}
