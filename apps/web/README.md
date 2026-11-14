# @homepact/web

Angular web UI, deployed unchanged for every company. Run with `npm install && npm run dev` here, or `npm run dev -w apps/web` from the repo root.

- `public/config.json`: runtime API URL (`{ "apiBaseUrl": "http://localhost:3000" }`); nginx
  generates it from `API_PUBLIC_URL` in containers, and so does `npm run preview`, which serves the
  last `npm run build` like nginx does (on `WEB_PORT` and `ADMIN_PORT`) with no Docker.
- `src/styles.scss`: the design system (tokens, light/dark, buttons, forms, sheets) and layout
  helpers: `.truncate` (one line with an ellipsis; put the full text in `title`), `.clamp-2`,
  `.hide-sm` and `.only-sm`.
- `src/app/features`: the buyer site (`buyer`, `key-access`, `auth`), the company `console`
  (sales, finance and administrators, payments included) and the `platform` console.
  `src/app/shared` holds building blocks used by both.
- Every `@angular/*` package is pinned to an exact version, and they are upgraded together: the
  framework packages require each other's exact version, and a `^` on `@angular/build` or
  `@angular/cli` let their peers install a second, newer framework next to the pinned one.
  `npm ls @angular/core` must show a single version.

## Conventions

**One component, three files.** Every component has `name.ts` (logic), `name.html` (template) and,
when it has styles, `name.scss`. No inline `template:` or `styles:`.

**All text is translatable, with Angular's standard i18n (`@angular/localize`).** In templates,
mark text with `i18n` and a custom ID (the IDs are stable for translators):

```html
<h1 i18n="@@console.team.title">Team</h1>
<p i18n="@@room.waitingBody">
  You asked for {cr.changes.length, plural, =1 {1 change} other {{{ cr.changes.length }} changes}}
  {{ cr.createdAt | ago }}.
</p>
<input placeholder="Paste your link" i18n-placeholder="@@landing.invitePlaceholder" />
```

In TypeScript (toasts, confirmations, route titles, labels built in code, and attributes that
contain a value), use `$localize` with the same ID style and named placeholders:

```ts
this.toast.success($localize`:@@room.toasts.sentTo:Sent to ${rep}:rep: for review`);
```

`npm test -w apps/web` runs `scripts/check-templates.mjs` first, which fails on template text or a
`placeholder` / `title` / `alt` / `aria-label` that is not marked for translation.

**Constants, not string literals,** for API endpoints (`core/api-endpoints.ts`, `API.proposals.one(id)`)
and page paths (`core/app-paths.ts`, `PATHS.console.proposal(id)`).

**Values from `@homepact/shared` come from its zod-free entries** (`/enums`, `/format`, `/changes`,
`/agreement-fields`, `/mortgage`, `/payment-schedule`); the root entry is for types only, so the
schemas never ship to the browser. ESLint enforces it.

**Access by role.** Routes use the guards in `core/guards.ts`: `teamGuard` (the console),
`sellSideGuard` (console pages finance does not use), `buyerGuard` and `superAdminGuard`. Someone
signed in without access goes to `AuthService.home()` for their role; a visitor goes to sign in.
What a page shows follows the same roles (`isStaff`, `isFinance`, `managesPayments`).

## Translations

- The source locale is `en-CA` (`angular.json` → `i18n.sourceLocale`), served at the site root.
  Builds inline the messages at compile time (`"localize": true`), and Angular's `LOCALE_ID`
  follows the build's locale: the `localDate`, `money` and `ago` pipes format with it.
- `npm run i18n:extract -w apps/web` writes every message to `src/locale/messages.xlf` (XLIFF 1.2),
  the file translators work from. Run it after changing text and commit the result.

To add a language, e.g. French:

1. Copy `src/locale/messages.xlf` to `src/locale/messages.fr-CA.xlf` and add a `<target>` to each
   `<trans-unit>` (usually done in a translation tool).
2. Register it in `angular.json` under `projects.web.i18n.locales`:
   `"fr-CA": { "translation": "src/locale/messages.fr-CA.xlf", "subPath": "fr" }`.
3. `ng build` then emits one app per locale: English at `/`, French at `/fr/` (with its own
   `<base href>`). Serve `/fr/*` from `fr/index.html` in nginx, and link between the two.

Text that comes from the server (API error messages, proposal system messages, agreement PDFs)
is produced by the API in English; see `apps/api/src/messages.ts`.
