# Homepact

Negotiation system for new-home sales: the seller builds a proposal with the buyer, the buyer
requests changes, the seller answers each one, and the buyer signs. The signed proposal then
becomes a purchase agreement that both parties sign.

Guides for company administrators and sales reps are in the [knowledge base](kb/README.md).

## Test

```bash
npm run qa   # install dependencies, build the shared package, run every unit test (shared, API, web)
```

Needs only Node.js (version in `.nvmrc`); no Docker or database. Exits non-zero if any test fails.
After the first run, `npm test` alone is enough.

## Run

Requires Node.js (version in `.nvmrc`), [go-task](https://taskfile.dev/installation/) and Docker.

```bash
task up      # build and start MongoDB, API and web with demo data
task test    # run all unit tests
task down    # stop (task down -- -v also deletes the data)
```

Open <http://localhost:4200/console> and sign in as `jordan@example-homes.demo` (seller) or
<http://localhost:4200> as `taylor@example.com` (buyer). The password is `Showcase2026!`.
`task up` prints every login and buyer invite link.

### Without Docker

You need a MongoDB (4.4 or later) reachable at `MONGO_URI` in `.env`.

```bash
cp .env.example .env                   # then point MONGO_URI at your MongoDB
npm install
npm run build -w packages/shared
npm run seed:showcase -w apps/api     # demo data; prints the logins and invite links
npm run dev -w apps/api               # API on :3000 (restarts on change)
npm run dev -w apps/web               # web on :4200
WEB_PORT=4300 npm run dev -w apps/web # platform console on :4300
npx playwright install chromium       # once
npm run e2e                           # end-to-end checks against the running stack
```

`npm run build` followed by `npm start -w apps/api` runs the compiled API instead. The API scripts
read the root `.env`, and variables already set in the environment take precedence.

## Conventions

- The web UI uses Angular's standard i18n (`@angular/localize`): template text is marked with
  `i18n="@@id"`, code uses `$localize`, and `npm run i18n:extract -w apps/web` produces the XLIFF
  file for translators. `npm test` checks that no template text is left unmarked.
- Server-side user-facing text lives in constants: `apps/api/src/messages.ts` and
  `packages/shared/src/messages.ts`.
- Components are split into `.ts`, `.html` and `.scss` files. See `apps/web/README.md`.
- Comments are documentation only: a doc comment of at most 3 lines at the declaration of a
  function, method or class. Variables, fields, types, templates, styles and config explain
  themselves through names. Tool directives (`eslint-disable-next-line`, `@ts-check`) stay.

## Sales tax and referrals

Every quote, proposal revision, agreement and agreement PDF shows the **price before tax**, the
**sales tax of the province** the home is priced in (one line per tax, e.g. GST 5% and QST
9.975%) and the **total**. The total is what the buyer pays: it is the amount the buyer signs
for, the amount the deposit schedule is checked against, and what the balance due on closing is
computed from.

**Suggestions from the platform.** The super-admin keeps a list of suggested rates per province
(platform console → _Sales tax suggestions_). It ships with the GST/HST/QST charged on the sale of
a new home in each Canadian province and territory (_Add Canadian provinces_ adds any that are
missing; the demo seed adds them all). They are suggestions to keep current, not tax advice, and
they leave out new housing rebates, which depend on the buyer and the price.

**Each company's rates.** A company administrator sets up the provinces the company sells in
(console → _Sales tax & referrals_): _Add from suggestions_ copies a suggestion into the company,
and _Add your own_ takes any rates (up to 4 taxes per province, rates with up to 3 decimals).
Copies are independent: editing a suggestion never changes a company's rates. One province is the
default; the first one added is. Sales staff see the rates but cannot change them.

**On a proposal.** A new proposal starts in the company's default province; the rep can pick
another one, or _No sales tax_. A revision the rep sends keeps the province unless they change it,
and the answer to a buyer's change request keeps it too, at the company's current rate for that
province. Tax is rounded to the cent per tax line. A province the company later removes keeps
pricing existing proposals at the rate they had. Proposals priced before sales tax existed show
no tax until the rep revises them with a province.

**Referral programs.** Administrators define programs on the same page: a name, a description
(e.g. the thank-you the referrer receives) and a credit to the buyer, which may be zero to only
record the referral. When someone referred the buyer, the rep records the program and the
referrer on the proposal; the credit comes off the price **before tax**. A proposal keeps the
credit it was given even if the program changes or ends later; ended programs cannot be applied to
new proposals.

**In agreements and PDFs.** Schedule A lists the referral credit, the price before tax, each tax
of the province and the total, sales tax included. Templates can use `{{price.beforeTax}}`,
`{{price.tax}}`, `{{price.taxDetails}}` ("GST 5% and QST 9.975%, Quebec"),
`{{referral.program}}`, `{{referral.referrer}}`, `{{referral.credit}}` and `{{referral.summary}}`;
`{{price.total}}` is the total with sales tax. The built-in starter template uses them; existing
templates keep their wording.

Rates and credits are copied into every revision's quote, so changing settings never changes a
proposal that was sent or an agreement that was prepared, and never changes an agreement's
fingerprint. The API: `POST /api/proposals/quote` prices a new proposal exactly as creating it
would; `POST /api/proposals/:id/revisions/preview` prices a revision before it is sent;
`/api/tax-rates`, `/api/referral-programs` and `/api/tax-presets` (read-only) for companies;
`/api/platform/tax-presets` for the super-admin. Company rates and programs are tenant collections
like proposals; suggestions are platform data every company can read.

## Mortgage estimate

Buyers of a company priced in CAD see **Estimate your payments** under the price in their
proposal room: down payment, rate, amortization (15–30 years) and payment frequency give the
payment, the mortgage and the interest. It runs in the browser: nothing the buyer types is sent.

- **Reference rate:** the banks' posted 5-year conventional rate from the Bank of Canada (series
  `V80691335`), with a 12-month trend line. `GET /api/market-rates/mortgage` serves it from the
  `marketRates` collection, refreshed at most every 12 hours; if the Bank is unreachable the last
  stored rate is served (retried after 10 minutes), or none and the buyer types a rate. The source
  is swappable: `createApp({ rates })`.
- **Canadian rules** (`packages/shared/src/mortgage.ts`, as of 2025): fixed rates compound
  semi-annually; minimum down payment 5% of the first $500,000 and 10% above, 20% from $1.5M;
  below 20% down, default insurance of 2.80–4.00% (+0.20% beyond 25 years) is added to the loan,
  and Ontario, Quebec and Saskatchewan charge sales tax on the premium, paid at closing.
- It is an estimate, not a financing offer, and says so; check the rules when they change.

## Purchase agreements

Once a buyer signs a proposal, the seller turns it into an agreement of purchase and sale:

1. **Prepare** (console → proposal → _Prepare agreement_): pick one of the company's templates,
   add the co-purchasers, set the deposit schedule (one line per instalment), the conditions, the
   closing date and any special terms. The options, their prices and the total are **copied from
   the revision the buyer signed** — they are never typed again, and the agreement total always
   matches that revision to the cent. The template's `{{fields}}` are filled from the signed
   revision, the company and those terms. The result is a **draft** only the company's team sees.
   For a pre-existing home, preparing the agreement **reserves** the home.
2. **Send for signature**: staff read the draft (on screen or as a PDF with a DRAFT watermark),
   edit it if needed, then _Send for signature_. Each purchaser gets their own private link and a
   short code; the console shows both once, for the rep to pass on (a new pair can be issued at
   any time, including after the agreement is executed, so a purchaser can come back for their
   copy).
3. **Purchasers sign**: a purchaser opens their link, types the code (the link alone opens
   nothing), reads the agreement, **initials every key clause** and signs by typing their name.
   Each signature records the name, the time, the IP address and the fingerprint of the content
   that was on screen. When the last purchaser signs, the agreement is _signed_ and waits for the
   company.
4. **Countersign**: an authorised signer of the builder — a company administrator — countersigns,
   which **executes** the agreement. Countersigning before every purchaser has signed is refused
   (409). Executing marks a pre-existing home as **sold**, stops the signing links, and stores the
   final PDF.

**Changing an agreement that is out for signature.** Staff can still change a clause or a term.
Doing so invalidates every signature already given: those purchasers are set back to "must sign
again" (their old signature is kept for the record but no longer counts), the agreement returns to
_out for signature_, and both parties see it in the proposal conversation.

**A price change voids the agreement.** The price only ever comes from the signed revision, so
re-pricing means sending a new revision of the proposal (console → proposal → new revision). That
voids the live agreement, invalidates its signatures, stops its signing links, puts a
pre-existing home back on the market and returns the proposal to negotiation. An executed
agreement closes the sale: it can no longer be re-priced, changed or cancelled.

Every send, signature and countersignature names the SHA-256 fingerprint of the content the signer
reviewed, so nobody can sign a version they haven't seen. A proposal has at most one live
agreement. Agreements copy the template text they were made from, so editing or deleting a
template never changes an existing agreement.

**The PDF and its certificate.** The executed PDF carries the agreement, Schedule A (the signed
configuration, the price, the deposit schedule and the conditions), every signature, and a
**certificate of signatures** page listing each signer: who signed, the time in UTC, the IP
address, the document fingerprint they signed and which service captured the signature. It is
generated once, when the agreement is executed, and stored in the database (the `agreementFiles`
collection of that company, bytes and SHA-256 together). Every later download — by the purchasers
or by the company — returns those exact bytes through the API.

**Signature services.** Signatures are collected behind `SignatureProvider`
(`apps/api/src/modules/agreements/signature-provider.ts`): it invites the signers, revokes
invitations and turns what a signer submitted into the evidence stored on the agreement. The
built-in provider uses the private links, the codes and a typed name. A hosted service such as
DocuSign would be another implementation, passed to `createApp({ signatures })`; the agreement
rules would not change. None is integrated today.

Administrators manage templates under _Agreements → Templates_, where each clause can be marked as
a **key clause** that purchasers must initial. The merge fields are listed in
`packages/shared/src/agreement-fields.ts`, and a misspelled field is rejected when the template is
saved. The built-in starting text is plain-language sample wording, not legal advice.

**Isolation per company.** Templates, agreements, signing links and stored PDFs are tenant
collections like proposals: they are only read and written through the tenant repository bound to
the request Origin's company, and every index leads with `companyId`. The seller on an agreement is
always the company that owns the Origin. PDFs are downloaded through the API (with the Origin and
session), never from a shared or public URL. Another company's site, staff or links get a 404 (or a
403 for a token from another origin).
