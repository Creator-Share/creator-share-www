# Stripe Webhook Metadata Contract

This document defines the required metadata fields for payments processed through the Creator Share Stripe account webhook handler.

## Overview

The webhook at `/api/webhooks/stripe` handles multiple payment types from a shared Stripe account. To ensure proper processing and privacy compliance, specific metadata fields are required for application-related payments.

## Payment Types

### 1. Sponsorship/Subscription Payments

**Required Metadata Fields:**
- `type` (string): Must be set to `"sponsorship"`
- `beneficiaryId` (string): The ID of the beneficiary being sponsored
- `amount` (string): The payment amount in cents
- `userId` (string, optional): The authenticated user's ID if available

**Optional Metadata Fields:**
- `paymentType` (string): Either "subscription" or "payment"

**Example:**
```javascript
{
  type: "sponsorship",
  beneficiaryId: "uuid-of-beneficiary",
  amount: "5000", // $50.00 in cents
  userId: "uuid-of-user",
  paymentType: "subscription"
}
```

**Processing:**
- Creates record in `subscriptions` table
- Creates record in `transaction_ledger` table
- Creates record in `activities` table
- Sends confirmation email to sponsor
- Sends notification email to manager
- Sends Telegram notification

---

### 2. Partnership Payments

**Required Metadata Fields:**
- `type` (string): Must be set to `"partnership"`
- `email` (string): Partner's email address
- `project` (string): Project name for the partnership
- `amount` (string): The payment amount in cents

**Optional Metadata Fields:**
- `paymentType` (string): Either "subscription" or "payment"

**Example:**
```javascript
{
  type: "partnership",
  email: "partner@example.com",
  project: "Community Garden Initiative",
  amount: "10000", // $100.00 in cents
  paymentType: "subscription"
}
```

**Processing:**
- Creates or updates record in `partnerships` table
- Creates record in `transaction_ledger` table
- Sends partnership confirmation email
- Logs email attempts in `email_logs` table

---

### 3. Non-Application Payments

**Metadata:**
- Any payment that does NOT have:
  - `type: "partnership"` with required partnership fields, OR
  - `type: "sponsorship"` with required sponsorship fields

**Processing:**
- Payment is silently acknowledged with HTTP 200
- **No database records created**
- **No logging of payment details**
- **No email notifications sent**

This ensures privacy compliance when the Stripe account is used for other purposes outside of the Creator Share application.

---

## Event Handlers

### Supported Webhook Events

The webhook processes the following Stripe event types:

1. **`checkout.session.completed`**
   - Handles initial payment/subscription setup
   - Validates metadata and creates database records
   - Sends confirmation emails

2. **`invoice.payment_failed`**
   - Updates subscription/partnership status to "cancelled"
   - Sends payment failure notification emails
   - Requires either `type: "partnership"` or valid `subscriptionId`

3. **`customer.subscription.updated`**
   - Updates subscription status in database
   - Maps Stripe subscription statuses to application statuses

4. **`customer.subscription.deleted`**
   - Marks subscription/partnership as cancelled
   - Updates beneficiary status if no active subscriptions remain
   - Sends cancellation notification emails

5. **`invoice.paid` / `invoice.payment_succeeded`**
   - Updates subscription status to "complete"
   - Sends monthly payment confirmation emails for recurring subscriptions

6. **`payment_intent.succeeded`**
   - Acknowledged silently (no specific processing)

7. **`checkout.session.expired` / `checkout.session.async_payment_failed`**
   - Acknowledged silently (no specific processing)

### Unhandled Events

All other webhook event types are acknowledged with HTTP 200 and logged as "Unhandled event type" but do not trigger any processing.

---

## Privacy & Security

### Data Isolation

The webhook handler ensures strict data isolation:

- **Application Payments**: Fully processed with database records and notifications
- **Non-Application Payments**: Silently acknowledged with **zero** logging or database persistence

### Logging Policy

- Application-related errors are logged for debugging
- Non-application payments are **never logged** to prevent PII leakage
- All logs are subject to Vercel's 24-hour retention policy

### Webhook Retries

- Application payments return appropriate status codes (200 for success, error codes for failures)
- Non-application payments always return 200 to prevent unnecessary retries
- Failed webhook processing is always logged as 200 to prevent Stripe retry loops

---

## Implementation Notes

### Metadata Validation

Metadata validation occurs at the beginning of each event handler:

1. Check for partnership metadata (`type === "partnership"`)
2. Check for sponsorship metadata (`type === "sponsorship"`)
3. If neither condition is met, silently acknowledge and exit

**Note:** For invoice payment events (`invoice.paid`, `invoice.payment_succeeded`), the handler queries the database to determine if a subscription exists, as invoice objects don't directly contain subscription metadata.

### Database Error Handling

- Sponsorship subscription insert validates beneficiary status atomically via database trigger
- If beneficiary cannot accept subscriptions (fulfilled/archived), automatic refund flow initiates
- Transaction ledger and activity creation failures are logged but don't fail the webhook

### Email Failures

- Email sending failures are logged to `email_logs` table
- Email failures do not cause webhook processing to fail
- Missing email configuration is logged as warning but processing continues

---

## Configuration Requirements

### Environment Variables

Required for full webhook functionality:

```env
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
EMAIL_USER=smtp-user
EMAIL_PASSWORD=smtp-password
MANAGER_EMAIL=manager@example.com
TELEGRAM_BOT_TOKEN=...
TELEGRAM_MANAGER_CHAT_ID=...
```

### Stripe Dashboard Configuration

**Recommended Webhook Settings:**

1. **Event Selection**: Subscribe only to events listed in "Supported Webhook Events" above
2. **Webhook Version**: Use latest API version
3. **Endpoint URL**: `https://yourdomain.com/api/webhooks/stripe`

---

## Testing

### Test Metadata Examples

**Sponsorship Test:**
```bash
stripe trigger checkout.session.completed \
  --add checkout_session:metadata.type=sponsorship \
  --add checkout_session:metadata.beneficiaryId=test-uuid \
  --add checkout_session:metadata.amount=5000 \
  --add checkout_session:metadata.userId=user-uuid
```

**Partnership Test:**
```bash
stripe trigger checkout.session.completed \
  --add checkout_session:metadata.type=partnership \
  --add checkout_session:metadata.email=test@example.com \
  --add checkout_session:metadata.project="Test Project" \
  --add checkout_session:metadata.amount=10000
```

**Non-Application Test:**
```bash
stripe trigger checkout.session.completed \
  --add checkout_session:metadata.unrelated=true
# Should return 200 with no database changes
```

---

## Changelog

### 2025-12-12
- Initial documentation created
- Added privacy protections for non-application payments
- Removed metadata logging for non-matching payments
- Changed 400 errors to 200 acknowledgments for non-application payments
