import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  ChangeError,
  diffSelections,
  proposalCreateSchema,
  signSchema,
} from '../src/index.js';

const contents = (id: string) => ({ chef: ['quartz', 'island'] })[id];

describe('applyChanges', () => {
  const base = { kitchen: { packageId: 'chef' }, exterior: { itemIds: ['stone', 'shutters'] } };

  it('switches, removes and adds without touching the original', () => {
    const next = applyChanges(base, [
      { type: 'set_package', areaSlug: 'kitchen', packageId: 'gourmet' },
      { type: 'remove_item', areaSlug: 'exterior', itemId: 'shutters' },
      { type: 'add_item', areaSlug: 'garage', itemId: 'heater' },
    ]);
    expect(next).toEqual({
      kitchen: { packageId: 'gourmet' },
      exterior: { itemIds: ['stone'] },
      garage: { itemIds: ['heater'] },
    });
    expect(base.exterior.itemIds).toEqual(['stone', 'shutters']);
  });

  it('removing the last item or the package clears the area', () => {
    expect(
      applyChanges(base, [
        { type: 'remove_package', areaSlug: 'kitchen' },
        { type: 'remove_item', areaSlug: 'exterior', itemId: 'stone' },
        { type: 'remove_item', areaSlug: 'exterior', itemId: 'shutters' },
      ]),
    ).toEqual({});
  });

  it('item changes in a package area break the package into its items', () => {
    expect(
      applyChanges(
        base,
        [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' }],
        contents,
      ),
    ).toEqual({
      ...base,
      kitchen: { itemIds: ['quartz'] },
    });
    expect(
      applyChanges(base, [{ type: 'add_item', areaSlug: 'kitchen', itemId: 'pantry' }], contents)
        .kitchen,
    ).toEqual({
      itemIds: ['quartz', 'island', 'pantry'],
    });
    expect(() =>
      applyChanges(base, [{ type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' }]),
    ).toThrow(ChangeError);
  });

  it('refuses changes that do not apply', () => {
    for (const change of [
      { type: 'remove_item', areaSlug: 'exterior', itemId: 'pool' },
      { type: 'add_item', areaSlug: 'exterior', itemId: 'stone' },
      { type: 'remove_package', areaSlug: 'exterior' },
      { type: 'remove_item', areaSlug: 'kitchen', itemId: 'pool' },
    ] as const) {
      expect(() => applyChanges(base, [change], contents)).toThrow(ChangeError);
    }
  });
});

describe('diffSelections', () => {
  const base = { kitchen: { packageId: 'chef' }, exterior: { itemIds: ['stone', 'shutters'] } };
  const roundTrip = (next: Parameters<typeof applyChanges>[0]) => {
    const changes = diffSelections(base, next, contents);
    expect(applyChanges(base, changes, contents)).toEqual(next);
    return changes;
  };

  it('describes package switches, removals and item edits', () => {
    expect(
      roundTrip({ kitchen: { packageId: 'gourmet' }, exterior: { itemIds: ['stone'] } }),
    ).toEqual([
      { type: 'set_package', areaSlug: 'kitchen', packageId: 'gourmet' },
      { type: 'remove_item', areaSlug: 'exterior', itemId: 'shutters' },
    ]);
    expect(roundTrip({})).toEqual([
      { type: 'remove_package', areaSlug: 'kitchen' },
      { type: 'remove_item', areaSlug: 'exterior', itemId: 'stone' },
      { type: 'remove_item', areaSlug: 'exterior', itemId: 'shutters' },
    ]);
  });

  it('editing items inside a package is expressed against its contents', () => {
    expect(roundTrip({ ...base, kitchen: { itemIds: ['quartz', 'pantry'] } })).toEqual([
      { type: 'remove_item', areaSlug: 'kitchen', itemId: 'island' },
      { type: 'add_item', areaSlug: 'kitchen', itemId: 'pantry' },
    ]);
    expect(
      diffSelections(base, { ...base, kitchen: { itemIds: ['quartz', 'island'] } }, contents),
    ).toEqual([]);
    expect(diffSelections(base, base, contents)).toEqual([]);
  });
});

describe('proposal requests', () => {
  it('a proposal starts from a floor plan or a pre-existing home, not both', () => {
    expect(proposalCreateSchema.safeParse({ houseId: 'h', buyer: {} }).success).toBe(true);
    expect(proposalCreateSchema.safeParse({ inventoryHomeId: 'i', buyer: {} }).success).toBe(true);
    expect(
      proposalCreateSchema.safeParse({ houseId: 'h', inventoryHomeId: 'i', buyer: {} }).success,
    ).toBe(false);
    expect(proposalCreateSchema.safeParse({ buyer: {} }).success).toBe(false);
  });

  it('signing needs a full name and explicit agreement', () => {
    expect(
      signSchema.safeParse({ revision: 1, fullName: 'Robin Buyer', agree: true }).success,
    ).toBe(true);
    expect(
      signSchema.safeParse({ revision: 1, fullName: 'Robin Buyer', agree: false }).success,
    ).toBe(false);
    expect(signSchema.safeParse({ revision: 1, fullName: 'R', agree: true }).success).toBe(false);
  });
});
