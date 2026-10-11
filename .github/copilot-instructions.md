# Yawa Codebase Summary

## Overview

Yawa is a web application base built with Next.js 15 (App Router), React 19 and TypeScript. It combines tRPC with `@trpc/tanstack-react-query` and `trpc-to-openapi`, next-auth with a Keycloak provider, next-intl (en/de), Knex + PostgreSQL, pino logging, a shadcn/ui + Tailwind v4 component library, user-to-user messaging, a react-joyride guided-tour infrastructure and recharts-based chart helpers.

## Architecture

### Tech Stack

- **Frontend**: Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: tRPC for type-safe APIs, PostgreSQL with Knex.js
- **Authentication**: Keycloak with NextAuth.js
- **State Management**: React Query (TanStack Query)
- **i18n**: next-intl
- **UI**: shadcn/ui + Tailwind CSS v4

### Project structure

```
src/
├── app/                  # App Router pages and API routes
│   ├── api/              # tRPC, public OpenAPI, NextAuth handlers
│   ├── account/          # User account page (avatar)
│   ├── messages/         # User-to-user messaging
│   └── imprint/          # Legal imprint
├── components/
│   ├── ui/               # shadcn/ui base components
│   ├── client/           # Client widgets (Page, Stat, avatars, ...)
│   ├── navigation/       # Sidebar and navigation
│   └── tour/             # Guided-tour infrastructure (react-joyride)
├── hooks/                # Reusable client hooks
├── i18n/                 # next-intl config, catalogs and helpers
├── lib/                  # Routing, chart and timeline helpers, utils
└── server/               # tRPC root/context, routers, controllers, db
```

## Testing

```bash
npm run test:all
```

- `npm run test:unit` — jsdom unit/component tests (vitest)
- `npm run test:server` — integration tests against a throwaway Postgres (testcontainers)
- `npm run test:e2e` — Playwright end-to-end tests

## Database

Migrations live in `migrations/` and are managed with Knex. Database types are generated into `src/types/db_schemas.ts` via `npm run db:types:update`.

## Types

Strict TypeScript throughout. Routes are type-safe via `nextjs-routes` (see `src/lib/appRoutes.ts`). API endpoints use Zod schemas and tRPC for end-to-end type safety.
