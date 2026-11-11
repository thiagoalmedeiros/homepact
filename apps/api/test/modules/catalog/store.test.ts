import { describe, expect, it } from 'vitest';
import { loadCatalog, toArea, toItem, toPackage } from '../../../src/modules/catalog/store.js';
import { areaDoc, itemDoc, packageDoc } from '../../support/fixtures.js';
import { mockRepo } from '../../support/mocks.js';

describe('catalog mappers', () => {
  it('toArea keeps the public fields and drops ids and company', () => {
    expect(toArea(areaDoc())).toEqual({ slug: 'kitchen', label: 'Kitchen', order: 1 });
    expect(toArea(areaDoc({ description: 'Cook here' }))).toEqual({
      slug: 'kitchen',
      label: 'Kitchen',
      order: 1,
      description: 'Cook here',
    });
  });

  it('toItem and toPackage expose _id as id without the company', () => {
    expect(toItem(itemDoc())).toEqual({
      id: 'item-island',
      areaSlug: 'kitchen',
      name: 'Island',
      priceCents: 500_000,
      soldSeparately: true,
    });
    expect(toPackage(packageDoc())).toEqual({
      id: 'pkg-signature',
      areaSlug: 'kitchen',
      name: 'Signature',
      itemIds: ['item-island', 'item-hood'],
      priceCents: 900_000,
    });
  });
});

describe('loadCatalog', () => {
  it('reads areas, items and packages through the repo, sorted for display', async () => {
    const repo = mockRepo();
    repo.col('areas').find.mockResolvedValue([areaDoc()]);
    repo.col('catalogItems').find.mockResolvedValue([itemDoc()]);
    repo.col('packages').find.mockResolvedValue([packageDoc()]);

    expect(await loadCatalog(repo)).toEqual({
      areas: [toArea(areaDoc())],
      items: [toItem(itemDoc())],
      packages: [toPackage(packageDoc())],
    });
    expect(repo.col('areas').find).toHaveBeenCalledWith({}, { sort: { order: 1, label: 1 } });
    expect(repo.col('catalogItems').find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
    expect(repo.col('packages').find).toHaveBeenCalledWith({}, { sort: { name: 1 } });
  });
});
