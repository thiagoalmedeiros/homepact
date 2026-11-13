const proposal = (id: string) => `/proposals/${id}`;
const agreement = (id: string) => `/agreements/${id}`;
const payment = (agreementId: string, id: string) => `${agreement(agreementId)}/payments/${id}`;
const house = (id: string) => `/admin/houses/${id}`;
const company = (id: string) => `/platform/companies/${id}`;

export const API = {
  tenant: '/tenant',
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
  },
  access: {
    session: '/access/session',
    claim: '/access/claim',
  },
  accessKeys: {
    rotate: (keyId: string) => `/admin/access-keys/${keyId}/rotate`,
  },
  users: {
    list: '/users',
    one: (id: string) => `/users/${id}`,
  },
  catalog: {
    all: '/catalog',
    areas: '/catalog/areas',
    area: (slug: string) => `/catalog/areas/${slug}`,
    items: '/catalog/items',
    item: (id: string) => `/catalog/items/${id}`,
    packages: '/catalog/packages',
    package: (id: string) => `/catalog/packages/${id}`,
  },
  houses: {
    list: '/admin/houses',
    one: house,
    detail: (id: string) => `${house(id)}/detail`,
    quote: (id: string) => `${house(id)}/quote`,
    publish: (id: string) => `${house(id)}/publish`,
    unpublish: (id: string) => `${house(id)}/unpublish`,
  },
  inventory: {
    list: '/inventory',
    one: (id: string) => `/inventory/${id}`,
  },
  proposals: {
    list: '/proposals',
    quote: '/proposals/quote',
    one: proposal,
    options: (id: string) => `${proposal(id)}/options`,
    messages: (id: string) => `${proposal(id)}/messages`,
    revisions: (id: string) => `${proposal(id)}/revisions`,
    previewRevision: (id: string) => `${proposal(id)}/revisions/preview`,
    lock: (id: string) => `${proposal(id)}/lock`,
    withdraw: (id: string) => `${proposal(id)}/withdraw`,
    sign: (id: string) => `${proposal(id)}/sign`,
    decline: (id: string) => `${proposal(id)}/decline`,
    changeRequests: (id: string) => `${proposal(id)}/change-requests`,
    previewChanges: (id: string) => `${proposal(id)}/change-requests/preview`,
    withdrawRequest: (id: string, requestId: string) =>
      `${proposal(id)}/change-requests/${requestId}/withdraw`,
    decide: (id: string, requestId: string) =>
      `${proposal(id)}/change-requests/${requestId}/decision`,
  },
  agreementTemplates: {
    list: '/agreement-templates',
    one: (id: string) => `/agreement-templates/${id}`,
  },
  agreements: {
    list: '/agreements',
    one: agreement,
    pdf: (id: string) => `${agreement(id)}/pdf`,
    issue: (id: string) => `${agreement(id)}/issue`,
    invite: (id: string, purchaserId: string) =>
      `${agreement(id)}/purchasers/${purchaserId}/invite`,
    sign: (id: string) => `${agreement(id)}/sign`,
    countersign: (id: string) => `${agreement(id)}/countersign`,
    cancel: (id: string) => `${agreement(id)}/cancel`,
  },
  payments: {
    ledger: (agreementId: string) => `${agreement(agreementId)}/payments`,
    one: payment,
    approve: (agreementId: string, id: string) => `${payment(agreementId, id)}/approve`,
    reject: (agreementId: string, id: string) => `${payment(agreementId, id)}/reject`,
    withdraw: (agreementId: string, id: string) => `${payment(agreementId, id)}/withdraw`,
    void: (agreementId: string, id: string) => `${payment(agreementId, id)}/void`,
    receipt: (agreementId: string, id: string) => `${payment(agreementId, id)}/receipt`,
    queue: '/agreement-payments',
  },
  taxPresets: '/tax-presets',
  taxRates: {
    list: '/tax-rates',
    adopt: '/tax-rates/adopt',
    one: (id: string) => `/tax-rates/${id}`,
  },
  marketRates: {
    mortgage: '/market-rates/mortgage',
  },
  referralPrograms: {
    list: '/referral-programs',
    one: (id: string) => `/referral-programs/${id}`,
  },
  platform: {
    companies: '/platform/companies',
    company,
    admins: (id: string) => `${company(id)}/admins`,
    taxPresets: '/platform/tax-presets',
    taxPreset: (id: string) => `/platform/tax-presets/${id}`,
    starterTaxPresets: '/platform/tax-presets/starter',
  },
} as const;
