# Tooling / Build / Deps / Tests / CI / Docs Findings

The app has no CI quality gate, no typecheck script, near-zero test coverage, two competing lockfiles, and several dead or phantom dependencies. None of this is user-facing today, but together it means "broken types/lint/tests reach production" is the default, not the exception.

---

## 1. Dependency hygiene

**HIGH — Two lockfiles, actively drifting.** `packageManager` is pinned to `yarn@1.22.22` (so `yarn.lock` is truth), but a stale `package-lock.json` is also committed and the README offers `npm install`. They have diverged ~2 months:

| package | yarn.lock (truth) | package-lock.json (stale) |
|---|---|---|
| react / react-dom | 19.2.5 | 19.2.1 |
| @types/react | 19.2.14 | 19.1.13 |
| tree size | 748 entries | 831 packages |

**Fix:** delete `package-lock.json`, add it to `.gitignore`, state yarn-only in the README.

**HIGH — Phantom dependency `@svgr/webpack`.** [`next.config.ts:66`](../../next.config.ts) registers it as the `*.svg` loader, but it's in neither `package.json` nor either lockfile. Any SVG-as-component import breaks `next build`. Compounded by the Turbopack/webpack split (§7) — dev uses Turbopack (which ignores the webpack function), so this only fails at build. **Fix:** add `@svgr/webpack` to `devDependencies`, or remove the rule if unused.

**HIGH — Runtime deps that should be dev (or removed):**
- `ngrok@^5.0.0-beta.2` — tunneling tool, never imported; ships to prod install.
- `supabase-cli@^0.0.21` — an **abandoned, unrelated squatter** package; the real CLI is already present as `supabase@^2.62.5` (dev). Remove entirely.

**MEDIUM — Pre-release deps in production:** `ngrok` beta, `react-leaflet@^5.0.0-rc.2`, `react-leaflet-markercluster@^5.0.0-rc.0` (the last is actually on the map render path). **Fix:** pin exact versions for any rc you must keep; drop the rest.

**MEDIUM — Dead dependencies (zero imports in `src/`):** `react-map-gl` (second, unused mapping stack), `react-leaflet-cluster` (a third cluster lib; only `react-leaflet-markercluster` is used), `lodash`, `lodash.debounce` (+`@types/lodash.debounce`). Remove all.

**MEDIUM — Deprecated `@supabase/auth-helpers-nextjs`** alongside its replacement `@supabase/ssr`. Still imported in one route ([`api/animals/get/route.ts`](../../src/app/api/animals/get/route.ts)). **Fix:** migrate that route to `@supabase/ssr`, drop the deprecated package.

**MEDIUM — `openai-edge` (unmaintained)** in `utils/ai/llm.ts`; the official `openai` SDK now supports edge/streaming. `docs/ai-migration-guide.md` suggests a migration was planned. **Fix:** migrate to `openai`.

**LOW — `dotenv` as a runtime dep** (Next loads `.env` natively) and everything on unpinned `^` ranges.

---

## 2. TypeScript config

**HIGH — No typecheck script.** `package.json` scripts are `dev/build/start/lint/format/test` only — no `tsc --noEmit`, and `next build` doesn't fully type-check untouched files. Combined with no CI (§5), type errors reach production. **Fix:** add `"typecheck": "tsc --noEmit"` and run it in CI.

- `strict: true` — good. `skipLibCheck`/`allowJs` are on (low risk). No inline suppressions in config. `0` `@ts-ignore` / `: any` in `src/` (the codebase leans on `as unknown as` instead — see [findings-api-backend.md](./findings-api-backend.md#type-safety)).

---

## 3. Lint / format

**HIGH — Legacy ESLint config on ESLint 9.** `.eslintrc.json` (legacy format) with `eslint@^9` (which defaults to flat config); it works only via the `@eslint/eslintrc` compat shim through the now-deprecated `next lint`. **Fix:** migrate to `eslint.config.mjs` flat config.

**MEDIUM — No pre-commit hooks** (no husky/lint-staged) and **`@typescript-eslint/no-explicit-any` is only `"warn"`** (as are `no-empty-object-type`, `no-require-imports`) — warnings don't fail `next lint`, so nothing enforces quality. **Fix:** husky + lint-staged running lint/format/typecheck; promote key rules to `error`.

---

## 4. Testing

**HIGH — Effectively no coverage.** 8 Playwright e2e specs (all UI smoke tests) vs 250 source files and 75 API routes; **0 unit tests, 0 API-route tests** — including the payment/webhook handlers, the highest-risk code in the app. Rough coverage is low single digits. **Fix:** add a unit runner (Vitest) and API-route/integration tests, prioritizing payments, RLS, and auth.

**MEDIUM — `msw` is a dead dependency in practice.** Installed, `public/mockServiceWorker.js` + `src/mocks/*` exist, `next.config.ts` even aliases it out — but nothing imports the mocks. **Fix:** wire into tests or remove.

- `playwright.config.ts` itself is reasonable (chromium, CI retries, `forbidOnly`) — there's just almost nothing for it to run, and it never runs in CI.

---

## 5. CI/CD

**HIGH — No CI quality gate.** The only workflow, `.github/workflows/sync-deploy-dev.yml`, runs no lint/typecheck/test/build — it rewrites the latest commit's author and force-pushes to a `deploy-dev` branch that Vercel watches. So nothing verifies PRs; broken code auto-deploys to `dev`. **Fix:** add a PR workflow: `yarn install --frozen-lockfile` → `lint` → `typecheck` → `test` → `build`.

**MEDIUM — Deploy is a git-history-rewriting hack.** `scripts/rewrite_authors.sh` + the workflow force-push a rewritten-author commit on every push (Vercel rejects non-team-member authors — documented in `docs/vercel-ci-workarounds.md`). The git log shows the friction (`"vercel is stupid"`, `"Blatant build bump"`, empty redeploy commits). Brittle: force-push to a shared branch, falsified author metadata, a daemon mode that can clobber `deploy-dev`. **Fix:** move to Vercel Git integration / deploy hooks or a GitHub Action deploy with proper credentials; retire the author-rewrite.

- `vercel.json` itself is fine (per-route `maxDuration`/`memory`, `sfo1`).

---

## 6. Docs & env inventory

**HIGH — Env vars used in code but missing from `dotenv.sample`** (new contributors can't run the app correctly):

| Var | Used in |
|---|---|
| `MANAGER_EMAIL` | `webhooks/stripe/handler.ts` |
| `NEXT_PUBLIC_APP_URL` | `config/telegram.ts` |
| `NEXT_PUBLIC_SITE_URL` | `webhooks/stripe/handler.ts` |
| `PAYPAL_CLIENT_ID` | `lib/paypal/client.ts` (sample only has the `NEXT_PUBLIC_` + secret) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | code reads the unsuffixed var; sample only has `_US`/`_UK` |

**In sample but unused in code** (stale/misleading): `NEXT_PUBLIC_MAPBOX_TOKEN` (dead `react-map-gl`), `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET`, `RESERVATION_TIMEOUT_MINUTES`, `NEXT_PUBLIC_SPONSORSHIP_*` (the blind-sponsorship amount is hardcoded `3333` in `actions/blind-sponsorship.ts:21`, contradicting the sample). **Fix:** reconcile `dotenv.sample` with actual usage.

**MEDIUM — README inaccuracies:** lists unsuffixed `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, but the app is region-split (`_US`/`_UK`); references an MIT `LICENSE` file that **doesn't exist**; offers unsafe `npm install`. **Fix:** correct the var names, add a `LICENSE`, remove the npm option.

- **Good:** the `docs/` folder (17 focused docs) is a genuine strength.

---

## 7. Config risks

**MEDIUM — Broad image `remotePatterns`.** [`next.config.ts`](../../next.config.ts) allows `*.supabase.co` (wildcard — Next's optimizer can proxy *any* Supabase project) plus `cdn.pixabay.com`, `static.wixstatic.com`, `media.istockphoto.com` (likely leftover placeholders). **Fix:** narrow to your project subdomain; drop unused stock hosts.

**MEDIUM — Turbopack/webpack divergence.** `dev` runs `--turbopack` (ignores the `webpack()` function) but the build uses the webpack SVGR/msw config — dev and prod diverge for SVG handling (same rule that needs the missing `@svgr/webpack`). A latent "works in dev, breaks in build" trap. **Fix:** move SVG handling to Turbopack config too, or verify build parity in CI.

- **LOW:** `experimental.optimizePackageImports` (experimental flag); Tailwind `preflight:false` is intentional (Chakra coexistence) — fine.
