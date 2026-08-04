import { NextResponse } from "next/server"

import { ALL_STATUSES, type Status } from "@/config/beneficiaryStatuses"
import {
  parsePublicCatalogPage,
  parsePublicCatalogRequest,
  PublicCatalogRequestError,
} from "@/lib/advocates/publicCatalog"
import { createServiceRolePublicCatalogRepository } from "@/lib/advocates/publicCatalogRepository"
import { createServiceRolePublicAdvocatePresentationRepository } from "@/lib/advocates/publicPresentationRepository"
import { resolvePublicSiteRequest } from "@/lib/advocates/publicSiteRequest"
import type { Beneficiaries } from "@/types"
import { BENEFICIARY_TYPES, type BeneficiaryType } from "@/types/admin.types"
import { requireSuperAdmin } from "@/utils/auth/requireSuperAdmin"
import { createClient, createServiceRoleClient } from "@/utils/supabase/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Host",
  "X-Content-Type-Options": "nosniff",
} as const

const STATUS_SET = new Set<string>(ALL_STATUSES)
const BENEFICIARY_TYPE_SET = new Set<string>(BENEFICIARY_TYPES)
const SAFE_ADMIN_SEARCH_PATTERN = /^[\p{L}\p{N} .'-]{1,100}$/u

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  })
}

function parseAdminCommaList<T extends string>(
  raw: string | null,
  allowed: ReadonlySet<string>,
): T[] | null {
  if (raw === null || raw === "") return []
  const values = [...new Set(raw.split(",").map((value) => value.trim()))]
  return values.length > 0 &&
    values.every((value) => value.length > 0 && allowed.has(value))
    ? (values as T[])
    : null
}

function parseAdminPageNumber(raw: string | null): number | null {
  if (raw === null) return 0
  if (raw.length > 32 || !/^[A-Za-z0-9+/=_-]+$/.test(raw)) return null
  try {
    const value = Number(Buffer.from(raw, "base64").toString("utf8"))
    return Number.isSafeInteger(value) && value >= 0 ? value : null
  } catch {
    return null
  }
}

async function loadAdministratorCatalog(request: Request) {
  const client = await createClient()
  const auth = await requireSuperAdmin(client)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const types = parseAdminCommaList<BeneficiaryType>(
    searchParams.get("beneficiary_type"),
    BENEFICIARY_TYPE_SET,
  )
  const statuses = parseAdminCommaList<Status>(
    searchParams.get("status"),
    STATUS_SET,
  )
  const gender = searchParams.get("gender")
  const search = searchParams.get("search")?.trim() || null
  const limitRaw = searchParams.get("limit") ?? "9"
  const limit = /^\d{1,2}$/.test(limitRaw) ? Number(limitRaw) : Number.NaN
  const offset = parseAdminPageNumber(searchParams.get("cursor"))
  const ageRange = searchParams.get("ageRange")

  if (
    types === null ||
    statuses === null ||
    (gender !== null &&
      gender !== "" &&
      gender !== "Boy" &&
      gender !== "Girl") ||
    (search !== null && !SAFE_ADMIN_SEARCH_PATTERN.test(search)) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 60 ||
    offset === null
  ) {
    return json({ error: "Invalid request" }, 400)
  }

  let query = client.from("beneficiaries").select("*", { count: "exact" })
  if (types.length > 0) query = query.in("beneficiary_type", types)
  if (gender) query = query.eq("gender", gender)
  if (statuses.length > 0) {
    const statusList = statuses.map((status) => `"${status}"`).join(",")
    const shouldIncludeOpen = statuses.some(
      (status) => status !== "Budget Fulfilled",
    )
    query = shouldIncludeOpen
      ? query.or(
          `status.in.(${statusList}),and(budget_goal.eq.-1,status.not.in.(Draft,Archived))`,
        )
      : query.in("status", statuses)
  }
  if (search !== null) {
    query = query.or(`name.ilike.%${search}%,username.ilike.%${search}%`)
  }

  if (ageRange !== null && ageRange !== "") {
    if (!/^\d{1,3},\d{1,3}$/.test(ageRange)) {
      return json({ error: "Invalid request" }, 400)
    }
    const [rawFirst, rawSecond] = ageRange.split(",").map(Number)
    if (rawFirst > 130 || rawSecond > 130) {
      return json({ error: "Invalid request" }, 400)
    }
    const minimumAge = Math.min(rawFirst, rawSecond)
    const maximumAge = Math.max(rawFirst, rawSecond)
    const now = new Date()
    const yearsAgo = (years: number) =>
      new Date(now.getFullYear() - years, now.getMonth(), now.getDate())
    const minimumBirthDate = yearsAgo(maximumAge + 1).toISOString()
    const maximumBirthDate = yearsAgo(minimumAge).toISOString()
    query = query.or(
      `birth_date.is.null,and(birth_date.gte.${minimumBirthDate},birth_date.lte.${maximumBirthDate})`,
    )
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) return json({ error: "Catalog unavailable" }, 503)
  const people = (data || []) as Beneficiaries[]
  const nextOffset = offset + people.length
  const hasMore = count !== null ? nextOffset < count : people.length === limit

  return json({
    people,
    totalCount: count ?? null,
    pageInfo: {
      limit,
      nextCursor: hasMore
        ? Buffer.from(String(nextOffset), "utf8").toString("base64")
        : null,
      hasMore,
    },
  })
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID()

  try {
    const serviceClient = createServiceRoleClient()
    const presentationRepository =
      createServiceRolePublicAdvocatePresentationRepository(serviceClient)
    const siteResolution = await resolvePublicSiteRequest({
      rawHost: request.headers.get("host"),
      repository: presentationRepository,
      environment: process.env,
    })

    if (siteResolution.kind === "not-found") {
      return json({ error: "Catalog not found" }, 404)
    }
    if (siteResolution.kind === "operational-failure") {
      console.error("Public catalog site resolution failed", { requestId })
      return json({ error: "Catalog unavailable", requestId }, 503)
    }

    const url = new URL(request.url)
    if (url.searchParams.get("admin_mode") === "true") {
      if (siteResolution.site.kind !== "primary") {
        return json({ error: "Catalog not found" }, 404)
      }
      return loadAdministratorCatalog(request)
    }

    const hostname = siteResolution.site.canonicalHostname
    const catalogRequest = parsePublicCatalogRequest(url.searchParams, hostname)
    const repository = createServiceRolePublicCatalogRepository(serviceClient)
    const source =
      siteResolution.site.kind === "advocate"
        ? await repository.loadAdvocatePage(
            hostname,
            catalogRequest.filters,
            catalogRequest.cursor,
          )
        : await repository.loadPrimaryPage(
            catalogRequest.filters,
            catalogRequest.cursor,
          )
    const page = parsePublicCatalogPage(
      source,
      hostname,
      catalogRequest.filters,
    )
    if (page === null) return json({ error: "Catalog not found" }, 404)
    return json(page)
  } catch (error) {
    if (error instanceof PublicCatalogRequestError) {
      return json({ error: "Invalid request", field: error.field }, 400)
    }
    console.error("Public catalog request failed", {
      requestId,
      errorName: error instanceof Error ? error.name : "UnknownCatalogError",
    })
    return json({ error: "Catalog unavailable", requestId }, 503)
  }
}
