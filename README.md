# Homepact

Homepact is a proposal and contract negotiation tool for new-home sales. A home builder puts
together a proposal for a buyer (the lot, the house model, its options and the price), the buyer
asks for changes, the builder answers each one, and both sides end up with an agreed contract.

**Who it's for:** small home builders and their sales staff, and the buyers they work with.

**Status:** early. This repository currently holds the project foundation (monorepo, API, web
shell, tests, Docker setup) and a health endpoint. Features are being built on top of it.

## Built with

- **API:** Node.js, TypeScript, Express 5, MongoDB driver, Zod, Pino, Vitest
- **Web:** Angular 22 (standalone, zoneless), Vitest
- **Infra:** Docker Compose (MongoDB 8, API, nginx serving the web build)

## Project layout

```
apps/
  api/        Express API (GET /api/health)
  web/        Angular app (shows API status)
infra/
  docker-compose.yml
  nginx/      web container config (serves the app, proxies /api)
```

## Run it

You need Node.js 22.12 or newer (see `.nvmrc`). Docker is only needed for the full stack.

```bash
cp .env.example .env
npm install
```

**Full stack with Docker:**

```bash
docker compose --env-file .env -f infra/docker-compose.yml up --build
```

Open <http://localhost:4200>. The API answers at <http://localhost:3000/api/health>.

**Without Docker** (needs a MongoDB you can reach through `MONGO_URI` in `.env`):

```bash
npm run dev:api   # http://localhost:3000
npm run dev:web   # http://localhost:4200, proxies /api to the API
```

## Test and check

```bash
npm test            # API and web unit tests (no database needed)
npm run typecheck
npm run lint
npm run format:check
npm run build
```

## API

| Method | Path          | Description                                                   |
| ------ | ------------- | ------------------------------------------------------------- |
| GET    | `/api/health` | `200` with `status: "ok"` when MongoDB answers, `503` if not. |

## Data

Homepact only ever uses made-up sample data in this repository. No real buyer, customer or
financial information is stored here.

## License

[MIT](LICENSE)
