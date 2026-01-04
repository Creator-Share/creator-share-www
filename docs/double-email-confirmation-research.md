# Research: Double Email Confirmation on Sponsor

**Date:** January 5, 2026  
**Researcher:** AI Assistant  
**Status:** Completed

---

## Executive Summary

After investigating the email confirmation system, I've identified that **sponsors receive multiple emails by design**, but there are scenarios where this could be perceived as "double confirmation." This research document outlines all email triggers, identifies potential issues, and provides recommendations.

---

## Email Flow Analysis

### 1. Regular (Non-Blind) Sponsorships

**Scenario:** Sponsor selects a specific child to sponsor

**Email Sequence:**
1. **Initial Payment Confirmation** - Sent immediately after checkout
   - **Trigger:** `checkout.session.completed` webhook event
   - **Function:** `sendSponsorshipConfirmationEmail()`
   - **Subject:** "Thank you for sponsoring {childName}!"
   - **Content:** Thanks for sponsorship, includes manage subscription link

2. **Monthly Payment Confirmations** - Sent for recurring payments
   - **Trigger:** `invoice.paid` or `invoice.payment_succeeded` webhook events
   - **Condition:** Only when `billing_reason === "subscription_cycle" || billing_reason === "subscription_update"`
   - **Function:** `sendMonthlyPaymentConfirmationEmail()`
   - **Subject:** "Payment Confirmation: Your Sponsorship for {childName}"
   - **Content:** Monthly payment receipt with cancel/manage link

3. **Manager Notification** - Sent to admin
   - **Trigger:** `checkout.session.completed` webhook event
   - **Function:** `sendManagerSponsorshipNotificationEmail()`
   - **Recipient:** `johnstjulien@sharetanzania.com`

### 2. Blind Sponsorships

**Scenario:** Sponsor chooses "next child who needs support"

**Email Sequence:**
1. **Blind Sponsorship Confirmation** - Sent immediately after checkout
   - **Trigger:** `checkout.session.completed` webhook event
   - **Function:** `sendBlindSponsorshipConfirmationEmail()`
   - **Subject:** "Thank you for your blind sponsorship!"
   - **Content:** Thanks for blind sponsorship, will be matched soon

2. **Match Notification** - Sent when matched with a child
   - **Trigger:** Auto-match endpoint called from webhook OR manual admin action
   - **Function:** `sendBlindSponsorshipMatchedEmail()`
   - **Subject:** "Great news! You've been matched with {childName}!"
   - **Content:** Introduction to matched child, includes profile link
   - **File:** `src/app/api/admin/blind-sponsorships/match/route.ts`

3. **Monthly Payment Confirmations** - Same as regular sponsorships
   - Sent for each recurring payment after matching

4. **Manager Notification** - Same as regular sponsorships

---

## Potential Issues Identified

### Issue #1: Blind Sponsorship "Double Email" (By Design)

**Description:**  
Blind sponsorship sponsors receive TWO emails shortly after payment:
1. Initial blind sponsorship confirmation
2. Match notification (if auto-matched immediately)

**Is this a bug?**  
❌ **No** - This is expected behavior and provides good UX:
- First email confirms payment was successful
- Second email introduces them to the matched child

**Timing:**  
If auto-matching happens immediately (within seconds), sponsors might perceive this as duplicate emails.

**Recommendation:**  
✅ Keep as-is. The emails serve different purposes and provide value.

---

### Issue #2: First Invoice Payment Email

**Description:**  
When a new subscription is created, Stripe triggers both:
- `checkout.session.completed` 
- `invoice.paid` or `invoice.payment_succeeded`

**Current Safeguard:**  
The code checks the `billing_reason` and only sends monthly confirmations for:
- `subscription_cycle` (recurring payments)
- `subscription_update` (subscription changes)

**First invoice billing_reason:**  
The first invoice for a new subscription typically has `billing_reason = "subscription_create"`, which should be ignored by the monthly confirmation logic.

**Potential Issue:**  
If Stripe's `billing_reason` is not what we expect, sponsors could receive:
1. Initial sponsorship confirmation (from `checkout.session.completed`)
2. Monthly payment confirmation (from `invoice.paid` if billing_reason check fails)

**Recommendation:**  
✅ Add explicit exclusion for `subscription_create` billing reason to be extra safe.

---

### Issue #3: Email Logs Show Multiple Sends

**Description:**  
The `email_logs` table might show multiple email sends, which could indicate:
- Webhook retries (Stripe retries failed webhooks)
- Multiple webhook events for same transaction
- Actual duplicate sends

**Investigation Needed:**  
Query the `email_logs` table to check for patterns:

```sql
SELECT 
  email,
  subject,
  status,
  created_at,
  COUNT(*) as send_count
FROM email_logs
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY email, subject, status, created_at
HAVING COUNT(*) > 1
ORDER BY created_at DESC;
```

---

## Email Types Reference

### Sponsor Emails (Customer-Facing)

| Email Function | Trigger | Frequency | Recipient |
|---|---|---|---|
| `sendSponsorshipConfirmationEmail` | New regular sponsorship | Once | Sponsor |
| `sendBlindSponsorshipConfirmationEmail` | New blind sponsorship | Once | Sponsor |
| `sendBlindSponsorshipMatchedEmail` | Blind sponsorship matched | Once per match | Sponsor |
| `sendMonthlyPaymentConfirmationEmail` | Monthly recurring payment | Monthly | Sponsor |
| `sendPaymentFailedEmail` | Payment failure | As needed | Sponsor |
| `sendPartnershipConfirmationEmail` | Partnership payment | Once | Partner |
| `sendSubscriptionConfirmationEmail` | Activity subscription | Once | Subscriber |
| `sendActivityNotificationEmail` | New activity posted | Per activity | Subscriber |
| `sendGoalFulfilledEmail` | Budget goal reached | Once | Subscriber |
| `sendBudgetFulfilledRejectionEmail` | Sponsorship rejection | As needed | Would-be sponsor |

### Admin Emails (Internal)

| Email Function | Trigger | Recipient |
|---|---|---|
| `sendManagerSponsorshipNotificationEmail` | New sponsorship | `johnstjulien@sharetanzania.com` |
| `sendSponsorshipCancellationNotificationEmail` | Sponsorship cancelled | `johnstjulien@sharetanzania.com` |

---

## Webhook Event Flow

```
Payment Flow:
1. User completes checkout
2. Stripe creates subscription
3. Stripe charges first payment
4. Stripe sends webhooks:
   ├─ checkout.session.completed ─→ Initial confirmation email
   ├─ customer.subscription.created (not handled)
   ├─ invoice.created (not handled)
   ├─ invoice.finalized (not handled)
   ├─ payment_intent.created (not handled)
   ├─ payment_intent.succeeded ─→ Acknowledged, no action
   └─ invoice.paid ─→ Monthly confirmation (only for subscription_cycle)

Blind Sponsorship Additional Flow:
5. Auto-match endpoint called from webhook
6. Match email sent if successful

Monthly Recurring Payments:
1. Stripe charges recurring payment
2. Stripe sends webhooks:
   ├─ invoice.created (not handled)
   ├─ payment_intent.created (not handled)
   ├─ payment_intent.succeeded ─→ Acknowledged
   └─ invoice.paid ─→ Monthly confirmation email
```

---

## Code Locations

### Email Functions
- **File:** `src/utils/email.ts`
- **Functions:** All `send*Email()` functions

### Webhook Handler
- **File:** `src/app/api/webhooks/stripe/route.ts`
- **Events Handled:**
  - `checkout.session.completed` (Lines ~70-700)
  - `invoice.payment_failed` (Lines ~700-800)
  - `customer.subscription.updated` (Lines ~800-850)
  - `customer.subscription.deleted` (Lines ~850-950)
  - `invoice.paid` / `invoice.payment_succeeded` (Lines ~950-1050)

### Blind Sponsorship Matching
- **File:** `src/app/api/admin/blind-sponsorships/match/route.ts`
- **Email Trigger:** `sendBlindSponsorshipMatchedEmail()` (Lines ~90, 190, 280)

---

## Recommendations

### 1. ✅ No Action Needed for Blind Sponsorships
The two-email flow for blind sponsorships is intentional and valuable:
- Email 1: Confirms payment was successful
- Email 2: Introduces the matched child

### 2. 🔧 Add Extra Safety for First Invoice
Modify the `invoice.paid` handler to explicitly exclude first-time subscription invoices:

```typescript
// In src/app/api/webhooks/stripe/route.ts
// Around line 950-1050

if (invoice.billing_reason === "subscription_cycle" || 
    invoice.billing_reason === "subscription_update") {
  // Send monthly confirmation
  // ...existing code...
}
```

**Change to:**

```typescript
// Only send monthly confirmations for recurring payments
// Exclude: subscription_create (first payment already confirmed via checkout.session.completed)
if ((invoice.billing_reason === "subscription_cycle" || 
     invoice.billing_reason === "subscription_update") &&
    invoice.billing_reason !== "subscription_create") {
  // Send monthly confirmation
  // ...existing code...
}
```

### 3. 📊 Add Email Deduplication Tracking
Add a check before sending emails to prevent duplicates within a short time window:

```typescript
// Before sending any sponsor email:
const recentEmail = await supabase
  .from("email_logs")
  .select("id")
  .eq("email", customerEmail)
  .eq("subject", emailSubject)
  .gte("created_at", new Date(Date.now - 5 * 60 * 1000).toISOString()) // Last 5 minutes
  .limit(1)

if (recentEmail.data && recentEmail.data.length > 0) {
  console.warn("Email already sent recently, skipping duplicate:", { customerEmail, emailSubject })
  return { success: true, skipped: true, reason: "duplicate_prevention" }
}
```

### 4. 📝 Add Email Delay for Blind Sponsorships (Optional)
If sponsors find the immediate double-email jarring, consider adding a small delay (30-60 seconds) before sending the match email:

```typescript
// In src/app/api/admin/blind-sponsorships/match/route.ts
// After successful match, before sending email:

// Optional: Add slight delay so emails don't arrive simultaneously
await new Promise(resolve => setTimeout(resolve, 30000)) // 30 second delay

await sendBlindSponsorshipMatchedEmail(...)
```

### 5. 🔍 Monitor Email Logs
Regularly check `email_logs` table for patterns of duplicate sends:

```sql
-- Check for duplicate emails in last 24 hours
SELECT 
  email,
  subject,
  DATE_TRUNC('minute', created_at) as minute_sent,
  COUNT(*) as emails_sent
FROM email_logs
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY email, subject, DATE_TRUNC('minute', created_at)
HAVING COUNT(*) > 1
ORDER BY minute_sent DESC;
```

---

## Conclusion

The "double email confirmation" issue is primarily related to **blind sponsorships**, where sponsors receive two emails by design:
1. Initial confirmation of blind sponsorship
2. Notification when matched with a child

This is **not a bug** but an intentional feature that provides good user experience. However, if the matching happens immediately, sponsors may find it confusing.

**Recommended Actions:**
1. ✅ Keep blind sponsorship two-email flow as-is (good UX)
2. 🔧 Add explicit exclusion for `subscription_create` billing reason (safety improvement)
3. 📊 Consider adding email deduplication logic (optional, for extra safety)
4. 🔍 Monitor email logs for actual duplicate sends

**Status:** Research complete. Implementation of recommendations is optional based on business priorities.
