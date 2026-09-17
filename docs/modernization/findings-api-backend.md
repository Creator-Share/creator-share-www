# API / Backend Findings (maintainability, duplication, best practices)

Reviewed 75 route handlers (40 under `admin/`), plus `src/actions/`, `src/services/`, `src/lib/`, `src/utils/`. The backend works, but almost every route re-implements the same five steps (parse → validate → auth → try/catch → error-shape) by hand, there is no schema validation, and the Supabase client is untyped — which forces ~19 unsound casts.

---

## 1. Duplication

| Pattern | Files affected | Severity |
|---|---|---|
| `try/catch` + `NextResponse.json({error}, {status})` boilerplate | 69 files / 121 catch clauses | HIGH |
| `const errorMessage = err instanceof Error ? err.message : "Unknown error"` (verbatim copy) | 27 files | HIGH |
| `await req.json()` with hand-rolled parse-error handling | 35 files | HIGH |
| Manual required-field validation (`requiredFields.filter`) | 9 files | MEDIUM |
| `as unknown as MediaRow[]` cast before `filterExistingMediaRows` | 14 occurrences | MEDIUM |
| Inline `role_assignments` SUPER_ADMIN check bypassing the helper | 9 files | HIGH |
| Cancellation-cascade logic | 3 files | MEDIUM |

**HIGH — No request-handling wrapper.** Every route independently re-implements parse → validate → auth → try/catch → error-shape. Representative: [`admin/beneficiaries/create/route.ts:12-113`](../../src/app/api/admin/beneficiaries/create/route.ts) nests a body-parse `try` inside an outer `try`, then formats errors a third way. **Fix:** a higher-order `adminRoute(schema, fn)` wrapper that centralizes auth, parsing, validation, and error normalization — collapses ~40 lines/route to ~5 and eliminates the 27-file `errorMessage` duplication. Sketch:

```ts
// src/lib/api/handler.ts
export function adminRoute<T>(schema: ZodSchema<T>, fn: (ctx: {body: T; user: User; supabase: SupabaseClient<Database>}) => Promise<Response>) {
  return async (req: Request) => {
    const supabase = await createClient()
    const auth = await requireSuperAdmin(supabase)
    if (!auth.ok) return auth.response
    const parsed = schema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 })
    try { return await fn({ body: parsed.data, user: auth.user, supabase }) }
    catch (e) { logError(e); return NextResponse.json({ error: "Internal server error" }, { status: 500 }) }
  }
}
```

**HIGH — Inconsistent auth usage.** A good helper exists (`requireSuperAdmin`, used by 40 files), but 9 files under `admin/users/*` and `auth/*` still hand-roll the same `role_assignments → SUPER_ADMIN` query — e.g. [`auth/check-admin/route.ts:16-35`](../../src/app/api/auth/check-admin/route.ts) duplicates the helper's exact logic, including the `as unknown as RoleAssignmentResponse` cast. Route all of these through the helper.

**MEDIUM — Notification fan-out not extracted.** Two notify routes and the webhook each re-orchestrate Telegram + email. The Telegram service is well-factored; the email-dispatch fan-out (fetch subscribers → filter opt-outs → loop-send) is not.

---

## 2. Input validation

**HIGH — No schema-validation library at all.** No `zod`/`yup`/`valibot` in `package.json`; all 35 body-parsing routes hand-roll validation. [`admin/beneficiaries/create/route.ts`](../../src/app/api/admin/beneficiaries/create/route.ts) is the poster child:
- **Silent coercion masks bad input:** `gender` silently falls back to `'Boy'` for any invalid value (`:50`); `budget_goal`/`budget_raised` push non-numeric input to `0` via `Number(x) || 0` (`:53-54`). The client gets no feedback.
- **No bounds:** `String(body.name).trim()` accepts empty-after-trim and arbitrary length/content.
- **Mass assignment:** `...(body.metadata || {})` (`:61-64`) merges arbitrary client keys straight into the DB row.
- **Lossy booleans:** `Boolean(body.x)` treats string `"false"` as `true`.

**Fix:** add `zod`, one `.strict()` schema per route, fed into the `adminRoute` wrapper so validation is declarative and errors are structured. This also closes the mass-assignment hole.

---

## 3. Error handling & logging

**HIGH — Internal errors leaked to clients.** 13 routes return raw Supabase `error.message` to the client (e.g. [`admin/beneficiaries/create/route.ts:80`](../../src/app/api/admin/beneficiaries/create/route.ts)), exposing DB column/constraint names. Clients should get a stable generic message + code; detail belongs in logs only.

**MEDIUM — No structured logging.** ~406 `console.*` calls total (267 `console.error` + 34 `console.warn` + others), all ad-hoc, none environment-gated (they fire in production), no request-id correlation, emoji-prefixed markers (`"❌ Error checking admin:"`). **Fix:** a `src/lib/logger.ts` (pino or thin wrapper) with `logError(err, ctx)`; replace direct `console.*`.

**LOW — Inconsistent error vocabulary.** 28 routes say `"Internal server error"`, 21 `"Unknown error"`, 42 various `"Failed to …"`. No shared error catalog / status-code convention.

---

<a id="type-safety"></a>
## 4. Type safety

**Root cause — the Supabase client is untyped.** [`src/utils/supabase/server.ts:8`](../../src/utils/supabase/server.ts) calls `createServerClient(...)` **without** the `<Database>` generic, and `createServiceRoleClient` (`:33`) likewise. The generated types exist (`db.types.ts`, 2790 lines) but are imported in only ~5 places. Because queries return `any`-shaped data, the code compensates with casts:
- **31 `as unknown as` casts**, 14 of them the identical `as unknown as MediaRow[]` (a self-documenting TODO at `admin/activities/media/delete/route.ts:65` admits the cast should be unnecessary with generated types).
- The `RoleAssignmentResponse` double-cast pattern in `requireSuperAdmin.ts:36`, `check-admin/route.ts:30`, `admin/layout.tsx:25`.
- 0 `as any`, 0 `@ts-ignore`, 0 `: any` — the team avoids the blunt escapes but leans on `as unknown as`, which is equally unsound.

**Fix:** parameterize both clients — `createServerClient<Database>(...)`. One-file change that deletes the entire `MediaRow`/`RoleAssignmentResponse` cast family and makes join shapes compiler-checked.

---

## 5. Structure & consistency

**MEDIUM — Non-REST, RPC-style routing.** 23 routes encode the verb in the path (`/admin/activities/retrieve`, `/admin/expenses/get`, `/admin/beneficiaries/create`, `/delete/[id]`) rather than using HTTP methods on resource paths — and naming is itself inconsistent (`retrieve` vs `get` for the same read across sibling modules). Convention should be `GET/POST /admin/activities`, `GET/PATCH/DELETE /admin/activities/[id]`.

**MEDIUM — Business logic in handlers, no service layer.** `src/services/` contains only `telegram.ts`. DB orchestration, validation, and notification live inline in handlers — e.g. [`admin/users/assign-roles/route.ts:40-66`](../../src/app/api/admin/users/assign-roles/route.ts) runs a manual delete-then-insert "transaction" with no actual transaction (partial-failure hazard). Extract domain logic into `src/services/*` so handlers become thin.

**LOW — Inconsistent auth ordering** (some routes auth before parsing, others parse first, leaking work to unauthenticated callers) and **mixed semicolon style**. The shared wrapper fixes ordering uniformly.

---

## 6. Dead code / TODOs

- **HIGH — Test routes in the production tree:** `api/test/create-child`, `test/payment-failed-email`, `test/telegram` — live, deployable, unauthenticated. (Cross-ref security [H1](./findings-security.md#h1).) Remove or guard behind `NODE_ENV !== 'production'` + auth.
- Only 4 TODO/FIXME markers total (clean): unfinished cursor pagination (`beneficiaries/get:30`), unhandled file uploads (`create:104`), the MediaRow cast, and **hardcoded FX rates** (`currency.ts:28` — a correctness risk for a payments app).
- **`src/utils/email.ts` is 1259 lines** with 14 `sendXxxEmail` functions — a god-module to split by concern with a shared base template.
- **`src/app/api/webhooks/stripe/handler.ts` is 1382 lines** — the single largest, highest-risk file; decompose per event type.

---

## 7. API design

- **HIGH — N+1 / no batching in the hottest path.** [`admin/activities/notify/route.ts:233`](../../src/app/api/admin/activities/notify/route.ts) sends emails/queries per recipient; `Promise.all` appears in only 1 API file, so most fan-out is sequential `await`-in-loop. Batch reads and throttle sends.
- **MEDIUM — Pagination barely exists.** `.range()` is used in exactly 1 route; list endpoints (`beneficiaries/retrieve`, `users`, `expenses/get`) return unbounded sets. Cursor pagination was started then reverted (TODO at `beneficiaries/get:30`).
- **MEDIUM — No rate limiting anywhere.** Auth, invite, OTP, and payment endpoints are unthrottled (cross-ref security [M1](./findings-security.md#m1)).
- **LOW — `dynamic`/`runtime` exports inconsistent:** only 11 of 75 routes declare them; auth-dependent routes omitting `export const dynamic = "force-dynamic"` risk incorrect static caching.
