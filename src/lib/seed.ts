import type {
  AppSettings,
  CategoryDef,
  Product,
  Scheme,
  ShippingRule,
  UserProfile,
} from "./types";

function hashPassword(password: string): string {
  // Browser/offline hash (legacy). Server login upgrades to scrypt on success.
  // Do not use for new server-side storage — see hashPasswordSecure.
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = (h << 5) - h + password.charCodeAt(i);
    h |= 0;
  }
  return `demo_${h}_${password.length}`;
}

export { hashPassword };

export const SEED_CATEGORIES: CategoryDef[] = [
  {
    id: "tarpaulin",
    name: { en: "Tarpaulin", hi: "तिरपाल" },
    active: true,
  },
  {
    id: "shade_net",
    name: { en: "Shade Net", hi: "शेड नेट" },
    active: true,
  },
  {
    id: "tirpal",
    name: { en: "Tirpal", hi: "तिरपाल (कैनवास)" },
    active: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  companyName: "T T Enterprises",
  phone: "9250205615",
  phone2: "",
  address: "55/97 General Ganj, Kanpur 208001",
  address2: "G-80, Panki Site 3, Kanpur",
  gstin: "",
  fullTruckMinWeightKg: 5000,
  fullTruckMinValue: 150000,
  weightShipping: {
    enabled: true,
    minWeightKg: 100,
    flatRateX: 1000,
    stepKg: 50,
    stepFractionOfX: 0.5,
  },
  jhalShipping: {
    ratePerJhal: 50,
  },
  upiId: "9415133028.eazypay@icici",
  upiPayeeName: "Sudhir Gupta",
  bankAccount: {
    accountName: "Sudhir Gupta",
    accountNumber: "",
    ifsc: "",
    bankName: "",
    branch: "",
  },
  paymentNote:
    "Pay the amount shown to Sudhir Gupta (UPI: 9415133028.eazypay@icici), then upload payment proof on this order.",
  whatsappNotifyEnabled: true,
  whatsappCountryCode: "91",
  tallySyncStatus: "idle",
  tallySyncMessage: "Not synced yet",
  financialYearStartMonth: 4,
  autoReorderEnabled: false,
  autoReorderCron: "0 6 * * 1",
  autoReorderMinQty: 1,
  autoReorderUseVelocity: true,
  autoReorderLookbackDays: 30,
  autoReorderLeadTimeDays: 10,
  autoReorderSafetyDays: 7,
  autoReorderSeasonMonths: [5, 6, 7, 8, 9],
  autoReorderSeasonMultiplier: 1.4,
  homeNewProductIds: [],
  homePromoProductIds: [],
  monthAuditPolicy: "escalating",
  monthAuditGraceDays: 0,
};

/** Demo logins removed — production bootstraps from cloud DB only. */
export const SEED_USERS: UserProfile[] = [];

export const SEED_PRODUCTS: Product[] = [
  {
    id: "prod_tarpaulin_hdpe",
    code: "TRP-HDPE-120",
    name: {
      en: "HDPE Tarpaulin 120 GSM",
      hi: "एचडीपीई तिरपाल 120 जीएसएम",
    },
    itemName: {
      en: "HDPE Tarpaulin",
      hi: "एचडीपीई तिरपाल",
    },
    description: {
      en: "Heavy-duty waterproof HDPE tarpaulin for trucks, farms and construction cover.",
      hi: "ट्रक, खेत और निर्माण कवर के लिए मजबूत वॉटरप्रूफ एचडीपीई तिरपाल।",
    },
    category: "tarpaulin",
    unit: "kg",
    baseRate: 95,
    baseWeightKg: 1,
    pricingMode: "bundle",
    gsm: 120,
    material: "HDPE",
    brand: "TT",
    hsnCode: "392690",
    minOrderQty: 1,
    variations: [
      {
        id: "var_trp_12x18",
        label: { en: "Standard sheet", hi: "स्टैंडर्ड शीट" },
        size: { en: "12x18 ft", hi: "12x18 फीट" },
        sku: "TRP-HDPE-120-12x18",
        rate: 95,
        weightKg: 4.2,
        stock: 200,
      },
      {
        id: "var_trp_18x24",
        label: { en: "Standard sheet", hi: "स्टैंडर्ड शीट" },
        size: { en: "18x24 ft", hi: "18x24 फीट" },
        sku: "TRP-HDPE-120-18x24",
        rate: 95,
        weightKg: 8.5,
        stock: 150,
      },
      {
        id: "var_trp_24x36",
        label: { en: "Standard sheet", hi: "स्टैंडर्ड शीट" },
        size: { en: "24x36 ft", hi: "24x36 फीट" },
        sku: "TRP-HDPE-120-24x36",
        rate: 98,
        weightKg: 17,
        stock: 80,
      },
    ],
    colors: [
      {
        id: "col_blue",
        name: { en: "Blue", hi: "नीला" },
        hex: "#1d4ed8",
      },
      {
        id: "col_silver",
        name: { en: "Silver", hi: "सिल्वर" },
        hex: "#94a3b8",
      },
      {
        id: "col_green",
        name: { en: "Green", hi: "हरा" },
        hex: "#15803d",
      },
    ],
    /** Stock per size × color (bundles) */
    stockMatrix: {
      "var_trp_12x18__col_blue": 80,
      "var_trp_12x18__col_silver": 70,
      "var_trp_12x18__col_green": 50,
      "var_trp_18x24__col_blue": 60,
      "var_trp_18x24__col_silver": 50,
      "var_trp_18x24__col_green": 40,
      "var_trp_24x36__col_blue": 30,
      "var_trp_24x36__col_silver": 30,
      "var_trp_24x36__col_green": 20,
    },
    media: [
      {
        id: "m1",
        type: "image",
        url: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1200&q=80",
        alt: "Tarpaulin rolls",
      },
    ],
    logoUrl:
      "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=200&h=200&fit=crop&q=80",
    active: true,
    featured: true,
    stock: 430,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "prod_shade_net_50",
    code: "SN-50",
    name: {
      en: "Shade Net 50%",
      hi: "शेड नेट 50%",
    },
    itemName: {
      en: "Agro Shade Net",
      hi: "एग्रो शेड नेट",
    },
    description: {
      en: "UV-stabilized agro shade net for nurseries and greenhouses.",
      hi: "नर्सरी और ग्रीनहाउस के लिए यूवी-स्थिर एग्रो शेड नेट।",
    },
    category: "shade_net",
    unit: "kg",
    baseRate: 110,
    baseWeightKg: 1,
    pricingMode: "bundle",
    gsm: 50,
    material: "HDPE Net",
    brand: "TT",
    hsnCode: "560819",
    minOrderQty: 1,
    variations: [
      {
        id: "var_sn_3m",
        label: { en: "Roll", hi: "रोल" },
        size: { en: "3m width", hi: "3 मीटर चौड़ाई" },
        sku: "SN-50-3M",
        rate: 110,
        weightKg: 1,
        stock: 500,
      },
      {
        id: "var_sn_4m",
        label: { en: "Roll", hi: "रोल" },
        size: { en: "4m width", hi: "4 मीटर चौड़ाई" },
        sku: "SN-50-4M",
        rate: 115,
        weightKg: 1,
        stock: 400,
      },
    ],
    colors: [
      {
        id: "col_sn_green",
        name: { en: "Green", hi: "हरा" },
        hex: "#166534",
      },
      {
        id: "col_sn_black",
        name: { en: "Black", hi: "काला" },
        hex: "#111827",
      },
    ],
    stockMatrix: {
      "var_sn_3m__col_sn_green": 300,
      "var_sn_3m__col_sn_black": 200,
      "var_sn_4m__col_sn_green": 250,
      "var_sn_4m__col_sn_black": 150,
    },
    media: [
      {
        id: "m2",
        type: "image",
        url: "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=80",
        alt: "Shade net greenhouse",
      },
    ],
    logoUrl:
      "https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=200&h=200&fit=crop&q=80",
    active: true,
    featured: true,
    stock: 900,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "prod_shade_net_75",
    code: "SN-75",
    name: {
      en: "Shade Net 75%",
      hi: "शेड नेट 75%",
    },
    itemName: {
      en: "Agro Shade Net",
      hi: "एग्रो शेड नेट",
    },
    description: {
      en: "High-density shade net for livestock and open yards.",
      hi: "पशुशाला और खुले यार्ड के लिए हाई-डेंसिटी शेड नेट।",
    },
    category: "shade_net",
    unit: "kg",
    baseRate: 125,
    baseWeightKg: 1,
    pricingMode: "bundle",
    gsm: 75,
    material: "HDPE Net",
    brand: "TT",
    hsnCode: "560819",
    minOrderQty: 1,
    variations: [
      {
        id: "var_sn75_3m",
        label: { en: "Roll", hi: "रोल" },
        size: { en: "3m width", hi: "3 मीटर चौड़ाई" },
        sku: "SN-75-3M",
        rate: 125,
        weightKg: 1,
        stock: 350,
      },
    ],
    colors: [
      {
        id: "col_sn75_green",
        name: { en: "Dark Green", hi: "गहरा हरा" },
        hex: "#14532d",
      },
    ],
    media: [
      {
        id: "m3",
        type: "image",
        url: "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=1200&q=80",
        alt: "Agricultural shade",
      },
    ],
    logoUrl:
      "https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=200&h=200&fit=crop&q=80",
    active: true,
    featured: false,
    stock: 350,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "prod_tirpal_cotton",
    code: "TIR-COT",
    name: {
      en: "Cotton Tirpal / Canvas",
      hi: "कॉटन तिरपाल / कैनवास",
    },
    itemName: {
      en: "Cotton Canvas Tirpal",
      hi: "कॉटन कैनवास तिरपाल",
    },
    description: {
      en: "Traditional cotton canvas tirpal sold per piece for sheds and covers.",
      hi: "शेड और कवर के लिए पारंपरिक कॉटन कैनवास तिरपाल, प्रति पीस।",
    },
    category: "tirpal",
    unit: "pcs",
    baseRate: 1850,
    baseWeightKg: 6,
    pricingMode: "pcs",
    material: "Cotton Canvas",
    brand: "TT",
    hsnCode: "520819",
    minOrderQty: 1,
    variations: [
      {
        id: "var_tir_10x12",
        label: { en: "Canvas piece", hi: "कैनवास पीस" },
        size: { en: "10x12 ft", hi: "10x12 फीट" },
        sku: "TIR-COT-10x12",
        rate: 1450,
        weightKg: 4.5,
        stock: 60,
      },
      {
        id: "var_tir_15x18",
        label: { en: "Canvas piece", hi: "कैनवास पीस" },
        size: { en: "15x18 ft", hi: "15x18 फीट" },
        sku: "TIR-COT-15x18",
        rate: 1850,
        weightKg: 6,
        stock: 40,
      },
    ],
    colors: [
      {
        id: "col_beige",
        name: { en: "Beige", hi: "बेज" },
        hex: "#d6c3a3",
      },
      {
        id: "col_khaki",
        name: { en: "Khaki", hi: "खाकी" },
        hex: "#8b7355",
      },
    ],
    media: [
      {
        id: "m4",
        type: "image",
        url: "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=1200&q=80",
        alt: "Canvas fabric",
      },
    ],
    logoUrl:
      "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?w=200&h=200&fit=crop&q=80",
    active: true,
    featured: true,
    stock: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export const SEED_SCHEMES: Scheme[] = [
  {
    id: "scheme_lift_bonus",
    name: {
      en: "Lift & Earn Ladder",
      hi: "लिफ्ट और कमाओ लेडर",
    },
    description: {
      en: "Tier rates on full lift. Hit 5T and the whole 5T pays at the higher ₹/kg — one wallet credit after scheme ends.",
      hi: "टियर रेट पूरे लिफ्ट पर। 5 टन पहुँचें तो पूरा 5 टन ऊँचे ₹/किग्रा पर — स्कीम समाप्ति पर एक वॉलेट क्रेडिट।",
    },
    termsAndConditions: {
      en: "1) Highest unlocked tier rate applies to your FULL actual lift (not band-by-band).\n2) Example: 1T @ ₹1/kg; reach 5T → all 5T @ ₹1.5/kg.\n3) If you exceed the top tier, full actual weight still uses the top tier rate.\n4) Single wallet credit after scheme end date.\n5) Only actual billed weight counts. Cancelled orders remove progress.",
      hi: "1) सबसे ऊँचा अनलॉक टियर रेट पूरे असली लिफ्ट पर लगता है।\n2) उदाहरण: 1 टन @ ₹1/किग्रा; 5 टन → पूरा 5 टन @ ₹1.5/किग्रा।\n3) टॉप टियर से ज़्यादा लिफ्ट पर भी पूरा असली वजन × टॉप रेट।\n4) स्कीम समाप्ति पर एक ही वॉलेट क्रेडिट।\n5) केवल बिल का असली वजन। कैंसल ऑर्डर प्रगति हटाते हैं।",
    },
    progressUnit: "kg",
    targetWeightKg: 10000,
    rewardType: "per_kg_rate",
    creditAmount: 0,
    discountPerKg: 0,
    levels: [
      {
        id: "scheme_lift_bonus_l1",
        name: { en: "Tier 1 · 1 Ton", hi: "टियर 1 · 1 टन" },
        targetAmount: 1000,
        ratePerUnit: 1,
      },
      {
        id: "scheme_lift_bonus_l2",
        name: { en: "Tier 2 · 5 Ton", hi: "टियर 2 · 5 टन" },
        targetAmount: 5000,
        ratePerUnit: 1.5,
      },
      {
        id: "scheme_lift_bonus_l3",
        name: { en: "Tier 3 · 10 Ton", hi: "टियर 3 · 10 टन" },
        targetAmount: 10000,
        ratePerUnit: 2,
      },
    ],
    scopeType: "all",
    scopeProductIds: [],
    appliesToAllDealers: true,
    active: true,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "scheme_perkg",
    name: {
      en: "Tarpaulin Tier Bonus",
      hi: "तिरपाल टियर बोनस",
    },
    description: {
      en: "Tarpaulin only — highest tier ₹/kg on full lift, paid once when scheme ends.",
      hi: "केवल तिरपाल — पूरे लिफ्ट पर ऊँचा टियर ₹/किग्रा, स्कीम समाप्ति पर एक बार भुगतान।",
    },
    termsAndConditions: {
      en: "1) Tarpaulin category only.\n2) Highest tier rate × full kg.\n3) One wallet credit after end date.",
      hi: "1) केवल तिरपाल।\n2) ऊँचा टियर रेट × पूरा किग्रा।\n3) समाप्ति पर एक वॉलेट क्रेडिट।",
    },
    progressUnit: "kg",
    targetWeightKg: 10000,
    rewardType: "per_kg_rate",
    creditAmount: 0,
    discountPerKg: 0,
    levels: [
      {
        id: "scheme_perkg_l1",
        name: { en: "Tier 1", hi: "टियर 1" },
        targetAmount: 3000,
        ratePerUnit: 0.8,
      },
      {
        id: "scheme_perkg_l2",
        name: { en: "Tier 2", hi: "टियर 2" },
        targetAmount: 7000,
        ratePerUnit: 1.2,
      },
      {
        id: "scheme_perkg_l3",
        name: { en: "Tier 3", hi: "टियर 3" },
        targetAmount: 10000,
        ratePerUnit: 1.8,
      },
    ],
    scopeType: "category",
    scopeCategory: "tarpaulin",
    scopeProductIds: [],
    appliesToAllDealers: true,
    active: true,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "scheme_bundles",
    name: {
      en: "Bundle Tier Ladder",
      hi: "बंडल टियर लेडर",
    },
    description: {
      en: "Bundle tiers — highest unlocked ₹/bundle on all bundles, paid after scheme ends.",
      hi: "बंडल टियर — सभी बंडल पर ऊँचा ₹/बंडल, स्कीम समाप्ति पर भुगतान।",
    },
    termsAndConditions: {
      en: "1) Progress in bundles.\n2) Highest tier rate on full bundle count.\n3) Single credit after end date.",
      hi: "1) प्रगति बंडल में।\n2) पूरे बंडल काउंट पर ऊँचा टियर रेट।\n3) समाप्ति पर एक क्रेडिट।",
    },
    progressUnit: "bundles",
    targetWeightKg: 300,
    rewardType: "per_kg_rate",
    creditAmount: 0,
    discountPerKg: 0,
    levels: [
      {
        id: "scheme_bundles_l1",
        name: { en: "Tier 1", hi: "टियर 1" },
        targetAmount: 50,
        ratePerUnit: 10,
      },
      {
        id: "scheme_bundles_l2",
        name: { en: "Tier 2", hi: "टियर 2" },
        targetAmount: 150,
        ratePerUnit: 15,
      },
      {
        id: "scheme_bundles_l3",
        name: { en: "Tier 3", hi: "टियर 3" },
        targetAmount: 300,
        ratePerUnit: 20,
      },
    ],
    scopeType: "all",
    scopeProductIds: [],
    appliesToAllDealers: true,
    active: true,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  },
  {
    id: "scheme_season",
    name: {
      en: "Monsoon Cover Bonus",
      hi: "मानसून कवर बोनस",
    },
    description: {
      en: "Shade net tiers — full lift at highest unlocked rate after scheme ends.",
      hi: "शेड नेट टियर — स्कीम समाप्ति पर पूरे लिफ्ट पर ऊँचा अनलॉक रेट।",
    },
    termsAndConditions: {
      en: "Shade Net only. Highest tier ₹/kg × full lift. One credit after end date.",
      hi: "केवल शेड नेट। ऊँचा टियर ₹/किग्रा × पूरा लिफ्ट। समाप्ति पर एक क्रेडिट।",
    },
    progressUnit: "kg",
    targetWeightKg: 5000,
    rewardType: "per_kg_rate",
    creditAmount: 0,
    discountPerKg: 0,
    levels: [
      {
        id: "scheme_season_l1",
        name: { en: "Tier 1", hi: "टियर 1" },
        targetAmount: 1000,
        ratePerUnit: 0.75,
      },
      {
        id: "scheme_season_l2",
        name: { en: "Tier 2", hi: "टियर 2" },
        targetAmount: 2500,
        ratePerUnit: 1.25,
      },
      {
        id: "scheme_season_l3",
        name: { en: "Tier 3", hi: "टियर 3" },
        targetAmount: 5000,
        ratePerUnit: 1.75,
      },
    ],
    scopeType: "category",
    scopeCategory: "shade_net",
    scopeProductIds: [],
    appliesToAllDealers: false,
    active: true,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    createdAt: new Date().toISOString(),
  },
];

export const SEED_SHIPPING: ShippingRule[] = [
  {
    id: "ship_local",
    name: "Standard (0–500 kg)",
    minWeightKg: 0,
    maxWeightKg: 500,
    minOrderValue: 0,
    shippingAmount: 800,
    active: true,
  },
  {
    id: "ship_mid",
    name: "Mid load (500–2000 kg)",
    minWeightKg: 500,
    maxWeightKg: 2000,
    minOrderValue: 0,
    shippingAmount: 2500,
    freeAboveValue: 75000,
    active: true,
  },
  {
    id: "ship_heavy",
    name: "Heavy (2000+ kg)",
    minWeightKg: 2000,
    minOrderValue: 0,
    shippingAmount: 4500,
    freeAboveWeightKg: 8000,
    active: true,
  },
];
