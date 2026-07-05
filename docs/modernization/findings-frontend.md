# Frontend Findings (React / Next.js / performance / UX)

250 TS/TSX files, 81 with `"use client"`. Two architectural issues dominate: **TanStack Query is installed and mounted but never used** (109 manual `fetch` calls in `useEffect` reinvent it), and **every content page is a client component behind URL rewrites**, so the public donation site has effectively no SSR or SEO.

---

## 1. Server/client components, routing, SEO

**HIGH — No SSR content or metadata on shareable pages.** Every content page is `"use client"` (23 of 25 `page.tsx`). The root and per-beneficiary profile pages ([`sponsorships/[username]/page.tsx`](../../src/app/sponsorships/[username]/page.tsx)) ship no server-rendered HTML and have no `generateMetadata` — only `layout.tsx` sets a static `"Creator Share"` title. Shared beneficiary links produce identical, contentless OG/meta for every child (no name, photo, description) in link previews and to crawlers. For a donation site whose growth loop *is* shareable links, this directly suppresses reach. **Fix:** convert `[username]/page.tsx` to a server component with `generateMetadata` (title/description/`og:image` from the beneficiary), render the profile server-side, hydrate interactivity.

**HIGH — Rewrite-everything-to-`/` + read-`window.location` anti-pattern.** [`next.config.ts:24-38`](../../next.config.ts) rewrites `/child_laborers`, `/dogs`, `/about`, `/faq`, `/login`, `/contact`, etc. all to `/`; [`SponsorshipsContainer/index.tsx:187`](../../src/app/sponsorships/components/SponsorshipsContainer/index.tsx) reads `window.location.pathname` on mount and applies the type filter *after* hydration → a guaranteed flash (default state renders, then re-renders to the correct filter). None of these routes have distinct metadata or are independently indexable. **Fix:** use real route segments (`/dogs/page.tsx`) or a dynamic `[type]` segment; pass the type as a server prop.

**MEDIUM — Modal deep-linking re-implements the router.** `SponsorshipsContainer` uses ~110 lines of manual `history.pushState`/`replaceState` + a `urlSyncGeneration` counter + `popstate` listener. **Fix:** Next.js intercepting/parallel routes, or `router` navigation.

---

## 2. Rendering performance

**HIGH — N+1 image fetch on the listing.** [`SponsorshipCard/index.tsx:33-58`](../../src/app/sponsorships/components/SponsorshipCard/index.tsx) fetches its own images via `fetch('/api/beneficiaries/images/{id}')` in `useEffect` on mount. With 9 cards/page and infinite scroll, that's one request per card, unbounded. The card is also **not memoized**, so any parent state change re-renders (and can re-fetch) every card. This `/api/beneficiaries/images/` pattern is duplicated across **9 files**. **Fix:** return image URLs with each beneficiary in the list payload (batch); wrap the card in `React.memo`. Highest runtime win in the app.

**HIGH — 636-line dead map component pulling heavy libs.** [`SponsorshipMap/index.tsx`](../../src/app/sponsorships/components/SponsorshipMap/index.tsx) imports `react-leaflet` + `leaflet` eagerly at module top but is imported **nowhere**. **Fix:** delete it (and the unused map deps), or if kept, load via `next/dynamic({ ssr:false })`.

**MEDIUM — `React.memo` used exactly once** across 250 files (`embed/page.tsx`). List/grid children receive inline arrow callbacks (e.g. `onOpenDialog={() => handleCardClick(b)}`) that would defeat memoization anyway. **Fix:** memoize row/card components; pass stable handlers (pass the id, look up in parent).

**MEDIUM — Monolithic client modals.** `ActivityModals.tsx` (1721), `SponsorshipModal/index.tsx` (1584), `BeneficiaryModal.tsx` (1460) are large `"use client"` components with duplicated create/edit branches and unmemoized preview/list rows. (Good: `SponsorshipModal` dynamically imports PayPal; the admin page dynamically imports `BeneficiaryModal`.) **Fix:** split into subcomponents; memoize rows.

**LOW — Infinite scroll uses a global `scroll` listener** + `getBoundingClientRect` + rAF + 500ms throttle rather than `IntersectionObserver` ([`SponsorshipListings/index.tsx:100`](../../src/app/sponsorships/components/SponsorshipListings/index.tsx)). Works, but re-attaches on `onLoadMore` identity change. **Fix:** `IntersectionObserver` on a sentinel.

---

## 3. Data fetching

**HIGH — React Query mounted but never used.** [`Providers.tsx:5-14`](../../src/app/Providers.tsx) mounts the provider; there are **zero** `useQuery`/`useInfiniteQuery`/`useMutation` calls. Instead the app hand-rolls Fibonacci retry backoff (`useBeneficiaryPagination.ts:89-100`), manual dedup (`:175-187`), `AbortController` juggling, and Zustand caching — shipping the RQ bundle for no benefit while reinventing its core features imperfectly. **Fix:** adopt RQ (`useInfiniteQuery` for the listing, `useQuery`/`useMutation`+`invalidateQueries` for admin CRUD) — or remove the dependency. This single decision resolves most of §2–§4.

**HIGH — Errors swallowed with no user feedback.** `SponsorshipsContainer` fetches (`:157`, `:240`, `:328`) only `console.warn`/`console.error`; the deep-link fetch silently closes the modal. **Fix:** surface error/empty states.

**HIGH — Store fetches have no `AbortController` and refetch-everything on mutation.** [`store/beneficiaryStore.ts:31-41`](../../src/store/beneficiaryStore.ts), `userManagementStore.ts:15-27` — rapid calls race; every mutation triggers a full refetch (waterfall, no optimistic update). **Fix:** RQ mutations with cache invalidation, or add abort + optimistic updates.

**MEDIUM — Stale-closure risk** in `useBeneficiaryPagination.ts:257` (`[filters]` dep with `exhaustive-deps` disabled). Encapsulating in `useInfiniteQuery` removes the class of issue.

**LOW — Client-side `shuffle()` on each fetch** combined with cursor pagination causes ordering churn/duplicates (there's already a dedup guard that logs warnings — a symptom). **Fix:** order server-side deterministically.

---

## 4. State management (Zustand)

**HIGH — Server data stored in Zustand.** [`beneficiaryStore.ts`](../../src/store/beneficiaryStore.ts) and `userManagementStore.ts` hold `data: Beneficiaries[]` / `users: []` mixed with UI selection state — the classic server-state-in-client-store anti-pattern, guaranteeing staleness and forcing manual invalidation. **Fix:** server data → React Query; keep only UI state in Zustand.

**MEDIUM — Auth listener at module load.** [`authStore.ts:5-10`](../../src/store/authStore.ts) runs `createClient()` + `onAuthStateChange` at store-creation time, never cleaned up, can fire during SSR. **Fix:** move into an effect in a top-level client provider with cleanup.

**MEDIUM — Duplicated filter state.** `filterStore` and `useBeneficiaryPagination`'s own `filters` object both hold gender/age/status, synced manually; filters aren't URL-synced so they're lost on refresh/share. **Fix:** single source of truth; encode filters in `searchParams`.

**MEDIUM — Inconsistent invalidation:** `beneficiaryStore.updateBeneficiary` mutates local state but doesn't refetch, unlike its siblings. **Fix:** consistent strategy.

---

## 5. Accessibility & usability

- **MEDIUM — Admin modals lack focus trap/restore.** `ActivityModals.tsx:462` is a hand-rolled fixed-div modal that toggles `body.overflow` but doesn't trap focus or restore it on close. **Fix:** use the Chakra dialog primitive consistently.
- **MEDIUM — Labels not associated.** `ActivityModals`/`ExpenseManager` render styled `<label>` without `htmlFor`/`id`; many inputs are placeholder-only. **Fix:** standardize on the `Field` wrapper.
- **LOW — Carousel dots are non-focusable `<Box>` with `onClick`** ([`ImageCarousel.tsx:123`](../../src/components/ImageCarousel.tsx)). **Fix:** make them `<button>` with `aria-label`.
- **LOW — Spinners over skeletons.** 44 `Spinner` refs; a `SponsorshipCard/Skeleton.tsx` exists but is imported nowhere. **Fix:** wire up the skeleton to reduce layout shift.
- **LOW — Generic alt text** in admin modal previews (`Preview ${i}`). **Fix:** include the beneficiary name.

---

## 6. Forms

**HIGH — `react-hook-form` installed but bypassed in the big admin forms.** `ActivityModals`, `BeneficiaryModal`, `ExpenseManager` use raw `useState` + ad-hoc validation scattered through submit handlers (`ExpenseManager.tsx:84-96,165-173` duplicates budget validation), errors shown as one bottom banner. **Fix:** adopt RHF + zod consistently; render inline field errors.

**MEDIUM — Dual form-state pattern** in `BeneficiaryModal.tsx:76` (create uses parent store, edit uses local state, branching on which to read). **Fix:** single form-state source via RHF context.

---

## 7. Duplication

- **MEDIUM — 9 files** independently fetch `/api/beneficiaries/images/{id}`. **Fix:** one `useBeneficiaryImages(id)` hook (RQ-backed) or include images in the list payload.
- **MEDIUM — Create-vs-edit upload blocks** in `BeneficiaryModal.tsx:1020-1109` vs `1111-1200` (and video `1208` vs `1263`) are ~99% identical. **Fix:** extract `<ImageUploadField>` / `<VideoUploadField>`.
- **MEDIUM — 3 near-parallel fetch-with-loading patterns** (`ActivityModals`, `BeneficiaryModal`, `ExpenseManager`) each reimplement `setLoading`/try-catch/`console.error`. **Fix:** shared async-fetch hook (or RQ).
- **LOW — 4 distinct card components** with overlapping logic. **Fix:** consolidate around a shared base card.

---

## 8. Image handling (mostly good)

- **Good:** `ProgressiveImage.tsx` is a solid `next/image` wrapper (lazy, `priority`, fade-in, correct `unoptimized` bypass for blob/data/svg); 18 files use `next/image`, only 2 raw `<img>` (both in the dead map). Compression centralized in `utils/imageCompression.ts`.
- **MEDIUM — Compression runs on the main thread at submit** (5×3–5MB can freeze the modal). **Fix:** web worker; lazy-load modal previews.

---

## Top frontend priorities
1. Decide on React Query (adopt or remove) — resolves §3, §4, and the §2 N+1 at once.
2. Fix the `SponsorshipCard` N+1 (batch images into the list payload) + memoize.
3. Server-render beneficiary profiles with `generateMetadata` (the SEO/OG gap).
4. Delete dead code (`SponsorshipMap`, unused `Skeleton`, unused map deps).
5. Replace the rewrite-to-`/` routing with real segments.
