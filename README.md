# Homepact

Negotiation system for new-home sales: proposals, change requests, purchase agreements and
signatures, for many companies from one install.

## Test

```bash
npm run qa   # install, build the shared package, run every unit test (no Docker or database)
```

## Run

Needs Node.js (see `.nvmrc`), [go-task](https://taskfile.dev/installation/) and Docker.

```bash
task up      # MongoDB, API and web with demo data; prints the logins
task down
```

### One app on its own

Each app installs and runs from its own folder; no root `npm install` first. `dev`, `build`, `test`
and `typecheck` build `packages/shared` before they run.

```bash
cd apps/api && npm install && npm run dev   # needs MongoDB at MONGO_URI (copy .env.example to .env)
cd apps/web && npm install && npm run dev   # http://localhost:4200
```

## Conventions

- Template text is marked `i18n`; server-side text lives in `apps/api/src/messages.ts` and
  `packages/shared/src/messages.ts`.
- Tenant data goes through the tenant repository, picked from the request Origin; every index leads
  with `companyId`.
- Quotes (with sales tax) are copied into each revision and never change; an agreement's total comes
  from the signed revision.
- Each signature stores the SHA-256 of the signed content. A signing link alone opens nothing: it
  needs its code.
