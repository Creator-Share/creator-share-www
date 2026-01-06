# Stripe Webhook Configuration Guide

This guide provides step-by-step instructions for configuring your Stripe webhook endpoint to optimize performance and privacy.

## Table of Contents

1. [Webhook Event Filtering](#webhook-event-filtering)
2. [Separate Webhook Endpoints (Optional)](#separate-webhook-endpoints-optional)
3. [Testing Configuration](#testing-configuration)
4. [Monitoring](#monitoring)

---

## Webhook Event Filtering

Configuring Stripe to only send relevant events reduces unnecessary webhook calls and improves security.

### Steps to Configure Event Filtering

1. **Log into Stripe Dashboard**
   - Navigate to https://dashboard.stripe.com
   - Select your account

2. **Navigate to Webhooks**
   - Go to **Developers** → **Webhooks**
   - Find your webhook endpoint (e.g., `https://yourdomain.com/api/webhooks/stripe`)
   - Click on the endpoint to edit

3. **Select Events to Listen To**
   - Click **"... Configure events"** or **"Add events"**
   - **Uncheck "Select all events"**
   - Select ONLY the following events:

   **Checkout Events:**
   - ✅ `checkout.session.completed`
   - ✅ `checkout.session.expired`
   - ✅ `checkout.session.async_payment_failed`

   **Invoice Events:**
   - ✅ `invoice.payment_failed`
   - ✅ `invoice.paid`
   - ✅ `invoice.payment_succeeded`

   **Subscription Events:**
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`

   **Payment Events:**
   - ✅ `payment_intent.succeeded`

4. **Save Configuration**
   - Click **"Update endpoint"** or **"Save"**
   - Verify the event list shows only the 9 events above

### Benefits of Event Filtering

- **Reduced Load**: Fewer webhook calls to your server
- **Faster Processing**: Less time spent on irrelevant events
- **Lower Costs**: Reduced serverless function invocations
- **Better Security**: Smaller attack surface

---

## Separate Webhook Endpoints (Optional)

For organizations using Stripe for multiple purposes, creating separate webhook endpoints can improve isolation and monitoring.

### Architecture Option: Multiple Endpoints

**Endpoint 1: Sponsorships** (`/api/webhooks/stripe/sponsorships`)
- Handles sponsorship/subscription payments
- Requires `beneficiaryId` metadata
- Events:
  - `checkout.session.completed`
  - `invoice.payment_failed`
  - `invoice.paid`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

**Endpoint 2: Partnerships** (`/api/webhooks/stripe/partnerships`)
- Handles partnership payments
- Requires `type: "partnership"` metadata
- Events:
  - `checkout.session.completed`
  - `invoice.payment_failed`
  - `customer.subscription.deleted`

**Endpoint 3: General** (`/api/webhooks/stripe/general`)
- Handles other organizational payments
- No application database integration
- Logs to separate system or notifies admin

### Implementation Steps

1. **Create New Route Files**
   ```
   src/app/api/webhooks/stripe/sponsorships/route.ts
   src/app/api/webhooks/stripe/partnerships/route.ts
   ```

2. **Split Current Logic**
   - Move sponsorship logic to sponsorships endpoint
   - Move partnership logic to partnerships endpoint
   - Each handles specific metadata validation

3. **Configure in Stripe Dashboard**
   - Create multiple webhook endpoints
   - Assign relevant events to each endpoint
   - Use different webhook secrets for each

4. **Update Environment Variables**
   ```env
   STRIPE_WEBHOOK_SECRET_SPONSORSHIPS=whsec_...
   STRIPE_WEBHOOK_SECRET_PARTNERSHIPS=whsec_...
   ```

### Pros and Cons

**Pros:**
- Clear separation of concerns
- Easier debugging and monitoring
- Better error isolation
- Simpler per-endpoint logic

**Cons:**
- More code duplication
- Multiple secrets to manage
- More Stripe configuration overhead
- May be overkill for current scale

**Recommendation:** Keep single endpoint unless you experience specific issues or need stricter isolation.

---

## Testing Configuration

### Stripe CLI Testing

1. **Install Stripe CLI**
   ```bash
   # macOS
   brew install stripe/stripe-cli/stripe
   
   # Linux
   # Download from https://github.com/stripe/stripe-cli/releases
   ```

2. **Login to Stripe**
   ```bash
   stripe login
   ```

3. **Forward Webhooks to Local Development**
   ```bash
   stripe listen --forward-to http://localhost:3000/api/webhooks/stripe
   ```

4. **Trigger Test Events**
   
   **Test Sponsorship:**
   ```bash
   stripe trigger checkout.session.completed \
     --add checkout_session:metadata.type=sponsorship \
     --add checkout_session:metadata.beneficiaryId=test-uuid \
     --add checkout_session:metadata.amount=5000
   ```

   **Test Partnership:**
   ```bash
   stripe trigger checkout.session.completed \
     --add checkout_session:metadata.type=partnership \
     --add checkout_session:metadata.email=test@example.com \
     --add checkout_session:metadata.project="Test Project" \
     --add checkout_session:metadata.amount=10000
   ```

   **Test Non-Application Payment:**
   ```bash
   stripe trigger checkout.session.completed
   # Should return 200 with no database changes
   ```

### Verify Configuration

1. **Check Webhook Logs**
   - Stripe Dashboard → Developers → Webhooks → Your Endpoint
   - View recent deliveries
   - Verify only selected events appear

2. **Check Application Logs**
   - Vercel Dashboard → Your Project → Logs
   - Filter for webhook-related logs
   - Verify non-application payments show no detailed logs

3. **Database Verification**
   - Query `subscriptions` table for test records
   - Query `partnerships` table for test records
   - Verify no unexpected records from non-application tests

---

## Monitoring

### Key Metrics to Track

1. **Webhook Success Rate**
   - Track percentage of 200 responses
   - Alert on sudden drops

2. **Event Type Distribution**
   - Monitor which events are most common
   - Identify unexpected event types

3. **Processing Time**
   - Track webhook handler execution time
   - Identify performance degradation

4. **Database Insert Failures**
   - Monitor subscription insert errors
   - Track beneficiary validation failures

5. **Email Delivery Rates**
   - Track successful vs failed emails
   - Monitor email_logs table

### Stripe Dashboard Monitoring

1. **View Webhook Attempts**
   - Go to Developers → Webhooks → Endpoint
   - Click "View logs" to see all attempts
   - Filter by status (success/failed)

2. **Set Up Notifications**
   - Enable email notifications for failed webhooks
   - Configure in endpoint settings

3. **Review Failed Deliveries**
   - Investigate 4xx/5xx responses
   - Check for signature verification failures

### Application-Level Monitoring

Consider implementing:

1. **Structured Error Logging**
   - Use a logging service (Sentry, LogRocket, etc.)
   - Categorize errors by severity
   - Include contextual metadata

2. **Database Monitoring**
   - Set up alerts for unusual insert failures
   - Monitor subscription status distribution

3. **Email Monitoring**
   - Track email_logs table statistics
   - Alert on high failure rates

---

## Security Best Practices

### Webhook Signature Verification

✅ **Already Implemented** - The webhook handler verifies signatures on line 45:

```typescript
event = stripe.webhooks.constructEvent(rawBody, sig as string, webhookSecret)
```

### Additional Security Measures

1. **Rotate Webhook Secrets Periodically**
   - Update in Stripe Dashboard
   - Update environment variables
   - Test before deploying

2. **Use HTTPS Only**
   - Ensure webhook endpoint uses HTTPS
   - Stripe requires HTTPS for production webhooks

3. **Implement Rate Limiting**
   - Protect against webhook flooding
   - Use Vercel's built-in rate limiting or middleware

4. **Monitor for Suspicious Activity**
   - Track unusual metadata patterns
   - Alert on unexpected event volumes

---

## Troubleshooting

### Common Issues

**Issue 1: Webhook Signature Verification Fails**
- **Cause**: Wrong webhook secret or modified request body
- **Solution**: Verify `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard
- **Check**: Ensure no middleware modifies the raw request body

**Issue 2: Events Not Being Received**
- **Cause**: Event type not selected in Stripe Dashboard
- **Solution**: Add the event type to webhook configuration
- **Check**: Review webhook logs in Stripe Dashboard

**Issue 3: Database Inserts Failing**
- **Cause**: Missing or invalid beneficiary ID
- **Solution**: Verify metadata is set correctly in checkout session
- **Check**: Review application logs for specific error messages

**Issue 4: Duplicate Webhook Processing**
- **Cause**: Webhook retries due to timeouts or errors
- **Solution**: Implement idempotency checks using `event.id`
- **Check**: Add unique constraint on processed event IDs

---

## Recommended Next Steps

1. ✅ **Implement Event Filtering** (High Priority)
   - Reduces unnecessary webhook calls
   - Improves security and performance

2. ⏱️ **Set Up Monitoring** (Medium Priority)
   - Track webhook success rates
   - Monitor for anomalies

3. 🔄 **Consider Separate Endpoints** (Low Priority)
   - Only if needed for organizational requirements
   - Evaluate based on scale and complexity

4. 📊 **Add Structured Logging** (Low Priority)
   - Integrate logging service like Sentry
   - Improve debugging and error tracking

---

## Support Resources

- [Stripe Webhook Documentation](https://stripe.com/docs/webhooks)
- [Stripe CLI Documentation](https://stripe.com/docs/stripe-cli)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)
- [Testing Webhooks](https://stripe.com/docs/webhooks/test)

---

## Changelog

### 2025-12-12
- Initial configuration guide created
- Added event filtering instructions
- Documented separate endpoint architecture option
- Added testing and monitoring guidance
