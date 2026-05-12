# Admin dashboard — beneficiary_type follow-ups

Three pre-existing hardcoded touchpoints in the admin codebase that silently misbehave for any non-`CHILD` beneficiary type. Surfaced while reviewing PR #102 (adding `IN_OUR_CARE`); these are orthogonal to that PR's scope and should be addressed separately.

For context: the rest of the admin surface is config-driven and auto-supports new types added to `ALL_BENEFICIARY_TABS` in `src/config/beneficiaryTypes.ts`. These three are the exceptions.

---

## 1. `BeneficiaryModal` activities tab — hardcoded type filter

**File:** `src/app/(admin)/admin/beneficiaries/components/BeneficiaryModal.tsx:1367`

**Problem:** `<ActivitiesTable beneficiaryType="CHILD" ... />` passes a hardcoded literal instead of the actual beneficiary's type. Activities for the open beneficiary record will be filtered as if every record were a `CHILD` — meaning activity history for `SPECIAL_NEEDS`, `ANIMAL`, `IN_OUR_CARE`, and any future type will not display correctly.

**Severity:** High — silent data-display bug. Has likely been broken since `SPECIAL_NEEDS` shipped (migration `20260413145212`).

**Recommended fix:** pass the actual type from the loaded beneficiary record.

```tsx
<ActivitiesTable
  beneficiaryType={selectedChild?.beneficiary_type ?? "CHILD_LABORER"}
  // ...
/>
```

The fallback should be the most likely default for new records (`CHILD_LABORER` post-migration), not the legacy `CHILD` alias. If the prop is genuinely optional in `ActivitiesTable`, prefer making it `undefined` and letting the table show all activities for the beneficiary.

**Suggested verification:** open the modal for one record of each type (`CHILD_LABORER`, `SPECIAL_NEEDS`, `IN_OUR_CARE`, `ANIMAL`) post-fix and confirm the activities tab populates with that beneficiary's actual activities.

---

## 2. Telegram notification on beneficiary create — hardcoded type gate (two instances)

**Files:**
- `src/app/api/admin/beneficiaries/create/route.ts:76` — server-side notification call.
- `src/store/beneficiaryStore.ts:126` — client-side fetch to `/api/admin/beneficiaries/notify`.

**Problem:** both call sites only fire the Telegram new-beneficiary notification when `type === "CHILD"`. Beneficiaries of any other type — `CHILD_LABORER`, `SPECIAL_NEEDS`, `ANIMAL`, `IN_OUR_CARE` — are created without notifying the team channel. The two layers are redundant (the store's POST to `/notify` and the create route's direct call) and both are gated on the same hardcoded literal.

**Severity:** Medium — operationally invisible failure. Could be intentional (the team only wants notifications for one type) or a stale gate that was never updated when new types shipped. The redundancy across two layers also deserves attention — if both gates are intended, decide which one is authoritative; if only one is, remove the other.

**Recommended fix:** decide intent first.

- **If the intent is "notify on every new beneficiary":** drop both type checks entirely.
- **If the intent is "notify only for the primary fundraising type":** replace the literals with a config-driven flag. Add an optional `notifyOnCreate?: boolean` field to `BeneficiaryTypeConfig` in `src/config/beneficiaryTypes.ts`, set it on the relevant tabs, and gate both notification call sites on `findConfig(type)?.notifyOnCreate`.

Either way, both literal `=== "CHILD"` checks should be removed so future types don't inherit silent non-notification, and the dual-layer redundancy resolved.

---

## 3. Hardcoded age-range ternary on filter reset

**File:** `src/app/(admin)/admin/beneficiaries/page.tsx:401`

**Problem:** the filter-reset path uses `activeType === "ANIMAL" ? 20 : 14` to choose the max age, instead of the existing config-driven helper `getMaxAgeYears(activeType)` from `src/config/beneficiaryTypes.ts`.

**Severity:** Low — for the current set of types the ternary happens to produce the same value as `getMaxAgeYears()`, so there's no live bug. The risk is that any future type whose `maxAgeYears` is neither 14 nor 20 will silently get clamped to 14 here.

**Recommended fix:** replace the ternary with the helper.

```tsx
// Before
maxAge: activeType === "ANIMAL" ? 20 : 14,

// After
maxAge: getMaxAgeYears(activeType),
```

Drop-in replacement, no behavior change for current types, future-proof.

---

## Why these aren't in PR #102

PR #102 introduces `IN_OUR_CARE`. These three issues predate that PR and would affect any new (or existing) non-`CHILD` type equally — fixing them belongs in a follow-up. Bundling unrelated fixes into #102 would muddy its review surface and conflate "add a type" with "audit admin type handling."

The audit confirmed that the rest of the admin surface (type dropdown, bulk-update validation, sponsorship filters, budget-goal field rendering, beneficiary card display) is fully config-driven via `ALL_BENEFICIARY_TABS` and `isOpenSponsorshipType()`. After fixing the three above, adding a new beneficiary type genuinely becomes a one-config-entry change with no admin code to touch.
