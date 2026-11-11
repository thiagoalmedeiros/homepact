import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_FIELDS,
  agreementCountersignSchema,
  agreementCreateSchema,
  agreementSignSchema,
  agreementTemplateInputSchema,
  agreementFileName,
  AgreementStatus,
  fillTemplate,
  keyClauses,
  STARTER_AGREEMENT_TEMPLATE,
  unknownFields,
  type AgreementFieldValues,
} from '../src/index.js';

const values = Object.fromEntries(
  AGREEMENT_FIELDS.map((f) => [f.key, `<${f.key}>`]),
) as AgreementFieldValues;

describe('merge fields', () => {
  it('fills known fields, tolerating spaces inside the braces', () => {
    expect(
      fillTemplate('Sold by {{seller.name}} to {{ buyer.name }} for {{price.total}}.', values),
    ).toBe('Sold by <seller.name> to <buyer.name> for <price.total>.');
  });

  it('leaves unknown placeholders untouched and reports each one once', () => {
    const text = 'Hi {{buyer.nmae}}, {{buyer.nmae}} and {{ company.logo }}; {{buyer.name}}';
    expect(unknownFields(text)).toEqual(['buyer.nmae', 'company.logo']);
    expect(fillTemplate(text, values)).toBe(
      'Hi {{buyer.nmae}}, {{buyer.nmae}} and {{ company.logo }}; <buyer.name>',
    );
  });

  it('a value that looks like a placeholder is not filled again', () => {
    expect(
      fillTemplate('{{special.terms}}', { ...values, 'special.terms': '{{buyer.name}}' }),
    ).toBe('{{buyer.name}}');
  });

  it('the starter template only uses known fields and is a valid template', () => {
    const all = [
      STARTER_AGREEMENT_TEMPLATE.title,
      ...STARTER_AGREEMENT_TEMPLATE.sections.flatMap((s) => [s.heading, s.body]),
    ].join('\n');
    expect(unknownFields(all)).toEqual([]);
    expect(agreementTemplateInputSchema.safeParse(STARTER_AGREEMENT_TEMPLATE).success).toBe(true);
  });
});

describe('agreement schemas', () => {
  it('a template with a misspelled field is rejected at that field', () => {
    const r = agreementTemplateInputSchema.safeParse({
      name: 'Standard',
      title: 'Agreement for {{buyer.name}}',
      sections: [{ heading: 'Price', body: 'Price: {{price.totl}}' }],
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues).toEqual([
      expect.objectContaining({
        path: ['sections', 0, 'body'],
        message: 'Unknown field {{price.totl}}',
      }),
    ]);
  });

  it('templates need a name, a title and at least one section; isDefault defaults to false', () => {
    expect(
      agreementTemplateInputSchema.safeParse({ name: 'x', title: 't', sections: [] }).success,
    ).toBe(false);
    expect(
      agreementTemplateInputSchema.parse({
        name: ' x ',
        title: 't',
        sections: [{ heading: 'h', body: 'b' }],
      }),
    ).toEqual({
      name: 'x',
      title: 't',
      sections: [{ heading: 'h', body: 'b', requiresInitials: false }],
      isDefault: false,
    });
  });

  it('an agreement needs purchasers and a deposit schedule, on real calendar dates', () => {
    const base = {
      proposalId: 'p1',
      templateId: 't1',
      purchasers: [{ name: 'Jamie Okafor' }],
      deposits: [{ label: 'on signing', amountCents: 2_500_000 }],
    };
    const parsed = agreementCreateSchema.parse({ ...base, closingDate: '2027-02-28' });
    expect(parsed.conditions).toEqual([]);

    for (const closingDate of ['2027-02-30', '2027-2-1', 'soon']) {
      expect(agreementCreateSchema.safeParse({ ...base, closingDate }).success, closingDate).toBe(
        false,
      );
    }
    expect(agreementCreateSchema.safeParse({ ...base, purchasers: [] }).success).toBe(false);
    expect(agreementCreateSchema.safeParse({ ...base, purchasers: [{ name: 'J' }] }).success).toBe(
      false,
    );
    expect(agreementCreateSchema.safeParse({ ...base, deposits: [] }).success).toBe(false);
    for (const amountCents of [10.5, 0, -1]) {
      expect(
        agreementCreateSchema.safeParse({ ...base, deposits: [{ label: 'x', amountCents }] })
          .success,
        String(amountCents),
      ).toBe(false);
    }
    expect(
      agreementCreateSchema.parse({
        ...base,
        conditions: [{ label: ' Financing ', details: ' A mortgage. ', dueDate: '2027-02-01' }],
      }).conditions,
    ).toEqual([{ label: 'Financing', details: 'A mortgage.', dueDate: '2027-02-01' }]);
  });

  it('signing needs the content fingerprint, a name, the initials and explicit agreement', () => {
    const ok = {
      contentHash: 'a'.repeat(64),
      fullName: 'Jamie Okafor',
      initials: [1, 3],
      agree: true,
    };
    expect(agreementSignSchema.parse(ok).initials).toEqual([1, 3]);
    expect(agreementSignSchema.parse({ ...ok, initials: undefined }).initials).toEqual([]);
    expect(agreementSignSchema.safeParse({ ...ok, agree: false }).success).toBe(false);
    expect(agreementSignSchema.safeParse({ ...ok, contentHash: 'abc' }).success).toBe(false);
    expect(agreementSignSchema.safeParse({ ...ok, fullName: ' J ' }).success).toBe(false);
    expect(agreementCountersignSchema.safeParse(ok).success).toBe(true);
    expect(agreementCountersignSchema.safeParse({ ...ok, agree: false }).success).toBe(false);
  });
});

describe('agreement rules shared with the browser', () => {
  it('lists the clauses that must be initialled, by clause number', () => {
    expect(keyClauses([{}, { requiresInitials: true }, {}, { requiresInitials: true }])).toEqual([
      2, 4,
    ]);
    expect(keyClauses([{ requiresInitials: false }])).toEqual([]);
  });

  it('names a PDF after the agreement and what it is', () => {
    expect(agreementFileName('A-1', AgreementStatus.Draft)).toBe('A-1-draft.pdf');
    expect(agreementFileName('A-1', AgreementStatus.UnderReview)).toBe('A-1-for-signature.pdf');
    expect(agreementFileName('A-1', AgreementStatus.Executed)).toBe('A-1-executed.pdf');
    expect(agreementFileName('A-1', AgreementStatus.Cancelled)).toBe('A-1-void.pdf');
  });
});
