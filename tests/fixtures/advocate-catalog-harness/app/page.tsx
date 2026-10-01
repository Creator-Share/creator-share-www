import Link from "next/link"

import { CatalogSettingsClient } from "@/components/advocates/admin/CatalogSettingsClient"

import { HarnessHydrated } from "./HarnessHydrated"

const ALPHA_ID = "11111111-1111-4111-8111-111111111111"
const BETA_ID = "22222222-2222-4222-8222-222222222222"
const FORMER_ID = "33333333-3333-4333-8333-333333333333"
const GAMMA_ID = "44444444-4444-4444-8444-444444444444"
const OPAQUE_ID = "55555555-5555-4555-8555-555555555555"

const SETTINGS = Object.freeze({
  advocateId: "77777777-7777-4777-8777-777777777777",
  actorUserId: "66666666-6666-4666-8666-666666666666",
  slug: "catalog-harness",
  displayName: "Catalog Harness",
  advocateVersion: 7,
  mode: "selected" as const,
  selections: Object.freeze([
    Object.freeze({ beneficiaryId: ALPHA_ID, isFeatured: false }),
    Object.freeze({ beneficiaryId: OPAQUE_ID, isFeatured: false }),
    Object.freeze({ beneficiaryId: FORMER_ID, isFeatured: false }),
    Object.freeze({ beneficiaryId: BETA_ID, isFeatured: true }),
  ]),
  beneficiaries: Object.freeze([
    Object.freeze({
      id: ALPHA_ID,
      name: "Alpha Child",
      username: "alpha-child",
      status: "New",
      eligible: true,
      blockedReason: null,
    }),
    Object.freeze({
      id: BETA_ID,
      name: "Beta Child",
      username: "beta-child",
      status: "Partially Funded",
      eligible: true,
      blockedReason: null,
    }),
    Object.freeze({
      id: FORMER_ID,
      name: null,
      username: null,
      status: null,
      eligible: false,
      blockedReason: "unavailable" as const,
    }),
    Object.freeze({
      id: GAMMA_ID,
      name: "Gamma Child",
      username: "gamma-child",
      status: "New",
      eligible: true,
      blockedReason: null,
    }),
    Object.freeze({
      id: OPAQUE_ID,
      name: null,
      username: null,
      status: null,
      eligible: false,
      blockedReason: "unavailable" as const,
    }),
  ]),
  selectionLimit: 5,
})

export default function AdvocateCatalogHarness() {
  return (
    <main>
      <HarnessHydrated />
      <nav aria-label="Portal navigation">
        <Link href="/other">Analytics</Link>
        <a href="#catalog-settings-title">Catalog heading</a>
        <a href="/other" target="catalog-preview">
          Open analytics preview
        </a>
        <a href="https://example.com/help">External help</a>
      </nav>
      <CatalogSettingsClient settings={SETTINGS} />
    </main>
  )
}
