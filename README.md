# Homepact

Negotiation system for new-home sales: proposals, change requests, purchase agreements,
signatures and the deposits paid against them, for many companies from one install.

## Setup

Node.js 22 (`.nvmrc`; at least 22.22.3, which the Angular CLI requires) and the npm it ships with.
`.npmrc` sets `engine-strict`, so an older Node fails at install with a clear message. Nothing else:
no Docker and no MongoDB to install; the app starts its own database.

```bash
nvm install && nvm use   # Node 22
npm install              # one install at the root covers every package
```

The database is MongoDB 8.0's `mongod`, downloaded on the first run (~80 MB) and cached. Where it
cannot be downloaded or started (no network, unsupported platform), the app falls back on its own
to an in-memory database written in JavaScript (`apps/api/src/data/memory-db.ts`), which needs
nothing at all. `DB_ENGINE=memory` always uses it; `DB_ENGINE=mongod` never falls back. To have
`mongod` in a sandbox without network at run time, run `npm run mongo:download -w apps/api` while
it has network (or point `MONGOMS_SYSTEM_BINARY` at a local `mongod`). The end-to-end tests need
Chromium: `npm run e2e:install`, once.

## Run

```bash
npm run dev   # everything, with live reload: API restarts and web reloads on change
npm start     # everything, as in production: builds the web app and serves the build
```

Both start the database (see Setup), seed the showcase, print the logins (seller, finance, buyers, platform)
and serve the API on `:3000`, the company sites on `localhost:4200` (Example Homes) and
`127.0.0.1:4200` (Northwind, a second company) and the platform console on `localhost:4300`.
Ctrl+C stops everything. The data lives in memory and the next run starts fresh, unless
`MONGO_DATA_DIR` names a folder to keep it in (`MONGO_DATA_DIR=data/mongo npm run dev`, or set it
in `.env`); the seed then skips what is already there. `npm start -- --no-build` reuses the last
build.

One piece at a time, from the root or from the package folder (without `-w`):

| Command                         | Runs                                                                   |
| ------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev -w apps/api`       | API on its own MongoDB with the showcase, restarting on change         |
| `npm run dev -w apps/web`       | Angular dev server on `:4200` and `:4300`, reloading on change         |
| `npm run preview -w apps/web`   | the last `npm run build -w apps/web`, served as in production          |
| `npm run dev:mongo -w apps/api` | API on a MongoDB you run yourself at `MONGO_URI` (copy `.env.example`) |

## Test

```bash
npm run check        # lint, format check, typecheck and every unit test
npm test             # every unit test: shared, API (layers mocked, no database), web
npm run e2e:install  # once: the browser for the end-to-end tests
npm run e2e          # end-to-end tests; starts the app (as npm start) unless it is already up
npm run qa           # install, then check
```

One package at a time, from the root or from its folder (each builds `packages/shared` first):

| Package           | From the root         | From its folder | One file                                             |
| ----------------- | --------------------- | --------------- | ---------------------------------------------------- |
| `packages/shared` | `npm run test:shared` | `npm test`      | `npm test -- test/quote.test.ts`                     |
| `apps/api`        | `npm run test:api`    | `npm test`      | `npm test -- test/modules/payments/routes.test.ts`   |
| `apps/web`        | `npm run test:web`    | `npm test`      | `npm test -- --include src/app/shared/dates.spec.ts` |

`npm run typecheck` and `npm run build` work the same way, at the root (every package) or in a
package folder. From the root, `-w <folder>` runs any package script: `npm run build -w apps/web`.
A package installs on its own too: `cd apps/api && npm install` installs only what it needs.

With [go-task](https://taskfile.dev/installation/), `task --list` shows the same commands
(`task up`, `task dev`, `task e2e`, `task check`, `task test:api`, …).

### Containers (optional)

`infra/` and the Dockerfiles package the app for deployment; nothing above needs them.
`task docker:up` builds and starts MongoDB, API and web with the demo data, `npm run e2e` runs
against it, and `task docker:down` stops it.

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
