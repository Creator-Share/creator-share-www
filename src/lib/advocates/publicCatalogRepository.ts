import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type {
  PublicCatalogCursorComponents,
  PublicCatalogFilters,
} from "./publicCatalog"

interface SupabaseErrorLike {
  code?: string
}

export class PublicCatalogRepositoryError extends Error {
  readonly stage: string

  constructor(stage: string, cause: SupabaseErrorLike | null) {
    super("public_catalog_repository_failure", { cause })
    this.name = "PublicCatalogRepositoryError"
    this.stage = stage
  }
}

export interface PublicCatalogRepository {
  loadPrimaryPage(
    filters: PublicCatalogFilters,
    cursor: PublicCatalogCursorComponents | null,
  ): Promise<unknown>
  loadAdvocatePage(
    canonicalHostname: string,
    filters: PublicCatalogFilters,
    cursor: PublicCatalogCursorComponents | null,
  ): Promise<unknown | null>
  loadPrimaryBeneficiaryByUsername(username: string): Promise<unknown | null>
  loadAdvocateBeneficiaryByUsername(
    canonicalHostname: string,
    username: string,
  ): Promise<unknown | null>
  loadPrimaryBeneficiaryMediaById(
    beneficiaryId: string,
  ): Promise<unknown | null>
  loadAdvocateBeneficiaryMediaById(
    canonicalHostname: string,
    beneficiaryId: string,
  ): Promise<unknown | null>
  loadPrimaryBeneficiaryActivitiesById(
    beneficiaryId: string,
  ): Promise<unknown | null>
  loadAdvocateBeneficiaryActivitiesById(
    canonicalHostname: string,
    beneficiaryId: string,
  ): Promise<unknown | null>
}

function rpcArguments(
  filters: PublicCatalogFilters,
  cursor: PublicCatalogCursorComponents | null,
) {
  return {
    target_beneficiary_types:
      filters.beneficiaryTypes.length === 0
        ? null
        : [...filters.beneficiaryTypes],
    target_gender: filters.gender,
    target_statuses:
      filters.statuses.length === 0 ? null : [...filters.statuses],
    target_min_age: filters.minimumAge,
    target_max_age: filters.maximumAge,
    target_search: filters.search,
    target_page_size: filters.limit,
    after_feature_bucket: cursor?.featureBucket ?? null,
    after_display_order: cursor?.displayOrder ?? null,
    after_created_at: cursor?.createdAt ?? null,
    after_id: cursor?.id ?? null,
  }
}

function repositoryError(
  stage: string,
  cause: SupabaseErrorLike | null = null,
): never {
  throw new PublicCatalogRepositoryError(stage, cause)
}

/**
 * The supplied client must hold the service role. These RPCs are executable
 * only by service_role and return allowlisted public JSON projections.
 */
export function createServiceRolePublicCatalogRepository(
  client: SupabaseClient,
): PublicCatalogRepository {
  return {
    async loadPrimaryPage(filters, cursor) {
      const { data, error } = await client.rpc(
        "read_primary_public_beneficiary_catalog_page",
        rpcArguments(filters, cursor),
      )
      if (error) repositoryError("primary_page", error)
      if (data === null) repositoryError("primary_page_null")
      return data
    },

    async loadAdvocatePage(canonicalHostname, filters, cursor) {
      const { data, error } = await client.rpc(
        "read_public_advocate_beneficiary_catalog_page",
        {
          target_hostname: canonicalHostname,
          ...rpcArguments(filters, cursor),
        },
      )
      if (error) repositoryError("advocate_page", error)
      return data
    },

    async loadPrimaryBeneficiaryByUsername(username) {
      const { data, error } = await client.rpc(
        "read_primary_public_beneficiary_by_username",
        { target_username: username },
      )
      if (error) repositoryError("primary_beneficiary_username", error)
      return data
    },

    async loadAdvocateBeneficiaryByUsername(canonicalHostname, username) {
      const { data, error } = await client.rpc(
        "read_public_advocate_beneficiary_by_username",
        {
          target_hostname: canonicalHostname,
          target_username: username,
        },
      )
      if (error) repositoryError("advocate_beneficiary_username", error)
      return data
    },

    async loadPrimaryBeneficiaryMediaById(beneficiaryId) {
      const { data, error } = await client.rpc(
        "read_primary_public_beneficiary_media_by_id",
        { target_beneficiary_id: beneficiaryId },
      )
      if (error) repositoryError("primary_beneficiary_media_id", error)
      return data
    },

    async loadAdvocateBeneficiaryMediaById(canonicalHostname, beneficiaryId) {
      const { data, error } = await client.rpc(
        "read_public_advocate_beneficiary_media_by_id",
        {
          target_hostname: canonicalHostname,
          target_beneficiary_id: beneficiaryId,
        },
      )
      if (error) repositoryError("advocate_beneficiary_media_id", error)
      return data
    },

    async loadPrimaryBeneficiaryActivitiesById(beneficiaryId) {
      const { data, error } = await client.rpc(
        "read_primary_public_beneficiary_activities_by_id",
        { target_beneficiary_id: beneficiaryId },
      )
      if (error) repositoryError("primary_beneficiary_activities_id", error)
      return data
    },

    async loadAdvocateBeneficiaryActivitiesById(
      canonicalHostname,
      beneficiaryId,
    ) {
      const { data, error } = await client.rpc(
        "read_public_advocate_beneficiary_activities_by_id",
        {
          target_hostname: canonicalHostname,
          target_beneficiary_id: beneficiaryId,
        },
      )
      if (error) repositoryError("advocate_beneficiary_activities_id", error)
      return data
    },
  }
}
