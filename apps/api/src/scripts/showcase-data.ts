import { Role, STARTER_AGREEMENT_TEMPLATE, type AgreementTemplateInput } from '@homepact/shared';

const UP = 'https://images.example.com/showcase';

export const SHOWCASE_COMPANY = {
  name: 'Example Homes',
  slug: 'example-homes',
  logoPath: '/demo/example-homes-logo.svg',
  tagline: 'New homes, negotiated together.',
  heroImageUrl: `${UP}/photo-01.jpg`,
  contact: {
    phone: '403-555-0100',
    email: 'sales@example.com',
    address: '100 Example Avenue SW, Calgary, AB',
    website: 'https://example.com',
  },
  team: [
    { name: 'Morgan Reyes', email: 'admin@example-homes.demo', role: Role.CompanyAdmin },
    { name: 'Jordan Blake', email: 'jordan@example-homes.demo', role: Role.CompanyStaff },
    { name: 'Casey Moreau', email: 'casey@example-homes.demo', role: Role.CompanyStaff },
    { name: 'Riley Chen', email: 'riley@example-homes.demo', role: Role.CompanyFinance },
  ],
  buyer: { name: 'Taylor Singh', email: 'taylor@example.com', phone: '403-555-0142' },
};

export interface SeedItem {
  key: string;
  area: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
}
export interface SeedPackage {
  key: string;
  area: string;
  name: string;
  description: string;
  imageUrl?: string;
  items: string[];
  price: number;
}

export const AREAS = [
  {
    slug: 'elevation',
    label: 'Exterior style',
    order: 0,
    description: 'Twelve architectural styles, each with its own palette of materials.',
  },
  {
    slug: 'interior',
    label: 'Interior finishes',
    order: 1,
    description: 'Every home starts with our Advantage specifications.',
  },
  {
    slug: 'main-floor',
    label: 'Main floor',
    order: 2,
    description: 'Layout options for the heart of the home.',
  },
  {
    slug: 'upper-floor',
    label: 'Upper floor',
    order: 3,
    description: 'Bedrooms, bonus space and retreats.',
  },
  {
    slug: 'basement',
    label: 'Basement',
    order: 4,
    description: 'Legal-suite availability varies by community and municipal regulations.',
  },
  {
    slug: 'energy',
    label: 'Energy & smart home',
    order: 5,
    description: 'Smart Energy components come standard; go further with these.',
  },
];

export const ITEMS: SeedItem[] = [
  { key: 'stucco-stone', area: 'elevation', name: 'Stucco & stone facade', price: 0 },
  { key: 'board-batten', area: 'elevation', name: 'Board & batten siding', price: 4_500 },
  { key: 'black-windows', area: 'elevation', name: 'Black window package', price: 3_900 },
  { key: 'timber', area: 'elevation', name: 'Timber accents', price: 3_200 },
  { key: 'steep-roof', area: 'elevation', name: 'Steep-pitch roofline', price: 4_800 },
  { key: 'brick', area: 'elevation', name: 'Brick facade', price: 6_900 },
  { key: 'flat-canopy', area: 'elevation', name: 'Flat-roof entry canopy', price: 2_400 },
  {
    key: 'quartz',
    area: 'interior',
    name: 'Quartz countertops',
    description: 'Kitchen and baths.',
    price: 6_900,
  },
  { key: 'lvp', area: 'interior', name: 'Luxury vinyl plank throughout', price: 5_400 },
  { key: 'cabinets', area: 'interior', name: 'Full-height shaker cabinetry', price: 7_800 },
  { key: 'backsplash', area: 'interior', name: 'Designer tile backsplash', price: 2_600 },
  { key: 'lighting', area: 'interior', name: 'Designer lighting package', price: 3_400 },
  { key: 'ceilings', area: 'interior', name: '9′ basement ceilings', price: 4_200 },
  {
    key: 'exec-kitchen',
    area: 'main-floor',
    name: 'Executive kitchen',
    description: 'Built-in wall oven, cooktop and a larger island.',
    imageUrl: `${UP}/photo-02.png`,
    price: 14_900,
  },
  {
    key: 'spice-kitchen',
    area: 'main-floor',
    name: 'Spice kitchen',
    description: 'A second, enclosed prep kitchen behind the main one.',
    imageUrl: `${UP}/photo-03.png`,
    price: 18_500,
  },
  {
    key: 'main-bed-bath',
    area: 'main-floor',
    name: 'Main-floor bedroom & full bath',
    description: 'Ideal for multi-generational living.',
    imageUrl: `${UP}/photo-04.png`,
    price: 16_900,
  },
  { key: 'open-below', area: 'main-floor', name: 'Open to below great room', price: 9_900 },
  {
    key: 'fourth-bed',
    area: 'upper-floor',
    name: '4th bedroom',
    description: 'Converts the bonus room into a bedroom.',
    imageUrl: `${UP}/photo-05.png`,
    price: 11_500,
  },
  { key: 'second-primary', area: 'upper-floor', name: 'Second primary suite', price: 19_900 },
  { key: 'balcony', area: 'upper-floor', name: 'Bonus room balcony', price: 6_900 },
  { key: 'side-entrance', area: 'basement', name: 'Separate side entrance', price: 12_900 },
  { key: 'suite-rough-in', area: 'basement', name: 'Legal suite rough-in', price: 24_900 },
  {
    key: 'suite-1',
    area: 'basement',
    name: '1-bedroom legal suite',
    description: 'Fully developed income suite.',
    imageUrl: `${UP}/photo-06.png`,
    price: 79_900,
  },
  {
    key: 'suite-2',
    area: 'basement',
    name: '2-bedroom legal suite',
    description: 'Fully developed income suite.',
    imageUrl: `${UP}/photo-07.png`,
    price: 94_900,
  },
  {
    key: 'basement-dev',
    area: 'basement',
    name: 'Basement development',
    description: 'Rec room, bedroom and full bath.',
    imageUrl: `${UP}/photo-08.png`,
    price: 54_900,
  },
  { key: 'solar', area: 'energy', name: 'Solar panel package', price: 15_900 },
  { key: 'ev', area: 'energy', name: 'EV charger rough-in', price: 1_250 },
  { key: 'smart-hub', area: 'energy', name: 'Smart home hub & locks', price: 2_400 },
  { key: 'triple-pane', area: 'energy', name: 'Triple-pane windows', price: 6_800 },
];

const style = (
  key: string,
  name: string,
  image: string,
  price: number,
  items: string[],
  description: string,
): SeedPackage => ({
  key,
  area: 'elevation',
  name,
  description,
  imageUrl: `${UP}/${image}`,
  items,
  price,
});

export const PACKAGES: SeedPackage[] = [
  style(
    'urban-prairie',
    'Urban Prairie',
    'style-50.png',
    0,
    ['stucco-stone', 'flat-canopy'],
    'Clean horizontal lines with stucco and stone.',
  ),
  style(
    'modern-prairie',
    'Modern Prairie',
    'style-51.png',
    6_500,
    ['stucco-stone', 'black-windows'],
    'Low-slung rooflines and crisp black windows.',
  ),
  style(
    'farmhouse',
    'Farmhouse',
    'style-52.png',
    8_900,
    ['board-batten', 'black-windows'],
    'Board and batten with a welcoming porch.',
  ),
  style(
    'craftsman',
    'Craftsman',
    'style-53.png',
    7_500,
    ['timber', 'stucco-stone'],
    'Tapered columns and warm timber detail.',
  ),
  style(
    'mid-century',
    'Mid-Century Modern',
    'style-54.png',
    9_500,
    ['flat-canopy', 'timber', 'black-windows'],
    'Bold geometry inspired by the 1950s.',
  ),
  style(
    'modern-tudor',
    'Modern Tudor',
    'style-55.png',
    11_000,
    ['steep-roof', 'brick', 'black-windows'],
    'Steep gables re-imagined in brick.',
  ),
  style(
    'mountain',
    'Mountain',
    'style-56.png',
    12_500,
    ['timber', 'stucco-stone', 'steep-roof'],
    'Heavy timber and stone, made for the Rockies view.',
  ),
  {
    key: 'advantage',
    area: 'interior',
    name: 'Advantage',
    description: 'Our standard specification, included in every home.',
    items: ['lvp'],
    price: 0,
  },
  {
    key: 'signature',
    area: 'interior',
    name: 'Signature',
    description: 'Quartz, full-height cabinetry and a tile backsplash.',
    items: ['quartz', 'cabinets', 'backsplash', 'lvp'],
    price: 19_900,
  },
  {
    key: 'designer',
    area: 'interior',
    name: 'Designer',
    description: 'Everything in Signature plus designer lighting and 9′ basement ceilings.',
    items: ['quartz', 'cabinets', 'backsplash', 'lvp', 'lighting', 'ceilings'],
    price: 27_900,
  },
  {
    key: 'income-ready',
    area: 'basement',
    name: 'Income Suite Ready',
    description: 'Side entrance plus legal-suite rough-in, ready to finish later.',
    imageUrl: `${UP}/photo-09.png`,
    items: ['side-entrance', 'suite-rough-in'],
    price: 34_900,
  },
];

export interface SeedHouse {
  name: string;
  slug: string;
  style: string;
  headline: string;
  description: string;
  sqft: number;
  beds: number;
  baths: number;
  garage: number;
  storeys: number;
  price: number;
  images: string[];
  floorPlans: string[];
  communities: string[];
  published: boolean;
  scale?: number;
}

const WIDE = [
  'Amber Hills',
  'Stone Ford',
  'Fernwood',
  'Larkspur',
  'Oak Hollow',
  'Meadow Ranch',
  'Elm Park',
  'Brookside',
  'Heron Landing',
  'Fir Creek',
  'Windmere',
  'Sunvale',
  'Summit Rise',
  'Copper Hill',
];

export const HOUSES: SeedHouse[] = [
  {
    name: 'Alder',
    slug: 'alder',
    style: 'Front Attached Garage',
    sqft: 2220,
    beds: 3,
    baths: 2.5,
    garage: 2,
    storeys: 2,
    price: 699_305,
    headline: 'The family favourite, with a bonus room that grows with you.',
    description:
      'A 997 ft² main floor flows from a chef-inspired kitchen into the great room. Upstairs, 1,223 ft² holds three bedrooms, a central bonus room and a primary retreat with walk-in closet. Option it with a fourth bedroom, spice kitchen or a legal basement suite.',
    images: [
      `${UP}/photo-10.jpg`,
      `${UP}/photo-11.jpg`,
      `${UP}/photo-12.jpg`,
      `${UP}/photo-13.jpg`,
    ],
    floorPlans: [`${UP}/photo-14.png`, `${UP}/photo-15.png`],
    communities: WIDE,
    published: true,
  },
  {
    name: 'Cedar',
    slug: 'cedar',
    style: 'Front Attached Garage',
    sqft: 2398,
    beds: 4,
    baths: 2.5,
    garage: 2,
    storeys: 2,
    price: 740_122,
    headline: 'Four bedrooms up, and a balcony to watch the sunset.',
    description:
      'Cedar pairs an open main floor with a flexible upper level: four bedrooms, or three with a private balcony. A basement porch entry makes a future legal suite simple.',
    images: [
      `${UP}/photo-16.jpg`,
      `${UP}/photo-17.jpg`,
      `${UP}/photo-18.jpg`,
      `${UP}/photo-19.jpg`,
    ],
    floorPlans: [`${UP}/photo-20.png`, `${UP}/photo-21.png`],
    communities: [...WIDE, 'Ridgeview Park', 'South Glen', 'Westbury'],
    published: true,
    scale: 1.05,
  },
  {
    name: 'Maple',
    slug: 'maple',
    style: 'Front Attached Garage',
    sqft: 2534,
    beds: 4,
    baths: 2.5,
    garage: 2,
    storeys: 2,
    price: 773_981,
    headline: 'Space to gather, space to retreat.',
    description:
      'Maple’s generous footprint delivers a dedicated flex room, a walk-through pantry and four bedrooms upstairs, including a primary suite with a spa-like ensuite.',
    images: [
      `${UP}/photo-22.jpg`,
      `${UP}/photo-23.jpg`,
      `${UP}/photo-24.jpg`,
      `${UP}/photo-25.jpg`,
    ],
    floorPlans: [`${UP}/photo-26.png`, `${UP}/photo-27.png`],
    communities: [...WIDE, 'South Glen', 'Westbury'],
    published: true,
    scale: 1.1,
  },
  {
    name: 'Spruce',
    slug: 'spruce',
    style: 'Front Attached Garage',
    sqft: 2860,
    beds: 3,
    baths: 2.5,
    garage: 3,
    storeys: 2,
    price: 868_898,
    headline: 'A triple garage and room for everything.',
    description:
      'Spruce is the estate home of the collection: a triple attached garage, an open-to-below great room and an upper floor that adapts to four bedrooms or a second primary suite.',
    images: [
      `${UP}/photo-28.jpg`,
      `${UP}/photo-29.jpg`,
      `${UP}/photo-30.jpg`,
      `${UP}/photo-31.jpg`,
    ],
    floorPlans: [`${UP}/photo-32.png`, `${UP}/photo-33.png`],
    communities: ['Fernwood', 'Goldmeadow', 'Prairie Sky', 'Summit Rise'],
    published: true,
    scale: 1.2,
  },
  {
    name: 'Willow',
    slug: 'willow',
    style: 'Laned Home',
    sqft: 1880,
    beds: 4,
    baths: 2.5,
    garage: 0,
    storeys: 2,
    price: 599_386,
    headline: 'Laned living with four bedrooms upstairs.',
    description:
      'A starter favourite: Willow fits four bedrooms on the upper floor of a laned lot, with a rear garage pad and a basement ready for a legal suite.',
    images: [
      `${UP}/photo-34.jpg`,
      `${UP}/photo-35.jpg`,
      `${UP}/photo-36.jpg`,
      `${UP}/photo-37.jpg`,
    ],
    floorPlans: [`${UP}/photo-38.png`, `${UP}/photo-39.png`],
    communities: ['Clover Park', 'Meadow Ranch', 'Lantern Landing', 'Elm Park', 'Heron Landing'],
    published: true,
    scale: 0.95,
  },
  {
    name: 'Linden',
    slug: 'linden',
    style: 'Laned Home',
    sqft: 1755,
    beds: 3,
    baths: 2.5,
    garage: 0,
    storeys: 2,
    price: 598_996,
    headline: 'Arts & Crafts charm on a laned lot.',
    description:
      'Linden offers an alternate kitchen layout, a bright great room and three bedrooms up. A basement side entrance is available for future income potential.',
    images: [`${UP}/photo-40.jpg`],
    floorPlans: [`${UP}/photo-41.png`, `${UP}/photo-42.png`],
    communities: ['Clover Park', 'Meadow Ranch', 'Lantern Landing', 'Elm Park', 'Heron Landing'],
    published: true,
    scale: 0.95,
  },
  {
    name: 'Juniper',
    slug: 'juniper',
    style: 'Bungalow',
    sqft: 1720,
    beds: 1,
    baths: 1.5,
    garage: 2,
    storeys: 1,
    price: 689_900,
    headline: 'Single-level living, beautifully done.',
    description:
      'Juniper keeps everything on one level: a spacious primary suite, an executive-kitchen option and a 1,343 ft² basement ready to develop.',
    images: [`${UP}/photo-43.jpg`],
    floorPlans: [`${UP}/photo-44.png`],
    communities: ['Prairie Sky', 'Summit Rise'],
    published: true,
  },
  {
    name: 'Hazel',
    slug: 'hazel',
    style: 'Row Home',
    sqft: 1480,
    beds: 3,
    baths: 2.5,
    garage: 0,
    storeys: 2,
    price: 449_900,
    headline: 'Mid-century row homes in Copper Hill.',
    description:
      'Hazel brings three bedrooms and 2.5 baths to an attainable row-home format, with an optional legal basement suite where permitted.',
    images: [`${UP}/photo-45.jpg`, `${UP}/photo-46.jpg`, `${UP}/photo-47.jpg`],
    floorPlans: [`${UP}/photo-48.jpg`, `${UP}/photo-49.jpg`],
    communities: ['Copper Hill'],
    published: true,
    scale: 0.9,
  },
  {
    name: 'Avery',
    slug: 'avery',
    style: 'Duplex',
    sqft: 1750,
    beds: 3,
    baths: 2.5,
    garage: 0,
    storeys: 2,
    price: 560_235,
    headline: 'Duplex living with a legal-suite option.',
    description: 'Draft listing — imagery coming soon.',
    images: [],
    floorPlans: [],
    communities: ['Oak Hollow', 'Elm Park'],
    published: false,
  },
  {
    name: 'Pierce 3',
    slug: 'pierce-3',
    style: 'Front Attached Garage',
    sqft: 3070,
    beds: 4,
    baths: 3,
    garage: 2,
    storeys: 2,
    price: 899_900,
    headline: 'Our largest two-storey.',
    description: 'Draft listing — imagery coming soon.',
    images: [],
    floorPlans: [],
    communities: ['Copper Hill'],
    published: false,
    scale: 1.25,
  },
];

export const NORTHWIND = {
  name: 'Northwind Homes',
  slug: 'northwind-demo',
  tagline: 'A fictional second builder that proves tenants never see each other.',
};

export const INVENTORY: {
  address: string;
  community: string;
  model: string;
  price: number;
  possession: string;
  features: string[];
  selections: Record<string, ['pkg', string] | ['items', ...string[]]>;
  locked: boolean;
}[] = [
  {
    address: '455 Example Manor SE',
    community: 'Heron Landing',
    model: 'linden',
    price: 598_996,
    possession: '1 to 3 months',
    features: ['Basement side entrance'],
    selections: {
      elevation: ['pkg', 'craftsman'],
      interior: ['pkg', 'advantage'],
      basement: ['items', 'side-entrance'],
    },
    locked: false,
  },
  {
    address: '140 Sample Common SE',
    community: 'Heron Landing',
    model: 'willow',
    price: 624_754,
    possession: 'Immediate',
    features: ['Legal basement suite rough-in'],
    selections: { interior: ['pkg', 'advantage'], basement: ['items', 'suite-rough-in'] },
    locked: true,
  },
  {
    address: '73 Sunvale Gardens SE',
    community: 'Sunvale',
    model: 'alder',
    price: 699_305,
    possession: 'Immediate',
    features: ['Open to below', 'Basement side entrance'],
    selections: {
      elevation: ['pkg', 'urban-prairie'],
      interior: ['pkg', 'advantage'],
      'main-floor': ['items', 'open-below'],
      basement: ['items', 'side-entrance'],
    },
    locked: true,
  },
  {
    address: '37 Brookside Gardens SE',
    community: 'Brookside',
    model: 'alder',
    price: 774_578,
    possession: '4 to 6 months',
    features: ['Still customizable'],
    selections: {
      elevation: ['pkg', 'modern-prairie'],
      interior: ['pkg', 'signature'],
      'upper-floor': ['items', 'fourth-bed'],
    },
    locked: false,
  },
  {
    address: '218 Sunvale Way SE',
    community: 'Sunvale',
    model: 'cedar',
    price: 740_122,
    possession: '1 to 3 months',
    features: ['Basement porch entry'],
    selections: { elevation: ['pkg', 'farmhouse'], interior: ['pkg', 'signature'] },
    locked: true,
  },
  {
    address: '53 Sunvale Gardens SE',
    community: 'Sunvale',
    model: 'maple',
    price: 773_981,
    possession: '4 to 6 months',
    features: ['Flex room'],
    selections: { elevation: ['pkg', 'craftsman'], interior: ['pkg', 'advantage'] },
    locked: false,
  },
  {
    address: '468 Demo Lights Place',
    community: 'Prairie Sky',
    model: 'spruce',
    price: 868_898,
    possession: 'Immediate',
    features: ['Walkout', 'Triple garage'],
    selections: {
      elevation: ['pkg', 'mountain'],
      interior: ['pkg', 'signature'],
      'main-floor': ['items', 'open-below'],
    },
    locked: true,
  },
];

export const AGREEMENT_TEMPLATES = {
  showcase: [
    { ...STARTER_AGREEMENT_TEMPLATE, isDefault: true },
    {
      name: 'Quick possession home',
      title: 'Agreement of purchase and sale: quick possession home',
      isDefault: false,
      sections: [
        {
          heading: 'Parties',
          body: 'This agreement is made on {{agreement.date}} between {{seller.name}} of {{seller.address}} (the "Seller") and the following purchasers, together the "Buyer":\n\n{{purchasers.list}}',
        },
        {
          heading: 'The home, as built',
          body: "The Seller agrees to sell, and the Buyer agrees to buy, {{home.description}}, as built and with the features set out in Schedule A (proposal {{proposal.reference}}, revision {{proposal.revision}}).\n\nThe Buyer has had the opportunity to inspect the home and accepts it in its current state, subject to the Seller's new home warranty.",
        },
        {
          heading: 'Price and deposit',
          body: 'The purchase price is {{price.total}}. The Buyer pays a deposit of {{deposit.amount}} in these instalments:\n\n{{deposit.schedule}}\n\nThe balance of {{balance.amount}} is due on closing.',
          requiresInitials: true,
        },
        {
          heading: 'Closing',
          body: 'Closing and possession take place on {{closing.date}}.',
        },
        {
          heading: 'Conditions',
          body: 'This agreement is subject to:\n\n{{conditions.list}}',
          requiresInitials: true,
        },
        { heading: 'Special terms', body: '{{special.terms}}' },
        {
          heading: 'Your representative',
          body: "{{rep.name}} of {{seller.name}} ({{seller.phone}}, {{seller.email}}) is the Buyer's contact until closing.",
        },
      ],
    },
  ],
  northwind: [
    {
      name: 'Northwind purchase contract',
      title: 'Northwind Homes purchase contract',
      isDefault: true,
      sections: [
        {
          heading: 'Agreement',
          body: '{{seller.name}} will build and sell {{home.description}} to {{buyer.name}} for {{price.total}}.',
        },
        {
          heading: 'Payment',
          body: 'Deposit: {{deposit.amount}}.\n\n{{deposit.schedule}}\n\nBalance on closing ({{closing.date}}): {{balance.amount}}.',
          requiresInitials: true,
        },
        {
          heading: 'Conditions',
          body: '{{conditions.list}}',
        },
      ],
    },
  ],
} satisfies Record<string, AgreementTemplateInput[]>;

export const SHOWCASE_TAX_REGIONS = { adopt: ['AB', 'BC'], default: 'AB' } as const;

export const REFERRAL_PROGRAMS = [
  {
    name: 'Homeowner referral',
    description:
      'A homeowner who refers a buyer receives a $1,000 thank-you on closing; the buyer gets $2,000 off the price.',
    creditCents: 200_000,
    active: true,
  },
  {
    name: 'Realtor introduction',
    description: 'Records the realtor who introduced the buyer; the commission is paid separately.',
    creditCents: 0,
    active: true,
  },
] as const;

export const STORY = {
  taylor: {
    welcome:
      'Great meeting you at the Brookside show home, Taylor. Here is the Alder as we configured it together.',
    reply:
      'Thanks Jordan! We talked it over at home. Could we drop the spice kitchen and go up to the Designer finishes instead?',
  },
  patel: {
    buyer: { name: 'Priya & Sam Patel', email: 'patel.family@example.com' },
    lotPremium: 'Walkout lot premium — Prairie Sky',
    note: 'Walkout lot backing onto the pond, Mountain elevation as discussed. Remove anything you like and I will take a look.',
    invite: 'Patel family (Spruce, from packages)',
    referrer: { referrerName: 'Dana Whitfield', referrerEmail: 'dana.whitfield@example.com' },
  },
  alex: {
    buyer: { name: 'Alex Morgan', email: 'alex.morgan@example.com' },
    note: 'This Willow is ready for immediate possession and is offered as built.',
    invite: 'Alex Morgan (pre-existing Willow, locked)',
  },
  lee: {
    buyer: { name: 'Avery Lee', email: 'avery.lee@example.com' },
    purchasers: [
      { name: 'Avery Lee', email: 'avery.lee@example.com' },
      { name: 'Chris Lee', email: 'chris.lee@example.com' },
    ],
    deposits: { onSigning: 'on signing', second: 'within 30 days of signing' },
    cheque: '#2041',
    wire: 'WIRE-88213',
    note: 'Second deposit instalment, wire confirmation forwarded by the buyers.',
  },
  rivera: {
    buyer: { name: 'Sam Rivera', email: 'sam.rivera@example.com', phone: '403-555-0188' },
    home: '73 Sunvale Gardens SE',
    deposits: { onSigning: 'on signing', second: 'within 30 days of signing' },
    cheque: '#1187',
    wire: 'WIRE-20611',
  },
  jamie: {
    buyer: { name: 'Jamie Okafor', email: 'jamie@example.com' },
    answer:
      'Signature finishes are approved. Solar is not possible on this lot orientation, sorry!',
  },
} as const;

export const NORTHWIND_DATA = {
  admin: { name: 'Robin Northwind', email: 'admin@northwind.demo' },
  area: { slug: 'kitchen', label: 'Kitchen' },
  item: 'Waterfall island',
  style: 'Two-storey',
  headline: 'Fictional demo model for tenant isolation.',
  description: 'This listing belongs to a fictional company on a different origin.',
  community: 'Demo Ridge',
} as const;

export const SEED_TEXT = {
  superAdminName: 'Platform Admin',
  missingTaxPreset: (code: string) => `The platform has no sales tax suggestion for ${code}.`,
  originTaken: (owner: string) =>
    `Origin already belongs to "${owner}". To start from fresh demo data, delete the MONGO_DATA_DIR folder (or run \`task docker:down -- -v\` for the containers).`,
} as const;
