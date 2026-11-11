import { readFile } from 'node:fs/promises';
import { expect, test, type Browser, type Page } from '@playwright/test';

const SECOND_SITE = process.env['E2E_SECOND_SITE'] ?? 'http://127.0.0.1:4200';
const ADMIN_SITE = process.env['E2E_ADMIN_SITE'] ?? 'http://localhost:4300';
const PASSWORD = process.env['SEED_DEMO_PASSWORD'] ?? 'Showcase2026!';
const ADMIN_EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@platform.demo';
const ADMIN_PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? PASSWORD;

const money = (text: string | null) => Number((text ?? '').replace(/[^0-9]/g, ''));
/** "$717,205" or "$810,441.65" → cents (whole-dollar amounts are shown without cents). */
const cents = (text: string | null) =>
  Math.round(Number((text ?? '').replace(/[^0-9.]/g, '')) * 100);

const signIn = async (page: Page, email: string, password = PASSWORD) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'));
};

/** The buyer is someone else: a fresh browser with no seller session. */
const asBuyer = async (browser: Browser, link: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(link);
  await page.waitForURL(/\/proposals\//);
  return { page, close: () => context.close() };
};

const createProposal = async (page: Page, buyer: string) => {
  await page.getByLabel('Buyer name').fill(buyer);
  await page.getByTestId('create-proposal').click();
  await expect(page.getByTestId('invite-sheet')).toContainText('Shown only once');
  const link = (await page.getByTestId('invite-link').textContent())?.trim() ?? '';
  expect(link).toMatch(/\/k\?key=[\w-]{43}$/);
  await page.getByTestId('invite-done').click();
  await expect(page).toHaveURL(/\/console\/proposals\/(?!new\b)[\w-]{8,}$/);
  return link;
};

/** Ticks every key clause of the agreement on screen. */
const initialKeyClauses = async (page: Page) => {
  const boxes = page.locator('[data-testid^="initial-"] input');
  await expect.poll(() => boxes.count()).toBeGreaterThan(0);
  for (const box of await boxes.all()) await box.check();
};

test.describe.serial('Example Homes negotiation', () => {
  const buyer = `E2E Buyer ${Date.now()}`;
  const coBuyer = `E2E Co-purchaser ${Date.now()}`;
  const signingLinks: { link: string; code: string }[] = [];
  let invite = '';
  let proposalUrl = '';
  let agreementId = '';

  test('the front door is invite-only: no public catalogue', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Example Homes');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Your home, agreed together',
    );
    await expect(page.getByLabel('Have an invite link?')).toBeVisible();
    await page.goto('/homes');
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('the seller sits with the buyer and builds a quote from packages', async ({ page }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await expect(page).toHaveURL(/\/console$/);
    await page.getByTestId('overview-new').click();
    await page.getByTestId('start-plan').click();
    await page.getByTestId('plan-alder').click();

    const total = page.getByTestId('builder-total');
    await expect(total).toContainText('$');
    const base = money(await total.textContent());
    await page.getByRole('radio', { name: /^Signature/ }).click();
    await expect.poll(async () => money(await total.textContent())).toBeGreaterThan(base);
    await page.getByRole('checkbox', { name: /Solar panel package/ }).click();
    await page.getByTestId('builder-continue').click();

    invite = await createProposal(page, buyer);
    proposalUrl = page.url();
    await expect(page.getByTestId('status')).toHaveText('Waiting for the buyer');
  });

  test('the buyer opens the invite, switches a package and removes an option', async ({
    browser,
  }) => {
    const { page, close } = await asBuyer(browser, invite);
    expect(page.url()).not.toContain('key=');
    await expect(page.getByTestId('buyer-status')).toHaveText('Ready for you to review');
    const before = money(await page.getByTestId('room-total').textContent());

    await page.getByTestId('request-changes').click();
    await page.getByRole('radio', { name: /^Designer/ }).click();
    await page.getByRole('checkbox', { name: /Solar panel package/ }).click();
    await expect(page.getByTestId('changed')).toHaveCount(2);
    await expect
      .poll(async () => money(await page.getByTestId('change-total').textContent()))
      .not.toBe(before);
    await page.getByTestId('review-changes').click();
    await expect(page.getByTestId('change-line')).toHaveCount(2);
    await page.getByLabel(/Note for/).fill('Designer finishes, and we will skip solar for now.');
    await page.getByTestId('send-request').click();
    await expect(page.getByTestId('waiting')).toContainText('Waiting for Jordan');
    await expect(page.getByTestId('open-sign')).toHaveCount(0);
    await close();
  });

  test('the buyer estimates their mortgage payments without leaving the proposal', async ({
    browser,
  }) => {
    const { page, close } = await asBuyer(browser, invite);
    await expect(page.getByTestId('mortgage-estimator')).toContainText('Estimate your payments');
    await expect(page.getByTestId('payment')).toContainText('$');
    await expect(page.getByTestId('insurance')).toHaveCount(0);
    await page.getByTestId('down-percent').evaluate((input: HTMLInputElement) => {
      input.value = '10';
      input.dispatchEvent(new Event('input'));
    });
    await expect(page.getByTestId('insurance')).toContainText('3.10%');
    await close();
  });

  test('the seller approves one change and declines the other', async ({ page }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await page.goto('/console/proposals');
    await page.getByRole('button', { name: /Needs review/ }).click();
    await page.getByRole('button', { name: new RegExp(buyer) }).click();
    await expect(page).toHaveURL(proposalUrl);
    const review = page.getByTestId('review');
    await expect(review).toContainText('Designer finishes, and we will skip solar');
    await page.getByTestId('decision-0').getByTestId('approve').click();
    await page.getByTestId('decision-1').getByTestId('decline').click();
    await page
      .getByTestId('decision-1')
      .getByRole('textbox')
      .fill('Solar is included in this promotion.');
    await page.getByTestId('send-answer').click();
    await expect(page.getByTestId('status')).toHaveText('Waiting for the buyer');
    await expect(page.getByText('Revision 2').first()).toBeVisible();
  });

  test('the buyer sees the answer and signs revision 2', async ({ browser }) => {
    const { page, close } = await asBuyer(browser, invite);
    const answered = page.getByTestId('answered');
    await expect(answered).toContainText('Solar is included in this promotion.');
    await expect(answered.getByTestId('change-line')).toHaveCount(2);
    await page.getByTestId('open-sign').click();
    await page.getByTestId('sign-name').fill(buyer);
    await page.getByTestId('sign-agree').check();
    await page.getByTestId('sign-submit').click();
    await expect(page.getByTestId('signed-banner')).toContainText('You signed this proposal');
    await expect(page.getByTestId('signed-banner')).toContainText('revision 2');
    await expect(page.getByTestId('request-changes')).toHaveCount(0);
    await close();
  });

  test('the seller prepares the purchase agreement and sends it to both purchasers', async ({
    page,
  }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await page.goto(proposalUrl);
    await page.getByTestId('prepare-agreement').click();
    await expect(page.getByTestId('terms-template')).toContainText('(default)');
    await expect(page.getByTestId('purchaser-name-0')).toHaveValue(buyer);
    await page.getByTestId('add-purchaser').click();
    await page.getByTestId('purchaser-name-1').fill(coBuyer);
    await page.getByTestId('deposit-amount-0').fill('15000');
    await page.getByTestId('add-deposit').click();
    await page.getByTestId('deposit-label-1').fill('on the 30th day');
    await page.getByTestId('deposit-amount-1').fill('10000');
    await page.getByTestId('condition-preset-0').click();
    await page.getByTestId('terms-closing').fill('2027-06-30');
    await expect(page.getByTestId('deposit-total')).toContainText('Deposit $25,000');
    await page.getByTestId('terms-submit').click();
    await expect(page).toHaveURL(/\/console\/agreements\/[\w-]{8,}$/);
    agreementId = page.url().split('/').at(-1)!;

    await expect(page.getByTestId('draft-banner')).toBeVisible();
    const doc = page.getByTestId('agreement-document');
    await expect(doc).toContainText(buyer);
    await expect(doc).toContainText(coBuyer);
    await expect(doc).toContainText('$25,000');
    await expect(doc).toContainText('June 30, 2027');
    await expect(doc).toContainText('Financing');
    const draft = page.waitForEvent('download');
    await page.getByTestId('download-pdf').click();
    expect((await draft).suggestedFilename()).toMatch(/^A-[\w-]+-draft\.pdf$/);

    await page.getByTestId('issue').click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('agreement-status')).toHaveText('Out for signature');
    const handouts = page.locator('[data-testid^="handout-"]');
    await expect(handouts).toHaveCount(2);
    for (const handout of await handouts.all()) {
      const link = (await handout.locator('[data-testid^="link-"]').textContent())?.trim() ?? '';
      const code = (await handout.locator('[data-testid^="code-"]').textContent())?.trim() ?? '';
      expect(link).toMatch(/\/k\?key=[\w-]{43}$/);
      expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      signingLinks.push({ link, code });
    }
  });

  test('each purchaser needs the link and the code, initials the key clauses and signs', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(signingLinks[0]!.link);
    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
    await page.getByTestId('signing-code').fill('ZZZZ-9999');
    await page.getByTestId('signing-code-submit').click();
    await expect(page.getByTestId('code-error')).toContainText('Invalid');

    await page.getByTestId('signing-code').fill(signingLinks[0]!.code);
    await page.getByTestId('signing-code-submit').click();
    await expect(page).toHaveURL(new RegExp(`/agreements/${agreementId}$`));
    await expect(page.getByTestId('to-sign')).toContainText('sent you this agreement');
    await expect(page.getByTestId('other-purchasers')).toContainText(coBuyer);

    await expect(page.getByTestId('open-sign-agreement')).toBeDisabled();
    await initialKeyClauses(page);
    await page.getByTestId('open-sign-agreement').click();
    await page.getByTestId('agreement-sign-name').fill(buyer);
    await page.getByTestId('agreement-sign-agree').check();
    await page.getByTestId('agreement-sign-submit').click();
    await expect(page.getByTestId('you-signed')).toContainText('You signed this agreement');
    await context.close();

    const second = await browser.newContext();
    const other = await second.newPage();
    await other.goto(signingLinks[1]!.link);
    await other.getByTestId('signing-code').fill(signingLinks[1]!.code);
    await other.getByTestId('signing-code-submit').click();
    await expect(other.getByTestId('to-sign')).toBeVisible();
    await initialKeyClauses(other);
    await other.getByTestId('open-sign-agreement').click();
    await other.getByTestId('agreement-sign-name').fill(coBuyer);
    await other.getByTestId('agreement-sign-agree').check();
    await other.getByTestId('agreement-sign-submit').click();
    await expect(other.getByTestId('agreement-signed')).toContainText('Every purchaser has signed');
    await second.close();
  });

  test('an authorised signer countersigns, and the executed PDF is kept', async ({ page }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await page.goto(`/console/agreements/${agreementId}`);
    await expect(page.getByTestId('signed-banner')).toContainText('Every purchaser has signed');
    await expect(page.getByTestId('countersign')).toHaveCount(0);

    await signIn(page, 'admin@example-homes.demo');
    await page.goto(`/console/agreements/${agreementId}`);
    await page.getByTestId('countersign').click();
    await page.getByTestId('countersign-agree').check();
    await page.getByTestId('countersign-submit').click();
    await expect(page.getByTestId('agreement-status')).toHaveText('Executed');
    await expect(page.getByTestId('executed-banner')).toContainText('certificate of signatures');

    const download = page.waitForEvent('download');
    await page.getByTestId('download-pdf').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/-executed\.pdf$/);
    const bytes = await readFile(await file.path());
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('a pre-existing home marked as built cannot be changed by the buyer', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'casey@example-homes.demo');
    await page.goto('/console/proposals/new');
    await page.getByTestId('start-home').click();
    await page.locator('[data-testid^="home-"]').first().click();
    await expect(page.getByTestId('lock-switch')).toBeChecked();
    await page.getByTestId('builder-continue').click();
    const link = await createProposal(page, `${buyer} (spec home)`);
    await expect(page.getByTestId('locked-pill')).toBeVisible();

    const room = await asBuyer(browser, link);
    await expect(room.page.getByTestId('locked-banner')).toContainText('offered as built');
    await expect(room.page.getByTestId('request-changes')).toHaveCount(0);
    await expect(room.page.getByTestId('open-sign')).toBeVisible();
    await room.close();
  });

  test('an administrator adds a province from the platform suggestions', async ({ page }) => {
    await signIn(page, 'admin@example-homes.demo');
    await page.goto('/console/taxes-referrals');
    await expect(page.getByTestId('rate-AB')).toContainText('Default');
    await page.getByTestId('open-suggestions').click();
    const ontario = page.getByTestId('suggestion-ON');
    await expect(ontario).toContainText('HST 13%');
    const use = ontario.getByRole('button', { name: 'Use' });
    if (await use.count()) await use.click();
    await expect(ontario).toContainText('Added');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rate-ON')).toContainText('HST 13%');
    await expect(page.getByTestId('referral-programs')).toContainText('Homeowner referral');
  });

  test('the seller prices in another province and records who referred the buyer', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await page.goto('/console/proposals/new?from=plan');
    await page.getByTestId('plan-alder').click();
    await expect(page.getByTestId('quote-tax')).toContainText('Alberta');
    await expect(page.getByTestId('quote-tax')).toContainText('GST (5%)');
    await page.getByTestId('builder-continue').click();
    await page.getByTestId('tax-region').selectOption('ON');
    await expect(page.getByTestId('quote-tax')).toContainText('HST (13%)');
    await page.getByTestId('referral-toggle').check();
    await page.getByTestId('referrer-name').fill('Dana Whitfield');
    await expect(page.getByTestId('quote-referral')).toContainText('referred by Dana Whitfield');
    const beforeTax = cents(await page.getByTestId('quote-before-tax').textContent());
    const total = cents(await page.getByTestId('quote-total').textContent());
    expect(total).toBe(beforeTax + Math.round((beforeTax * 13) / 100));
    const link = await createProposal(page, `${buyer} (referral)`);
    await expect(page.getByTestId('quote-referral')).toContainText('Dana Whitfield');

    const room = await asBuyer(browser, link);
    await expect(room.page.getByTestId('room-tax-note')).toContainText('Ontario');
    await expect(room.page.getByTestId('quote-tax').first()).toContainText('HST (13%)');
    await expect(room.page.getByTestId('quote-referral').first()).toContainText(
      'Homeowner referral',
    );
    await room.close();
  });

  test('a replaced invite link stops working', async ({ page, browser }) => {
    await signIn(page, 'jordan@example-homes.demo');
    await page.goto('/console/proposals/new?from=plan');
    await page.getByTestId('plan-alder').click();
    await page.getByTestId('builder-continue').click();
    const link = await createProposal(page, `${buyer} (rotate)`);
    await page.getByRole('button', { name: 'New invite link' }).click();
    await page.getByTestId('confirm').click();
    await expect(page.getByTestId('invite-sheet')).toBeVisible();
    await page.getByTestId('invite-done').click();

    const other = await browser.newContext();
    const fresh = await other.newPage();
    await fresh.goto(link);
    await expect(fresh.getByText("This link doesn't work")).toBeVisible();
    await other.close();
  });

  test("another company's site cannot open Example Homes proposals", async ({ page }) => {
    const id = proposalUrl.split('/').at(-1);
    await page.goto(`${SECOND_SITE}/proposals/${id}`);
    await expect(page).toHaveTitle('Northwind Homes');
    await expect(
      page.getByRole('heading', { name: "This proposal isn't available" }),
    ).toBeVisible();
    await page.goto(`${SECOND_SITE}/login`);
    await page.getByLabel('Email').fill('jordan@example-homes.demo');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  });

  test("another company's site cannot open Example Homes agreements or templates", async ({
    page,
  }) => {
    await page.goto(`${SECOND_SITE}/agreements/${agreementId}`);
    await expect(page).toHaveTitle('Northwind Homes');
    await expect(
      page.getByRole('heading', { name: "This agreement isn't available" }),
    ).toBeVisible();

    await page.goto(`${SECOND_SITE}/login`);
    await page.getByLabel('Email').fill('admin@northwind.demo');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'));
    await page.goto(`${SECOND_SITE}/console/agreements/templates`);
    await expect(page.getByTestId('template-Northwind purchase contract')).toBeVisible();
    await expect(page.getByText('Quick possession home')).toHaveCount(0);
    await page.goto(`${SECOND_SITE}/console/agreements/${agreementId}`);
    await expect(page.getByText("Couldn't load this right now.")).toBeVisible();
  });

  test('platform console lists both companies', async ({ page }) => {
    await page.goto(`${ADMIN_SITE}/login`);
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Example Homes/ }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /Northwind Homes/ }).first()).toBeVisible();
  });

  test('a buyer account sees its proposals on a phone @mobile', async ({ page }) => {
    await signIn(page, 'taylor@example.com');
    await expect(page).toHaveURL(/\/proposals$/);
    await page.locator('a.proposal').first().click();
    await expect(page.getByTestId('room-total')).toContainText('$');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
