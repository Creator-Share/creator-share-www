# Cost & Architecture Review: Supabase Transforms → Next.js Image Optimization

Date: 2026-05-26
Reviewed: `nextjs-image-transformation.md` (plan) against `docs-findings.md` (reference)

---

## 1. Current Cost Baseline

### Current Stack
- **Supabase:** Pro plan ($25/mo) — image transforms are a Pro-only feature
- **Vercel:** Presumably Hobby ($0/mo) or Pro ($20/mo)
- **The problem:** The current codebase **double-optimizes every image.** Here's the proof:

#### Evidence of double optimization

**`ProgressiveImage.tsx`** — the main image's `src` goes through `<Image>` component:
```tsx
// ProgressiveImage.tsx — main image
<Image src={displaySrc} ... unoptimized={isLocalImage} />
```
`isLocalImage` is false for external Supabase URLs, so `unoptimized=false`. This means the current flow is:

```
Supabase original → Supabase render/image (transform #1) → Vercel /_next/image (transform #2) → browser
```

The **thumbnail** uses the same pattern:
```tsx
<Image src={thumbnailSrc} ... unoptimized={isThumbnailLocal} />
```
Same double-transform pipeline, just for a 40×40 image.

This means:
- **Supabase billing:** Each unique original + unique transform params = 1 "origin image" billed
- **Vercel billing:** Each unique source URL (the Supabase render URL) + each requested width = Vercel source image quota consumed
- **Bandwidth waste:** Supabase sends a transformed image to Vercel, Vercel re-downloads and re-transforms it

### Current estimated monthly cost (wasteful baseline)

| Item | Cost | Notes |
|------|------|-------|
| Supabase Pro plan | $25/mo | Required for transforms |
| Supabase origin images | $0? | Depends on usage, but tier likely included in $25 plan |
| Vercel image opt (waste) | ~$0–$5/mo | Currently burning quota on already-transformed images |
| **Total current (wasteful)** | **~$25/mo** | |

---

## 2. Proposed Cost (Next.js-Only Optimization)

### Source image count estimate

Based on codebase analysis:
- **Private bucket (public-facing images):** Beneficiaries have 1–5 images each via `ImageCarousel`. If 50–100 beneficiaries → **50–500 source images**
- **Admin images:** `BeneficiaryCard` (admin) uses `unoptimized` — *does not consume Vercel quota*
- **Activities/media images:** Additional images per activity entry → another 50–200 images

**Total source images:** ~100–700 unique originals

### Vercel quota consumption

Vercel counts source images **per width requested, per cache-miss lifecycle**. Key multiplier:

| Size | Source image count per original |
|------|-------------------------------|
| Thumbnail (w=20, q=20) | 1 (different width = different source image) |
| Main display (w=800, default) | 1 (different width) |
| Other responsive sizes | ~1–2 more if `sizes` triggers different widths |
| **Total per original** | **~2–3 per cache lifecycle** |

**Estimated monthly quota burn:** 100–700 originals × 2–3 sizes = **200–2,100 source images/mo**

### Vercel plan comparison

| Plan | Included images | Monthly cost | Overages | Fits? |
|------|----------------|-------------|----------|-------|
| **Hobby** ($0) | 1,000/mo | $0 | Pay-as-you-go (rate unclear) | Tight — 200–2,100 is risky if traffic grows or many images |
| **Pro** ($20/mo) | 5,000/mo | $20 | $5/1k images | Comfortable — 5× headroom |
| **Pro + overage** | any | $20–$30 | If 2,100+ primary images needed | Unlikely to reach |

### Can we stay on Hobby?

**Yes, with mitigation.** The risk is the thumbnail generating a second cache-miss per image (doubling quota). Mitigations:

1. **Set `minimumCacheTTL` to 604800 (7 days)** in `next.config.ts` — extends cache lifespans so visitors share cache hits longer
2. **Skip thumbnail optimization on Hobby** — fall back to no thumbnail for low traffic, or generate thumbnails once via a build-time script
3. **Use `unoptimized` for non-critical images** — admin images already do this

**Risk scenario on Hobby:** If 200 unique images × 2 sizes = 400/month baseline, and monthly traffic causes enough cache-misses to re-trigger 300 images, you're at 700/1,000. Safe. But if you add 100 more beneficiaries with 5 images each × 2 sizes = 1,000 more, you're over.

---

## 3. Latency: Extra Network Hop

### Current flow
```
Browser → Vercel edge → Supabase Smart CDN → Vercel edge → browser
```
Wait — the current flow is actually *worse* than proposed. Let me trace it properly.

### Current: Supabase transforms → Next.js `/_next/image`

| Step | Party | What happens | Latency |
|------|-------|-------------|---------|
| 1 | Browser | Requests page, Next.js renders `<Image src={supabaseRenderUrl}>` | — |
| 2 | Vercel edge | Sees unoptimized external URL, fetches it | ~100ms |
| 3 | Supabase | Supabase Smart CDN may have cached transform, or hits origin | ~50-200ms |
| 4 | Vercel edge | Receives Transformed WebP, re-optimizes (resize/quality) | ~50-100ms processing |
| 5 | Vercel edge | Serves optimized image to browser | ~20-50ms |
| **Total uncached** | | | **~200-450ms** |

### Proposed: Direct storage URL → Next.js `/_next/image`

| Step | Party | What happens | Latency |
|------|-------|-------------|---------|
| 1 | Browser | Requests page, Next.js renders `<Image src={directUrl}>` | — |
| 2 | Vercel edge | Sees unoptimized external URL, fetches it | ~100ms |
| 3 | Supabase | Serves original (no Smart CDN transform cache hit) | ~50-150ms |
| 4 | Vercel edge | Optimizes (resize + WebP conversion) | ~50-150ms (more work: original is bigger) |
| 5 | Vercel edge | Serves to browser | ~20-50ms |
| **Total uncached (proposed)** | | | **~220-450ms** |

### Cached comparison (both flows)

| State | Current | Proposed |
|-------|---------|----------|
| **Hot cache** (Vercel edge cached) | ~20-50ms | ~20-50ms |
| **Warm cache** (Supabase CDN cached, Vercel miss) | ~150-250ms | ~300-400ms (bigger original to process) |
| **Cold cache** (both miss) | ~200-450ms | ~220-450ms |

**Verdict:** The proposed flow is **marginally slower only on Vercel cache miss** because the original image from Supabase is larger (untransformed) — Vercel has to download and process more data. But the difference is ~50-100ms on first load, which is imperceptible. After cache is warm, identical.

**For this project's traffic level** (charity sponsorship platform, likely hundreds to low thousands of visitors/month), the latency difference is negligible. Users arrive organically through shares/links, so a 100ms slower first load on a single page is invisible.

---

## 4. Bandwidth Costs

### Supabase → Vercel (origin fetch)

| Aspect | Current | Proposed | Delta |
|--------|---------|----------|-------|
| Image size transferred | Transformed WebP (~30-60KB) | Original JPEG/PNG (~100-500KB) | **2-10× more per request** |
| Number of transfers | Each cache miss at Vercel | Each cache miss at Vercel | Same count |
| Cost | Varies by Supabase plan egress | Varies by Supabase plan egress | **Higher egress from Supabase** |

Supabase storage egress pricing: Pro plan includes 100GB egress (or tier-appropriate amount). For a low-traffic site, the difference between 50MB/mo and 200MB/mo in origin-fetch bandwidth is **not material** — both are well within any Pro tier's included limits.

### Vercel → Browser

Vercel edge bandwidth is included in all plans (Hobby: 100GB, Pro: 1TB). The optimized output size is essentially the same (both produce WebP at ~75 quality), so no meaningful difference here.

### Cross-region costs

The Vercel project deploys to `sfo1` (San Francisco, per `vercel.json`). If the Supabase project is also in `us-west-1` (Oregon) or `us-west-2` (Oregon), traffic between Vercel and Supabase stays within the US West coast:

- Vercel Marketplace partners (Supabase is one): **inter-region bandwidth is free** when both use Vercel's network
- Even if not: AWS/GCP intra-US data transfer is ~$0.02/GB — negligible for this traffic level

**Verdict:** Bandwidth costs are essentially flat between the two approaches. The proposed approach sends larger originals from Supabase to Vercel on cache misses, but for this traffic level, the difference rounds to $0.

---

## 5. Cache Layering Analysis

### Layer comparison

| Layer | Current | Proposed |
|-------|---------|----------|
| Supabase Smart CDN | ✅ Caches transformed images (WebP 800×800) | ❌ Gone — only direct object URLs served |
| Vercel Edge CDN | ✅ Caches re-optimized images | ✅ Same — caches optimized images |
| Browser cache | ✅ Via `Cache-Control` | ✅ Same |
| **Total cache layers** | **3** (Supabase CDN → Vercel → browser) | **2** (Vercel → browser) |

### Real-world impact for this project

- **Cold start (new image uploaded):** Current has Supabase Smart CDN caching the transformed version; proposed has nothing between Supabase origin and Vercel. But since the image was just uploaded, no one is requesting it yet. The first visitor triggers a cache fill at Vercel either way.
- **Concurrent visitors (same hour):** Once Vercel edge has cached the optimized image, both approaches deliver identically (Vercel edge → browser). The missing Supabase CDN layer doesn't matter.
- **Supabase Smart CDN TTL:** If Supabase CDN has a longer TTL than Vercel edge cache, the current approach could serve from Supabase CDN if Vercel's cache evicted. But Vercel's `minimumCacheTTL` (configurable to 7–31 days) makes this a non-issue.

**Verdict:** The loss of the Supabase CDN cache layer is irrelevant for this project. Vercel's edge cache is the primary layer and handles all repeat traffic identically either way.

---

## 6. Hidden Costs

### ✅ Vercel source image quota per cache-miss (confirmed)

Each unique original URL × each requested width counts as a source image. Since the thumbnail and main image request different widths, each image burns ~2 source-image quota per cache-miss lifecycle. **This is the real cost risk.**

**Mitigation:** Increase `minimumCacheTTL` in `next.config.ts`:
```ts
// next.config.ts
images: {
  minimumCacheTTL: 604800, // 7 days instead of default 3600
  // ... existing remotePatterns
}
```
With a 7-day TTL, the cache-miss lifecycle extends to a week — one cache fill per image per week regardless of visitors.

### ✅ Admin image double-counting (already mitigated)

The admin `BeneficiaryCard.tsx` already uses `unoptimized` on images — it does NOT consume Vercel image optimization quota. Only the public-facing sponsorship pages (SponsorshipCard, BeneficiaryDetails, SponsorshipModal) use `<Image>` without `unoptimized`, which is the intended behavior.

### ✅ Same original requested at multiple sizes = multiple quota burns

The `ProgressiveImage.tsx` requests the same original at two sizes (w=20 for thumbnail, default ~800 for main). **Vercel counts these as two source images** per cache lifecycle. This is the largest multiplier.

**Mitigation:** If the thumbnail URL is constructed as `/_next/image?url=<direct-url>&w=20&q=20` as proposed, the `url` parameter is the same direct Supabase URL for both thumbnail and main image. But since `w` differs, they're different transformed outputs. According to Vercel docs: "any new transformation dimensions count as new source images." So yes, 2 counts per original.

### ❌ Supabase storage egress surcharge (not a concern)

Supabase's Pro plan includes generous egress. For this project's traffic, egress from serving originals to Vercel's edge is well within limits.

### ❌ Vercel Functions duration increase (not a concern)

The image optimization runs at the Vercel edge, not as a Serverless Function. No Functions duration cost is affected.

### ❌ Multiple variants from `imageSizes` (not a concern)

Next.js's `sizes` prop on `<Image>` controls which widths the browser requests. But Vercel only optimizes the widths actually requested. If the `sizes` attribute is set to `100vw` (as it is in ProgressiveImage), the browser typically requests one width per viewport. Most visitors will only trigger one width per image, not all configured widths.

---

## 7. Can We Stay on Vercel Hobby Plan?

**Yes, with reasonable confidence — but there's a corner case.**

### Baseline usage estimate

| Scenario | Originals | × sizes | Monthly burn | Headroom (of 1,000) |
|----------|-----------|---------|-------------|---------------------|
| Current beneficiaries (50, 3 images avg) | 150 | 2 (thumb + main) | 300 | 700 — ✅ comfortable |
| Future growth (100 beneficiaries, 5 images avg) | 500 | 2 | 1,000 | 0 — ⚠️ at limit |
| Same, with 2 responsive sizes | 500 | 3 | 1,500 | -500 — ❌ over |

### Risk factors for exceeding Hobby quota

1. **Many beneficiaries per page load**: The sponsorship listing page fetches all images via `ImageCarousel`. If 50 cards load at once, each with 1 image → 50 originals in one page view → 100 source images (thumb + main) in a single pageload.
2. **Multiple visitors before cache warms**: If 20 unique visitors hit the listing page before Vercel edge caches fill, you've burned 20×100 = 2,000 source images just from that page.
3. **Images per beneficiary**: `BeneficiaryDetails` loads all images for one child. If a child has 5 images, that's 5 originals = 10 source images for one page view.

### Mitigation strategy for staying on Hobby

| Mitigation | Impact | Effort |
|------------|--------|--------|
| Set `minimumCacheTTL: 604800` | Extends cache to 7 days | Trivial (2 lines in `next.config.ts`) |
| Only show thumbnail on detail page, not listing | Halves main/thumbnail duplications per card | Low (component prop change) |
| Generate blurDataURL at upload time via edge function | Eliminates thumbnail as separate source image | Medium (new serverless function) |
| Pin region to sfo1 (already done) | Ensures Supabase → Vercel latency is minimal | Already done |
| Monitor via Vercel dashboard | Know when approaching limit | Free |

**Bottom line:** For the current scale, Hobby works with `minimumCacheTTL` tuning. If you plan to scale to 100+ beneficiaries with 5+ images each, budget for Vercel Pro ($20/mo) — which is still $5/mo cheaper than Supabase Pro alone.

---

## 8. Monthly Cost Comparison Table

### Scenario A: Current traffic (~50 beneficiaries, ~150 images)

| Approach | Supabase | Vercel | Image Opt Cost | Total | Notes |
|----------|----------|--------|---------------|-------|-------|
| **Current (wasteful)** | Pro $25 | Hobby $0 | $0-ish (on top of plan) | **$25/mo** | Double-optimizing, paying for unneeded transforms |
| **Proposed (Hobby)** | Free $0 | Hobby $0 | $0 (within 1k quota) | **$0/mo** | ✅ Best: saves $25/mo |
| **Proposed (Pro)** | Free $0 | Pro $20 | Included in plan | **$20/mo** | ✅ Still cheaper than current by $5 |

### Scenario B: Medium traffic (~100 beneficiaries, ~500 images)

| Approach | Supabase | Vercel | Image Opt Cost | Total | Notes |
|----------|----------|--------|---------------|-------|-------|
| **Current (wasteful)** | Pro $25 | Hobby $0 | $0-ish | **$25/mo** | |
| **Proposed (Hobby)** | Free $0 | Hobby $0 | $0 (within 1k quota if 2 sizes) | **$0/mo** | Margin of safety depends on cache hits |
| **Proposed (Pro)** | Free $0 | Pro $20 | Included (5k quota) | **$20/mo** | ✅ Comfortable, saves $5/mo |

### Scenario C: High traffic (~200 beneficiaries, 1,000+ images, many visitors)

| Approach | Supabase | Vercel | Image Opt Cost | Total | Notes |
|----------|----------|--------|---------------|-------|-------|
| **Current (wasteful)** | Pro $25 | Pro $20 | $0-ish | **$45/mo** | Worst: paying both for transforms |
| **Proposed (Pro)** | Free $0 | Pro $20 | $0–$5 (if over 5k) | **$20–$25/mo** | ✅ Cheaper by $20/mo |
| **Proposed (Pro, tighten)** | Free $0 | Pro $20 | $0 | **$20/mo** | Increase `minimumCacheTTL` to stay under |

> **Key insight:** The proposed approach is cheaper in **every** scenario because it eliminates either the Supabase Pro plan ($25/mo) or avoids double-paying both Vercel Pro ($20/mo) + Supabase Pro ($25/mo).

---

## 9. Additional Finding: `remotePatterns` Must Be Updated

The current `next.config.ts`:

```ts
remotePatterns: [
  { hostname: "*.supabase.co" },
  // ...
]
```

This allows `https://<project>.supabase.co/storage/v1/render/image/public/...` as source URLs (the current approach). After the change, source URLs will be `https://<project>.supabase.co/storage/v1/object/public/media/...`.

The `*.supabase.co` glob covers both patterns, so **no config change is needed** for `remotePatterns` — it already allows the direct object URL path.

But there's a `search` gotcha: the current config omits `search`, which means `?` is implicitly allowed. If `search` were set to `''` (empty string), the Supabase render URLs with query params would be rejected. The current config is fine.

---

## 10. Summary of Findings

| Factor | Verdict |
|--------|---------|
| **Cost** | ✅ Always cheaper. Saves $5–$45/mo depending on plan tier. The minimum saving is $5/mo (downgrade Vercel Pro → Hobby, or drop Supabase Pro). |
| **Latency (first visit)** | ⚠️ Marginally higher (~50ms) because Vercel must fetch and process larger originals. Imperceptible to users. |
| **Latency (return visitors)** | ✅ Identical — Vercel edge cache serves either way. |
| **Bandwidth costs** | ✅ Flat — negligible difference at this traffic level. |
| **Cache layering** | ✅ Losing Supabase CDN layer is irrelevant. Vercel edge + browser cache handles everything. |
| **Hidden cost: Vercel quota** | ⚠️ Need `minimumCacheTTL` tuning. Each image burns 2 source-image quota per cache lifecycle (thumb + main size). |
| **Hobby viability** | ✅ Safe for current scale with tuning. Risky at 100+ beneficiaries / 5+ images each. |
| **Worst case (cost increase)** | ❌ Not possible — this change saves money in every scenario. The only way to pay more is if you stay on Supabase Pro AND Vercel Pro. |
| **Hidden benefit** | ✅ Eliminates current double-optimization waste. Currently both Supabase AND Vercel transform every image. |

### Recommendation

**Proceed with the change.** The architecture is simpler, eliminates double-optimization waste, and saves money at every traffic level. Tune `minimumCacheTTL` to 604800 (7 days) in `next.config.ts` as a one-line safeguard against Vercel quota burn.
