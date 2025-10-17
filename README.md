This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
yarn dev
```

## Environment Configuration

The application uses environment variables for configuration. Copy `dotenv.sample` to `.env.local` and configure the required variables.

### Required Variables

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase anonymous key
- `NEXT_SERVICE_ROLE_KEY` - Supabase service role key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key
- `STRIPE_SECRET_KEY` - Stripe secret key

### Optional Variables

#### PayPal Integration

PayPal payment support is **optional** and disabled by default. To enable PayPal payments:

1. Set the `NEXT_PUBLIC_PAYPAL_CLIENT_ID` environment variable
2. Configure the following additional PayPal variables:
   - `PAYPAL_CLIENT_SECRET` - PayPal client secret
   - `PAYPAL_API_URL` - PayPal API URL (defaults to sandbox)
   - `PAYPAL_WEBHOOK_ID` - PayPal webhook ID for webhook verification

When `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is not set:

- PayPal payment buttons will not appear in the sponsorship modal
- All PayPal API endpoints will return a 501 (Not Implemented) error
- The application will function normally using Stripe as the only payment processor

See `dotenv.sample` for the complete list of configuration options.

## Branching and Deployment Process

For detailed information on our branching and deployment workflow, including how we handle Vercel's commit author restrictions, please see [docs/branches.md](./docs/branches.md).

## Vercel Deployment

Push changes to the main branch, then to trigger a deployment,

```bash
yarn deploy
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.
