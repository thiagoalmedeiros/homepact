import { toOverrides } from './house-editor.page';

describe('house editor', () => {
  it('keeps only real per-plan prices: empty or catalog-equal values are dropped', () => {
    const catalog: Record<string, number> = { chef: 700_000, island: 300_000, quartz: 500_000 };
    expect(
      toOverrides({ chef: 12_000, island: null, quartz: 5_000, stone: '' }, (id) => catalog[id]),
    ).toEqual([{ refId: 'chef', priceCents: 1_200_000 }]);
  });
});
