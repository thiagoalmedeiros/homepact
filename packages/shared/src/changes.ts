import { CHANGE_ERRORS } from './messages.js';
import type { Selections } from './quote.js';

export type Change =
  | { type: 'remove_item'; areaSlug: string; itemId: string }
  | { type: 'add_item'; areaSlug: string; itemId: string }
  | { type: 'set_package'; areaSlug: string; packageId: string }
  | { type: 'remove_package'; areaSlug: string };

export class ChangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangeError';
  }
}

/** Applies buyer changes to a selection. An item change in a package area breaks the package
 * into its items, using `packageItems`. */
export const applyChanges = (
  selections: Selections,
  changes: Change[],
  packageItems?: (packageId: string) => string[] | undefined,
): Selections => {
  const next: Selections = structuredClone(selections);
  const itemsOf = (areaSlug: string): string[] => {
    const current = next[areaSlug];
    if (!current) return [];
    if ('itemIds' in current) return current.itemIds;
    const contents = packageItems?.(current.packageId);
    if (!contents) throw new ChangeError(CHANGE_ERRORS.breakPackageFirst);
    return contents;
  };
  for (const c of changes) {
    const current = next[c.areaSlug];
    switch (c.type) {
      case 'set_package':
        next[c.areaSlug] = { packageId: c.packageId };
        break;
      case 'remove_package':
        if (!current || !('packageId' in current)) throw new ChangeError(CHANGE_ERRORS.noPackage);
        delete next[c.areaSlug];
        break;
      case 'add_item': {
        const items = itemsOf(c.areaSlug);
        if (items.includes(c.itemId)) throw new ChangeError(CHANGE_ERRORS.alreadyIncluded);
        next[c.areaSlug] = { itemIds: [...items, c.itemId] };
        break;
      }
      case 'remove_item': {
        const items = itemsOf(c.areaSlug);
        if (!items.includes(c.itemId)) throw new ChangeError(CHANGE_ERRORS.notInHome);
        const left = items.filter((id) => id !== c.itemId);
        if (left.length) next[c.areaSlug] = { itemIds: left };
        else delete next[c.areaSlug];
        break;
      }
    }
  }
  return next;
};

/** The changes that turn `base` into `next`; the inverse of {@link applyChanges}. */
export const diffSelections = (
  base: Selections,
  next: Selections,
  packageItems: (packageId: string) => string[] | undefined,
): Change[] => {
  const changes: Change[] = [];
  const areas = [...new Set([...Object.keys(base), ...Object.keys(next)])];
  for (const areaSlug of areas) {
    const from = base[areaSlug];
    const to = next[areaSlug];
    if (to && 'packageId' in to) {
      if (!from || !('packageId' in from) || from.packageId !== to.packageId) {
        changes.push({ type: 'set_package', areaSlug, packageId: to.packageId });
      }
      continue;
    }
    if (!to && from && 'packageId' in from) {
      changes.push({ type: 'remove_package', areaSlug });
      continue;
    }
    const before = !from
      ? []
      : 'itemIds' in from
        ? from.itemIds
        : (packageItems(from.packageId) ?? []);
    const after = to?.itemIds ?? [];
    const removed = before.filter((id) => !after.includes(id));
    const added = after.filter((id) => !before.includes(id));
    for (const itemId of removed) changes.push({ type: 'remove_item', areaSlug, itemId });
    for (const itemId of added) changes.push({ type: 'add_item', areaSlug, itemId });
  }
  return changes;
};
