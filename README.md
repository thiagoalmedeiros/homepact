# Homepact

Negotiation system for new-home sales: proposals, change requests, purchase agreements,
signatures and the deposits paid against them, for many companies from one install.

## Test

```bash
npm run qa   # install, build the shared package, run every unit test (no Docker or database)
```

Needs the Node.js version in `.nvmrc`: the Angular CLI refuses older ones.

## Run

Needs Node.js (see `.nvmrc`), [go-task](https://taskfile.dev/installation/) and Docker.

```bash
task up      # MongoDB, API and web with demo data; prints the logins (seller, finance, buyers)
task down
```

### One app on its own

Each app installs and runs from its own folder; no root `npm install` first. `dev`, `build`, `test`
and `typecheck` build `packages/shared` before they run.

```bash
cd apps/api && npm install && npm run dev   # needs MongoDB at MONGO_URI (copy .env.example to .env)
cd apps/web && npm install && npm run dev   # http://localhost:4200
```

## Roles

| Role          | Works on                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Administrator | Everything sales does, plus the catalog, templates, team and countersignatures; can approve payments |
| Sales         | Proposals and agreements; records payments, which count once finance approves them                   |
| Finance       | Agreements (read only) and their payments: records, approves, rejects, voids and refunds             |
| Buyer         | Their proposals and agreements, the payments received and their receipts                             |

Someone signed in who opens a page that is not for them lands on their own home (finance on
Payments, sales on the console overview, buyers on their proposals); visitors are asked to sign in.

## Conventions

- Template text is marked `i18n`; server-side text lives in `apps/api/src/messages.ts` and
  `packages/shared/src/messages.ts`.
- Tenant data goes through the tenant repository, picked from the request Origin; every index leads
  with `companyId`.
- Quotes (with sales tax) are copied into each revision and never change; an agreement's total comes
  from the signed revision.
- Each signature stores the SHA-256 of the signed content. A signing link alone opens nothing: it
  needs its code.
- Payments live in their own ledger, outside the signed content, and are never deleted: a posted
  entry is voided with a reason and re-entered. Sales' entries count once finance (or an
  administrator) approves them. Every entry that counts has a PDF receipt, numbered with the
  entry's reference and rendered from it, so it never changes.
