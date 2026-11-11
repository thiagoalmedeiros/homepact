export const VALIDATION = {
  slug: 'Lowercase letters, digits and dashes',
  origin: 'Must be an http(s) origin',
  wholeCents: 'Must be a whole number of cents',
  password: 'At least 8 characters',
  planOrHome: 'Choose a floor plan or a pre-existing home',
  isoDate: 'Use YYYY-MM-DD',
  calendarDate: 'Not a valid date',
  contentHash: 'Invalid content fingerprint',
  taxRateDecimals: 'Use at most 3 decimals, e.g. 9.975',
  regionCode: '2 to 6 letters or digits, e.g. ON',
  unknownField: (key: string) => `Unknown field {{${key}}}`,
} as const;

export const QUOTE_ERRORS = {
  unknownArea: (slug: string) => `Unknown area "${slug}"`,
  mixedSelection: (area: string) => `Choose a package or items in "${area}", not both`,
  packageNotInArea: (area: string) => `Package is not in "${area}"`,
  itemNotInArea: (area: string) => `Item is not in "${area}"`,
  notSoldSeparately: (item: string) => `${item} is only sold as part of a package`,
  negativeTotal: 'Total cannot be negative',
} as const;

export const CHANGE_ERRORS = {
  breakPackageFirst: 'Remove the package first, then pick individual items',
  noPackage: 'No package selected in this area',
  alreadyIncluded: 'Item already included',
  notInHome: 'Item is not part of this home',
} as const;

export const ORIGIN_ERRORS = {
  unsupportedScheme: (protocol: string) => `Unsupported origin scheme: ${protocol}`,
} as const;
