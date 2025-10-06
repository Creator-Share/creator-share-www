# Agent Instructions

## Starting the Dev Server

**Required Node.js version:** v20.17.0 (specified in `.nvmrc`)

### Quick Start

```bash
bash -c 'source ~/.nvm/nvm.sh && nvm use && npm run dev'
```

### If That Fails

```bash
# Install correct Node version
nvm install 20 && nvm use 20

# Start server
npm run dev
```

### Common Issues

- **"Node.js version required"** → Run `nvm use`
- **Port 3000 in use** → Run `lsof -ti:3000 | xargs kill -9`

## Key Routes

- `/` - Homepage (Hero + Listings)
- `/embed` - Embeddable version for iframes
- `/sponsorships/[username]` - Individual profiles
- `/admin/*` - Admin dashboard (auth required)

## Important Files

- `src/hooks/useBeneficiaryPagination.ts` - Shared pagination with Fibonacci retry
- `src/app/page.tsx` - Homepage
- `src/app/embed/page.tsx` - Embed page
- `src/app/sponsorships/components/SponsorshipFilters/` - Filter component

## Quick Commands

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run lint     # Run linter
npm run format   # Format code
```
