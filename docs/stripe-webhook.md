# Stripe Webhook Integration

This document describes the Stripe webhook integration implemented in this project.

## Webhook Endpoint

The webhook endpoint is located at:

```
${SITE_URL}/api/webhooks/stripe
```

This endpoint receives and processes Stripe webhook events to keep the application database in sync with payment and subscription statuses.

## Supported Stripe Events

The webhook handler processes the following Stripe event types:

- `checkout.session.completed`: Triggered when a checkout session completes successfully. The webhook:
  - Validates session metadata.
  - Creates transaction and activity records in the database.
  - Creates subscription records for one-time payments.
  - Sends sponsorship confirmation emails to customers.

- `customer.subscription.created`: Creates a subscription record in the database when a new subscription is created.

- `customer.subscription.updated`: Updates subscription status and billing period dates in the database.

- `customer.subscription.deleted`: Marks subscriptions as cancelled in the database.

- `invoice.payment_failed`: Handles failed payments by updating subscription status and sending payment failure notification emails.

- `invoice.paid` and `invoice.payment_succeeded`: Marks subscriptions as complete upon successful invoice payment.

- `payment_intent.succeeded`: Logs successful payment intents.

Other event types are acknowledged but not specifically handled.

## Configuration in Stripe Dashboard

To enable webhook event delivery, configure the webhook endpoint URL in your Stripe Dashboard:

1. Go to **Developers > Webhooks**.
2. Click **Add endpoint**.
3. Enter the URL of the webhook endpoint:
   ```
   ${SITE_URL}/api/webhooks/stripe
   ```
4. Select the relevant event types to listen for (as listed above).
5. Save the webhook endpoint.
6. Copy the webhook signing secret from Stripe and set it as the environment variable `STRIPE_WEBHOOK_SECRET` in your application.

## Environment Variables

- `STRIPE_SECRET_KEY`: Your Stripe secret API key.
- `STRIPE_WEBHOOK_SECRET`: The webhook signing secret from Stripe.
- `EMAIL_USER` and `EMAIL_PASSWORD`: Credentials for sending confirmation and failure emails.

## How It Works

When Stripe sends an event to the webhook endpoint, the application:

- Verifies the event signature using the webhook secret.
- Processes the event according to its type.
- Updates the Supabase database with transaction, subscription, and activity records.
- Sends emails to customers for sponsorship confirmations or payment failures.

This ensures that the application state remains consistent with Stripe payment events.

## Frontend Return Page

The payment return page (`/payments/return`) fetches the checkout session status and displays appropriate messages to users after payment. It retries fetching session data if the webhook has not yet processed the event, providing a smooth user experience.

---

This integration enables reliable handling of Stripe payments and subscriptions with real-time updates via webhooks.
