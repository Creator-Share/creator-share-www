# Duplicate Sponsorship Issue - Root Cause Analysis

## Problem Statement
Multiple users can sponsor the same child at the same time, leading to duplicate active subscriptions for a single beneficiary.

## Root Cause

### The Race Condition
The current implementation has a critical race condition between checkout creation and subscription creation:

```
Timeline of the Bug:
─────────────────────────────────────────────────────────────────

User A                          System                    User B
────────────────────────────────────────────────────────────────
Opens modal
Clicks "Sponsor"
                        → Check subscriptions table
                          ✓ NONE FOUND (correct)
                        → Create Stripe checkout
Payment completes
                        → Webhook triggered but
                          not processed yet
                                                Opens same child modal
                                                Clicks "Sponsor"
                                        → Check subscriptions table
                                          ✓ STILL NONE (User A's webhook
                                            hasn't created subscription yet)
                                        → Create Stripe checkout
                        → User A webhook processes
                          Creates subscription #1
                                                Payment completes
                                        → User B webhook processes
                                          Creates subscription #2
                        
RESULT: TWO ACTIVE SUBSCRIPTIONS FOR SAME CHILD ❌
```

### Technical Details

**Current Validation (FLAWED)**
```typescript
// In /api/stripe/route.ts - Line 20-40
const { data: existingSubscriptions } = await supabase
  .from("subscriptions")
  .select("id, status, stripe_subscription_id")
  .eq("beneficiary_id", beneficiaryId)
  .in("status", ["complete", "active"])
  .limit(1)
```

**The Problem**: This check happens BEFORE checkout, but subscriptions are created AFTER checkout (in the webhook). There's a time gap where multiple users can pass this check.

**Existing Infrastructure (UNUSED)**
- A `beneficiary_reservations` table exists (created in migration `20251006120000_sponsorship_reservations.sql`)
- Has unique constraint: `uniq_active_reservation_per_beneficiary`
- Designed to prevent this exact issue
- **BUT IT'S NOT BEING USED IN THE VALIDATION FLOW**

## Why It Happens

1. **Asynchronous Webhook Processing**: Stripe webhooks are processed asynchronously after checkout, creating a gap
2. **Missing Reservation Check**: The code checks `subscriptions` table but not `beneficiary_reservations`
3. **No Checkout-Time Reservation**: No reservation is created when checkout begins
4. **Webhook Check Too Late**: The duplicate check in the webhook (lines 264-285) happens AFTER both checkouts are created

## Solution (Following Stripe Best Practices)

Following Stripe's recommended pattern for handling concurrent purchases:

### Approach: Database Constraint as Final Arbiter

Instead of complex reservation systems, we let the database unique constraint be the single source of truth:

1. **Simple Check at Checkout Creation** - Quick check to catch obvious duplicates
2. **Database Constraint Enforces Uniqueness** - PostgreSQL unique index prevents race conditions
3. **Graceful Failure Handling** - When constraint is violated, cancel subscription and notify customer

```sql
-- Database constraint (the actual protection)
CREATE UNIQUE INDEX uniq_active_subscription_per_beneficiary
ON subscriptions(beneficiary_id)
WHERE status IN ('complete', 'active');
```

```typescript
// In /api/stripe/route.ts - Simple pre-check
const { data: existingSubscriptions } = await supabase
  .from("subscriptions")
  .select("id")
  .eq("beneficiary_id", beneficiaryId)
  .in("status", ["complete", "active"])
  .limit(1)

if (existingSubscriptions?.length > 0) {
  return NextResponse.json({ error: "DUPLICATE_SPONSORSHIP" }, { status: 409 })
}
// Let concurrent checkouts proceed - DB will decide the winner
```

```typescript
// In webhook - Handle constraint violation gracefully
const { error: subscriptionError } = await supabase
  .from("subscriptions")
  .insert({ ...subscriptionData })

if (subscriptionError?.code === '23505') { // Unique violation
  // This was a duplicate - cancel Stripe subscription
  await stripe.subscriptions.cancel(session.subscription)
  
  // Send apology email with invitation to sponsor different child
  await sendDuplicateSponsorshipEmail(customerEmail, childName, amount)
  
  return NextResponse.json({ message: "Duplicate prevented" }, { status: 200 })
}
```

### Why This Approach is Better

1. **Simpler** - No complex reservation system to maintain
2. **Stripe Pattern** - Follows Stripe's recommended "let database decide" pattern
3. **Reliable** - Database constraints can't have race conditions
4. **User-Friendly** - Automatic cancellation and clear communication
5. **No Stale Locks** - No expired reservations to clean up

## Recommended Implementation Plan

### Phase 1: Quick Fix (Immediate)
- [x] Add reservation check to `/api/stripe/route.ts`
- [x] Create reservation before checkout
- [x] Clear reservation in webhook after subscription creation

### Phase 2: Database Protection (Next)
- [ ] Add unique constraint to subscriptions table
- [ ] Add cleanup job for expired reservations
- [ ] Add monitoring for reservation conflicts

### Phase 3: UI Enhancement (Future)
- [ ] Show real-time "Someone is sponsoring this child" indicator
- [ ] Auto-refresh child status when reservation detected
- [ ] Better error messaging with retry logic

## Testing Scenarios

To verify the fix works:

1. **Concurrent Checkout**: Two users click sponsor button within 1 second
   - Expected: Second user gets "already sponsored" error
   
2. **Abandoned Checkout**: User starts checkout but doesn't complete
   - Expected: Reservation expires after 15 minutes, child available again
   
3. **Race with Webhook**: User A completes payment, User B tries during webhook processing
   - Expected: User B blocked by reservation check

## Files Affected

- `src/app/api/stripe/route.ts` - Add reservation logic
- `src/app/api/webhooks/stripe/route.ts` - Clear reservations on success
- `supabase/migrations/` - New migration for unique constraint
- `src/app/sponsorships/components/SponsorshipModal/index.tsx` - Handle new error states

## Related Issues

- Presence indicator exists but doesn't prevent sponsorship
- No automatic cleanup of expired reservations
- PayPal flow may have similar issue (needs audit)
