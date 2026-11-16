import { readFile } from 'node:fs/promises';
import {
  expect,
  request as http,
  test,
  type APIRequestContext,
  type Browser,
  type Download,
  type Page,
} from '@playwright/test';

const SITE = process.env['E2E_SITE'] ?? 'http://localhost:4200';
const API = process.env['E2E_API'] ?? 'http://localhost:3000/api';
const PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? 'Showcase2026!';

/** The API as the company site calls it: every request carries the site's Origin. */
const api = async () => http.newContext({ extraHTTPHeaders: { Origin: SITE } });
const call = async <T>(
  ctx: APIRequestContext,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  token?: string,
  data?: unknown,
): Promise<T> => {
  const res = await ctx.fetch(`${API}${path}`, {
    method,
    ...(token && { headers: { Authorization: `Bearer ${token}` } }),
    ...(data !== undefined && { data }),
  });
  expect(res.ok(), `${method} ${path}: ${await res.text()}`).toBe(true);
  return (await res.json()) as T;
};
const login = async (ctx: APIRequestContext, email: string) =>
  (
    await call<{ accessToken: string }>(ctx, 'POST', '/auth/login', undefined, {
      email,
      password: PASSWORD,
    })
  ).accessToken;

/** An executed agreement of its own, so the test runs on a fresh seed or an app already in use:
 * proposed by sales, signed by the buyer, sent, signed by its purchaser and countersigned. */
const executedAgreement = async (buyer: string) => {
  const ctx = await api();
  const sales = await login(ctx, 'jordan@example-homes.demo');
  const houses = await call<{ id: string; status: string }[]>(ctx, 'GET', '/admin/houses', sales);
  const house = houses.find((h) => h.status === 'published')!;
  const { proposal, accessKey } = await call<{ proposal: { id: string }; accessKey: string }>(
    ctx,
    'POST',
    '/proposals',
    sales,
    { houseId: house.id, buyer: { name: buyer, email: 'e2e-buyer@example.com' } },
  );
  const guest = await call<{ accessToken: string }>(ctx, 'POST', '/access/session', undefined, {
    key: accessKey,
  });
  await call(ctx, 'POST', `/proposals/${proposal.id}/sign`, guest.accessToken, {
    revision: 1,
    fullName: buyer,
    agree: true,
  });
  const templates = await call<{ id: string; isDefault: boolean }[]>(
    ctx,
    'GET',
    '/agreement-templates',
    sales,
  );
  const draft = await call<{
    id: string;
    contentHash: string;
    sections: { requiresInitials?: boolean }[];
  }>(ctx, 'POST', '/agreements', sales, {
    proposalId: proposal.id,
    templateId: (templates.find((t) => t.isDefault) ?? templates[0]!).id,
    purchasers: [{ name: buyer, email: 'e2e-buyer@example.com' }],
    deposits: [{ label: 'on signing', amountCents: 1_000_000 }],
    closingDate: '2027-06-30',
  });
  const issued = await call<{ invitations: { key: string; code: string }[] }>(
    ctx,
    'POST',
    `/agreements/${draft.id}/issue`,
    sales,
    { contentHash: draft.contentHash },
  );
  const signer = await call<{ accessToken: string }>(ctx, 'POST', '/access/session', undefined, {
    key: issued.invitations[0]!.key,
    code: issued.invitations[0]!.code,
  });
  await call(ctx, 'POST', `/agreements/${draft.id}/sign`, signer.accessToken, {
    contentHash: draft.contentHash,
    fullName: buyer,
    initials: draft.sections.flatMap((s, i) => (s.requiresInitials ? [i + 1] : [])),
    agree: true,
  });
  const admin = await login(ctx, 'admin@example-homes.demo');
  await call(ctx, 'POST', `/agreements/${draft.id}/countersign`, admin, {
    contentHash: draft.contentHash,
    fullName: 'Morgan Reyes',
    agree: true,
  });
  await ctx.dispose();
  return { agreementId: draft.id, buyerLink: `${SITE}/k?key=${accessKey}` };
};

/** Someone else on the same kind of device as the test (a phone in the mobile project). */
const another = async (browser: Browser) => {
  const context = await browser.newContext(test.info().project.use);
  return context.newPage();
};

const signIn = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
};

/** Nothing on screen, open sheets included, reaches past the right edge of the viewport; content
 * a scrolling strip (such as the console's navigation on a phone) clips is its own. */
const fitsTheScreen = async (page: Page) => {
  const spilled = await page.evaluate(() => {
    const edge = document.documentElement.clientWidth + 1;
    const clippedByScroller = (e: HTMLElement) => {
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        const style = getComputedStyle(p);
        if (style.overflowX !== 'visible' && p.getBoundingClientRect().right <= edge) return true;
      }
      return false;
    };
    return [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.right > edge && !clippedByScroller(e);
      })
      .map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`)
      .slice(0, 5);
  });
  expect(spilled, 'elements past the right edge').toEqual([]);
};

/** In an open sheet, no control sticks out of its row, every field is wide enough to read and
 * type in, and the sheet never scrolls sideways. */
const sheetFits = async (page: Page) => {
  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const name = (e: Element) =>
      `${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : ''}.${[...e.classList].join('.')}`;
    for (const dialog of document.querySelectorAll('dialog[open]')) {
      for (const scroller of [dialog, ...dialog.querySelectorAll('*')]) {
        const style = getComputedStyle(scroller);
        if (
          ['auto', 'scroll'].includes(style.overflowX) &&
          scroller.scrollWidth > scroller.clientWidth + 1
        ) {
          found.push(`${name(scroller)} scrolls sideways`);
        }
      }
      for (const control of dialog.querySelectorAll<HTMLElement>(
        'input, select, textarea, button',
      )) {
        const r = control.getBoundingClientRect();
        if (!r.width || !r.height || (control as HTMLInputElement).type === 'checkbox') continue;
        const parent = control.parentElement!.getBoundingClientRect();
        if (r.right > parent.right + 1) found.push(`${name(control)} sticks out of its row`);
        const isField = control.matches(
          'textarea, select, input:not([type=checkbox]):not([type=radio])',
        );
        if (isField && r.width < 96)
          found.push(`${name(control)} is ${Math.round(r.width)}px wide`);
      }
    }
    return found.slice(0, 5);
  });
  expect(problems, 'layout problems in the open sheet').toEqual([]);
};

/** Each change order has its own PDF: a draft until it is executed, kept as executed after. */
const pdfOf = async (download: Promise<Download>, suffix: 'draft' | 'executed') => {
  const file = await download;
  expect(file.suggestedFilename()).toMatch(
    new RegExp(`^CO-[A-Z0-9]{4}-[A-Z0-9]{4}-${suffix}\\.pdf$`),
  );
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  return bytes;
};

test('a change order from the buyer’s phone to its own executed PDF @mobile', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const buyer = `E2E Change ${Date.now()}`;
  const { agreementId, buyerLink } = await executedAgreement(buyer);

  // The buyer asks from the agreement room: a catalog option and a few words.
  await page.goto(buyerLink);
  await page.waitForURL(/\/proposals\//);
  await page.goto(`/agreements/${agreementId}`);
  await expect(page.getByTestId('change-orders')).toBeVisible();
  await fitsTheScreen(page);
  await page.getByTestId('request-change').click();
  const sheet = page.getByTestId('change-request');
  await sheet.locator('button[role=checkbox][aria-checked=false]').first().click();
  await expect(sheet.getByTestId('request-estimate')).toContainText('Estimated new price');
  await expect(sheet.getByTestId('request-estimate')).toContainText('sales tax included');
  await fitsTheScreen(page);
  await sheetFits(page);
  await sheet.getByTestId('request-note').fill('And a black front door, please');
  await sheet.getByTestId('request-submit').click();
  await expect(page.getByTestId('one-at-a-time')).toBeVisible();

  // Sales drafts it: keeps the option, adds a fee and an instalment, then signs and sends it.
  const sales = await another(browser);
  await signIn(sales, 'jordan@example-homes.demo');
  await sales.goto(`/console/agreements/${agreementId}`);
  const card = sales.locator('[data-testid^="change-order-"]').first();
  await card.locator('[data-testid^="draft-"]').click();
  const draft = sales.getByTestId('amendment-draft');
  await expect(draft).toContainText(`What ${buyer} asked for`);
  await draft.getByTestId('adjustments').locator('button.add').click();
  await draft.getByTestId('adjustments').locator('input').nth(0).fill('Black front door');
  await draft.getByTestId('adjustments').locator('input').nth(1).fill('850');
  await draft.getByRole('button', { name: 'Add an instalment' }).click();
  await draft.locator('.instalment input').nth(0).fill('Upgrade payment');
  await draft.locator('.instalment input').nth(1).fill('1000');
  await draft.getByTestId('draft-closing').fill('2027-07-15');
  await expect(draft.getByTestId('draft-approval')).toContainText('A fee or credit set by hand');
  await fitsTheScreen(sales);
  await sheetFits(sales);
  await draft.getByTestId('draft-save').click();
  await expect(draft).toBeHidden();
  await pdfOf(
    Promise.all([
      sales.waitForEvent('download'),
      card.locator('[data-testid^="download-"]').click(),
    ]).then(([d]) => d),
    'draft',
  );
  await card.locator('[data-testid^="send-"]').click();
  await sales.getByTestId('send-agree').check();
  await sales.getByTestId('send-submit').click();
  const link = (await sales.locator('[data-testid^="link-"]').first().textContent())!.trim();
  const code = (await sales.locator('[data-testid^="code-"]').first().textContent())!.trim();
  await fitsTheScreen(sales);
  await sheetFits(sales);

  // The purchaser reads it on their own link, keeps the draft PDF, and signs.
  const purchaser = await another(browser);
  await purchaser.goto(link);
  await purchaser.getByTestId('signing-code').fill(code);
  await purchaser.getByTestId('signing-code-submit').click();
  await expect(purchaser).toHaveURL(/\/change-orders\//);
  await expect(purchaser.getByTestId('to-sign')).toContainText('sent you this change order');
  await expect(purchaser.getByTestId('amendment-closing')).toContainText('July 15, 2027');
  await fitsTheScreen(purchaser);
  await pdfOf(
    Promise.all([
      purchaser.waitForEvent('download'),
      purchaser.getByTestId('download-pdf').click(),
    ]).then(([d]) => d),
    'draft',
  );
  await purchaser.getByTestId('open-sign').click();
  await sheetFits(purchaser);
  await purchaser.getByTestId('sign-agree').check();
  await purchaser.getByTestId('sign-submit').click();
  await expect(purchaser.getByTestId('awaiting-approval')).toBeVisible();

  // An administrator approves; the change order is executed and its PDF kept as executed.
  const admin = await another(browser);
  await signIn(admin, 'admin@example-homes.demo');
  await admin.goto(`/console/agreements/${agreementId}`);
  await admin.locator('[data-testid^="approve-"]').first().click();
  await admin.getByTestId('approve-agree').check();
  await admin.getByTestId('approve-submit').click();
  const approved = admin.locator('[data-testid^="change-order-"]').first();
  await expect(approved.getByTestId('amendment-status')).toHaveText('Executed');
  await fitsTheScreen(admin);
  const kept = await pdfOf(
    Promise.all([
      admin.waitForEvent('download'),
      approved.locator('[data-testid^="download-"]').click(),
    ]).then(([d]) => d),
    'executed',
  );

  // The buyer gets the same executed PDF, and sees the new price and schedule.
  await page.reload();
  const mine = page.locator('[data-testid^="change-order-"]').first();
  await expect(mine.getByTestId('amendment-status')).toHaveText('Executed');
  await expect(page.getByTestId('buyer-payments')).toContainText('Change order 1');
  await expect(page.getByTestId('buyer-payments')).toContainText('Upgrade payment');
  await fitsTheScreen(page);
  const theirs = await pdfOf(
    Promise.all([
      page.waitForEvent('download'),
      mine.locator('[data-testid^="download-"]').click(),
    ]).then(([d]) => d),
    'executed',
  );
  expect(theirs.equals(kept)).toBe(true);
});
