# Creator Share

> **Be the Reason Someone Smiles Today**

Creator Share is a modern sponsorship platform connecting compassionate individuals with vulnerable children in need. Built with Next.js, Supabase, and modern web technologies, it provides a seamless experience for managing child sponsorships, processing payments, and tracking the impact of charitable giving.

## 🌟 Features

- **🎯 Sponsorship Marketplace** - Browse and sponsor children with rich profiles, images, and stories
- **💳 Dual Payment Processing** - Integrated Stripe and optional PayPal support for global accessibility
- **📊 Admin Dashboard** - Comprehensive management tools for beneficiaries, subscriptions, and activities
- **🔄 Real-time Updates** - Live subscription and payment status tracking
- **📍 Geographic Mapping** - Interactive maps showing beneficiary locations
- **🎨 Modern UI** - Beautiful, responsive design built with Chakra UI and Tailwind CSS
- **🔐 Role-Based Access** - Secure authentication with granular permissions
- **📱 Embeddable Widget** - Drop-in iframe support for partner websites
- **📧 Email Notifications** - Automated communication for sponsorships and payments
- **🔔 Telegram Integration** - Optional bot notifications for real-time updates

## 🚀 Quick Start

### Prerequisites

- **Node.js**: v20.17.0 (specified in `.nvmrc`)
- **Package Manager**: npm or yarn
- **Database**: Supabase account
- **Payment Processor**: Stripe account (PayPal optional)

### Installation

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/creator-share-www.git
   cd creator-share-www
   ```

2. **Install Node.js version**

   ```bash
   nvm install 20
   nvm use 20
   ```

3. **Install dependencies**

   ```bash
   npm install
   # or
   yarn install
   ```

4. **Configure environment variables**

   ```bash
   cp dotenv.sample .env.local
   ```

   Edit `.env.local` with your configuration (see [Environment Configuration](#-environment-configuration) below).

5. **Set up the database**

   Follow the [Database Setup Guide](./docs/setup.md) to:

   - Enable required PostgreSQL extensions
   - Run migrations
   - Seed initial data (optional)

6. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) to see the application.

### Common Issues

- **"Node.js version required"** → Run `nvm use`
- **Port 3000 in use** → Run `lsof -ti:3000 | xargs kill -9`
- **Database errors** → Ensure you've enabled all required extensions (see [setup.md](./docs/setup.md))

## ⚙️ Environment Configuration

The application uses environment variables for all sensitive configuration. Copy `dotenv.sample` to `.env.local` and configure the following:

### Required Variables

| Variable                              | Description                                  |
| ------------------------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`            | Your Supabase project URL                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`       | Supabase anonymous/public key                |
| `NEXT_SERVICE_ROLE_KEY`               | Supabase service role key (server-side only) |
| `NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET` | Name of your Supabase storage bucket         |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`  | Stripe publishable key                       |
| `STRIPE_SECRET_KEY`                   | Stripe secret key                            |
| `STRIPE_WEBHOOK_SECRET`               | Stripe webhook signing secret                |

### Optional Variables

#### PayPal Integration

PayPal support is **optional** and disabled by default. To enable PayPal:

| Variable                       | Description                                |
| ------------------------------ | ------------------------------------------ |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | PayPal client ID (enables PayPal when set) |
| `PAYPAL_CLIENT_SECRET`         | PayPal client secret                       |
| `PAYPAL_API_URL`               | PayPal API URL (defaults to sandbox)       |
| `PAYPAL_WEBHOOK_ID`            | PayPal webhook ID for verification         |

When `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is not set, the app functions normally with Stripe as the sole payment processor.

#### Email Configuration

| Variable         | Description              |
| ---------------- | ------------------------ |
| `EMAIL_HOST`     | SMTP server hostname     |
| `EMAIL_USER`     | SMTP username            |
| `EMAIL_PASSWORD` | SMTP password            |
| `EMAIL_PORT`     | SMTP port (default: 587) |
| `EMAIL_SECURE`   | Use TLS (default: true)  |

#### Telegram Notifications

| Variable             | Description                       |
| -------------------- | --------------------------------- |
| `TELEGRAM_BOT_TOKEN` | Bot token from BotFather          |
| `TELEGRAM_CHAT_ID`   | Chat/channel ID for notifications |

See [telegram-bot-setup.md](./docs/telegram-bot-setup.md) for detailed setup instructions.

#### Other Configuration

| Variable                       | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `NEXT_PUBLIC_BASE_URL`         | Your application's base URL                    |
| `NEXT_PUBLIC_MAPBOX_TOKEN`     | Mapbox token for mapping features              |
| `NEXT_PUBLIC_SPONSORSHIP_GOAL` | Default sponsorship amount in cents            |
| `RESERVATION_TIMEOUT_MINUTES`  | How long a sponsorship stays reserved          |
| `SUPABASE_PROJECT_ID`          | Your Supabase project ID (for type generation) |

## 📚 Documentation

- **[Setup Guide](./docs/setup.md)** - Database configuration and extension setup
- **[Branching & Deployment](./docs/branches.md)** - Git workflow and CI/CD process
- **[Stripe Webhooks](./docs/stripe-webhook.md)** - Payment webhook configuration
- **[Telegram Bot](./docs/telegram-bot-setup.md)** - Notification bot setup
- **[Supabase Storage](./docs/supabase-storage-bucket-config.md)** - Media storage configuration
- **[Vercel CI](./docs/vercel-ci-workarounds.md)** - Deployment troubleshooting

## 🏗️ Architecture

### Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **Database**: [Supabase](https://supabase.com/) (PostgreSQL)
- **Authentication**: Supabase Auth
- **UI Components**: [Chakra UI](https://chakra-ui.com/) + [Tailwind CSS](https://tailwindcss.com/)
- **State Management**: [Zustand](https://github.com/pmndrs/zustand)
- **Forms**: [React Hook Form](https://react-hook-form.com/)
- **Data Fetching**: [TanStack Query](https://tanstack.com/query)
- **Payments**: [Stripe](https://stripe.com/) + [PayPal](https://www.paypal.com/)
- **Maps**: [Leaflet](https://leafletjs.com/) + React Leaflet
- **Email**: [Nodemailer](https://nodemailer.com/)
- **Testing**: [Playwright](https://playwright.dev/)

### Key Routes

| Route                      | Description                                         |
| -------------------------- | --------------------------------------------------- |
| `/`                        | Homepage with hero section and sponsorship listings |
| `/embed`                   | Embeddable version for iframe integration           |
| `/sponsorships/[username]` | Individual beneficiary profile pages                |
| `/admin/*`                 | Admin dashboard (authentication required)           |
| `/api/*`                   | Backend API routes                                  |

### Project Structure

```
creator-share-www/
├── src/
│   ├── app/                    # Next.js app directory
│   │   ├── (admin)/           # Admin dashboard routes
│   │   ├── api/               # API endpoints
│   │   ├── embed/             # Embeddable widget
│   │   └── sponsorships/      # Sponsorship pages
│   ├── components/            # React components
│   │   ├── admin-ui/         # Admin-specific components
│   │   ├── common/           # Shared components
│   │   └── ui/               # Base UI components
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities and libraries
│   ├── services/             # External service integrations
│   ├── store/                # Zustand state stores
│   └── utils/                # Helper functions
├── supabase/
│   ├── migrations/           # Database migrations
│   └── seed.sql             # Sample data for local dev
├── docs/                     # Documentation
├── tests/                    # E2E tests
└── public/                   # Static assets
```

## Database Schema Management

We use custom scripts to manage database schema synchronization between local migrations and the remote Supabase database. These scripts bypass known issues with the Supabase CLI.

For detailed instructions, see [scripts/db/README.md](./scripts/db/README.md).

**Quick start:**
```bash
# Set environment variables
export SUPABASE_DB_PASSWORD='your-password'
export SUPABASE_DB_HOST='db.yourproject.supabase.co'

# Run the sync workflow
./scripts/db/full_sync.sh
```

See [docs/branches.md](./docs/branches.md) for detailed branching and deployment information.

## 🛠️ Development

### Available Scripts

```bash
npm run dev          # Start development server with Turbopack
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run test         # Run Playwright tests
npm run test:ui      # Run tests with UI
npm run test:headed  # Run tests in headed mode
```

### Database Type Generation

After making database schema changes:

```bash
export SUPABASE_PROJECT_ID="your-project-id"
npm run update-types-dev
```

This generates TypeScript types from your Supabase schema in `src/lib/types/db.types.ts`.

### Testing

E2E tests are written with Playwright:

```bash
npm run test              # Run all tests
npm run test:ui           # Interactive UI mode
npm run test:headed       # With visible browser
```

Test files are located in the `tests/` directory:

- `homepage.spec.ts` - Homepage functionality
- `filters.spec.ts` - Filter component behavior
- `infinite-scroll.spec.ts` - Pagination and scrolling
- `embed.spec.ts` - Embedded widget

## 🤝 Contributing

We welcome contributions! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Make your changes**
4. **Run tests** (`npm run test`)
5. **Commit your changes** (`git commit -m 'Add amazing feature'`)
6. **Push to the branch** (`git push origin feature/amazing-feature`)
7. **Open a Pull Request**

### Development Guidelines

- Follow TypeScript best practices
- Maintain test coverage for new features
- Use conventional commit messages
- Update documentation as needed
- Ensure all tests pass before submitting PR
- Follow the existing code style (enforced by ESLint/Prettier)

## 🔐 Security

### Reporting Vulnerabilities

If you discover a security vulnerability, please email security@creatorshare.com instead of opening a public issue.

### Security Best Practices

- Never commit `.env` files or secrets
- All API routes that modify data require authentication
- Stripe webhooks verify signatures before processing
- Supabase Row Level Security (RLS) enforces data access
- Service role key only used in server-side API routes

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with support from the Creator Share Foundation
- Designed to serve vulnerable children in developing countries
- Inspired by organizations making a real difference in children's lives

## 📞 Support

- **Documentation**: See the `docs/` directory
- **Issues**: [GitHub Issues](https://github.com/yourusername/creator-share-www/issues)
- **Email**: support@creatorshare.com
- **Website**: [creatorshare.com](https://creatorshare.com)

---

**Made with ❤️ by the Creator Share team**
