// Tables that turn OpenStreetMap tags (as carried by the Protomaps v4 schema)
// into land use and trip attraction. The numbers are rough rules of thumb;
// every layer is normalised to a city-wide total afterwards, so only the
// ratios between entries matter.

export type Use =
  | "residential"
  | "office"
  | "industrial"
  | "education"
  | "retail"
  | "health"
  | "civic"
  | "leisure"
  | "other";

/** Building kind codes written to buildings.bin. */
export const KIND_CODE: Record<Use, number> = {
  residential: 0,
  office: 1,
  industrial: 2,
  education: 3,
  retail: 4,
  health: 5,
  civic: 5,
  leisure: 5,
  other: 5,
};

export interface UseWeights {
  /** Share of a GHSL pixel's population per m² of floor, relative to housing. */
  residents: number;
  /** Jobs per m² of floor. */
  jobs: number;
}

export const USE_WEIGHTS: Record<Use, UseWeights> = {
  residential: { residents: 1, jobs: 1 / 1000 },
  office: { residents: 0.1, jobs: 1 / 25 },
  industrial: { residents: 0.02, jobs: 1 / 80 },
  education: { residents: 0.02, jobs: 1 / 60 },
  retail: { residents: 0.05, jobs: 1 / 40 },
  health: { residents: 0.05, jobs: 1 / 35 },
  civic: { residents: 0.02, jobs: 1 / 50 },
  leisure: { residents: 0.02, jobs: 1 / 150 },
  other: { residents: 0.2, jobs: 1 / 200 },
};

/** Education places per m² of floor in education buildings. */
export const EDUCATION_PER_FLOOR_M2 = 0.1;
/** Retail attraction per m² of floor, by building use. */
export const RETAIL_PER_FLOOR_M2: Partial<Record<Use, number>> = { retail: 0.01, office: 0.0005 };
/** Leisure attraction per m² of floor, by building use. */
export const LEISURE_PER_FLOOR_M2: Partial<Record<Use, number>> = { leisure: 0.005, civic: 0.001 };
/** Nightlife attraction per m² of floor, by building use: halls, clubs and culture houses. */
export const NIGHTLIFE_PER_FLOOR_M2: Partial<Record<Use, number>> = { leisure: 0.0005, civic: 0.0001 };

export interface LanduseKind {
  use?: Use;
  /** Leisure attraction per hectare. */
  leisure?: number;
  /** Education places per hectare of grounds. */
  education?: number;
  /** Day-out attraction per hectare, before the patch size and distance factors. */
  nature?: number;
}

/**
 * Landuse kinds in painting order: later entries win where polygons overlap,
 * so a park inside a residential area stays a park and a school inside a park
 * stays a school. Kinds not listed are ignored.
 */
export const LANDUSE_KINDS: [string, LanduseKind][] = [
  ["farmland", { use: "other" }],
  ["grass", { use: "other" }],
  ["sand", { use: "other" }],
  ["wetland", { use: "other" }],
  ["scrub", { use: "other", leisure: 0.05, nature: 0.2 }],
  ["grassland", { use: "other", leisure: 0.1, nature: 0.4 }],
  ["meadow", { use: "other", leisure: 0.1, nature: 0.4 }],
  ["wood", { use: "other", leisure: 0.3, nature: 0.7 }],
  ["forest", { use: "other", leisure: 0.3, nature: 0.7 }],
  ["nature_reserve", { use: "other", leisure: 0.2, nature: 0.8 }],
  ["cemetery", { use: "other" }],
  // Dacha plots: their owners spend the weekend there.
  ["allotments", { use: "residential", nature: 0.5 }],
  ["residential", { use: "residential" }],
  ["railway", { use: "industrial" }],
  ["industrial", { use: "industrial" }],
  ["aerodrome", { use: "industrial" }],
  ["airfield", { use: "industrial" }],
  ["military", { use: "civic" }],
  ["commercial", { use: "office" }],
  ["golf_course", { use: "leisure", leisure: 1 }],
  ["dog_park", { use: "leisure", leisure: 1 }],
  ["village_green", { use: "leisure", leisure: 2, nature: 0.5 }],
  ["recreation_ground", { use: "leisure", leisure: 3, nature: 0.8 }],
  ["garden", { use: "leisure", leisure: 3, nature: 1 }],
  ["park", { use: "leisure", leisure: 4, nature: 1 }],
  ["beach", { use: "leisure", leisure: 5, nature: 2 }],
  ["playground", { use: "leisure", leisure: 2 }],
  ["pitch", { use: "leisure", leisure: 4 }],
  ["zoo", { use: "leisure", leisure: 20 }],
  ["hospital", { use: "health" }],
  ["kindergarten", { use: "education", education: 100 }],
  ["school", { use: "education", education: 100 }],
  ["college", { use: "education", education: 100 }],
  ["university", { use: "education", education: 100 }],
];

/** Water layer kinds that are not open water for routing purposes. */
export const NOT_WATER = new Set(["swimming_pool", "fountain"]);

export interface PoiWeights {
  jobs?: number;
  education?: number;
  retail?: number;
  leisure?: number;
  /** Evening attraction. */
  nightlife?: number;
  /** Its jobs are industrial or production work. */
  industrial?: boolean;
  /** A POI of this kind inside a building decides the building's use. */
  defines?: Use;
}

const SHOP = { jobs: 3, retail: 1 };
const SERVICE = { jobs: 3, retail: 0.6 };

export const POI_WEIGHTS: Record<string, PoiWeights> = {
  // Everyday shops and services.
  convenience: { jobs: 4, retail: 2 },
  greengrocer: SHOP,
  bakery: SHOP,
  butcher: SHOP,
  seafood: SHOP,
  confectionery: SHOP,
  alcohol: SHOP,
  tobacco: SHOP,
  "e-cigarette": SHOP,
  beverages: SHOP,
  dairy: SHOP,
  tea: SHOP,
  coffee: SHOP,
  wine: SHOP,
  pharmacy: { jobs: 4, retail: 2 },
  chemist: SHOP,
  cosmetics: SHOP,
  perfumery: SHOP,
  clothes: SHOP,
  shoes: SHOP,
  jewelry: SHOP,
  bag: SHOP,
  gift: SHOP,
  florist: SHOP,
  toys: SHOP,
  baby_goods: SHOP,
  books: SHOP,
  stationery: SHOP,
  newsagent: SHOP,
  kiosk: SHOP,
  mobile_phone: SHOP,
  electronics: SHOP,
  computer: SHOP,
  optician: SHOP,
  medical_supply: SHOP,
  pet: SHOP,
  hardware: SHOP,
  houseware: SHOP,
  furniture: { jobs: 5, retail: 1.5 },
  kitchen: SHOP,
  bed: SHOP,
  paint: SHOP,
  doors: SHOP,
  fabric: SHOP,
  interior_decoration: SHOP,
  sports: SHOP,
  bicycle: SHOP,
  car_parts: SHOP,
  variety_store: SHOP,
  second_hand: SHOP,
  pawnbroker: SERVICE,
  erotic: SHOP,
  retail: SHOP,
  beauty: SERVICE,
  hairdresser: SERVICE,
  massage: SERVICE,
  tailor: SERVICE,
  shoe_repair: SERVICE,
  key_cutter: SERVICE,
  dry_cleaning: SERVICE,
  laundry: SERVICE,
  copyshop: SERVICE,
  photo: SERVICE,
  electronics_repair: SERVICE,
  travel_agency: SERVICE,
  ticket: SERVICE,
  money_transfer: SERVICE,
  bureau_de_change: SERVICE,
  bookmaker: SERVICE,
  outpost: { jobs: 2, retail: 1 },
  parcel_locker: { retail: 0.3 },
  atm: { retail: 0.3 },
  bank: { jobs: 12, retail: 1.5 },
  post_office: { jobs: 12, retail: 2 },
  car_repair: { jobs: 6, retail: 0.5 },
  car_wash: { jobs: 4, retail: 0.3 },
  fuel: { jobs: 6, retail: 0.5 },
  car: { jobs: 25, retail: 1 },

  // Large stores.
  supermarket: { jobs: 30, retail: 8 },
  doityourself: { jobs: 25, retail: 5 },
  garden_centre: { jobs: 10, retail: 3 },
  wholesale: { jobs: 40, retail: 5, defines: "retail" },
  department_store: { jobs: 100, retail: 25, defines: "retail" },
  marketplace: { jobs: 60, retail: 20, defines: "retail" },
  mall: { jobs: 200, retail: 40, leisure: 10, defines: "retail" },
  shopping_centre: { jobs: 200, retail: 40, leisure: 10, defines: "retail" },

  // Food and drink.
  cafe: { jobs: 6, retail: 0.3, leisure: 2, nightlife: 0.5 },
  restaurant: { jobs: 12, leisure: 4, nightlife: 2 },
  fast_food: { jobs: 8, retail: 0.5, leisure: 1.5, nightlife: 0.3 },
  food_court: { jobs: 20, retail: 1, leisure: 3, nightlife: 0.5 },
  ice_cream: { jobs: 2, leisure: 0.5 },
  bar: { jobs: 6, leisure: 3, nightlife: 8 },
  pub: { jobs: 6, leisure: 3, nightlife: 5 },
  hookah_lounge: { jobs: 5, leisure: 2, nightlife: 4 },
  nightclub: { jobs: 15, leisure: 6, nightlife: 10 },
  stripclub: { jobs: 15, leisure: 4, nightlife: 8 },
  karaoke_box: { jobs: 5, leisure: 3, nightlife: 5 },
  biergarten: { jobs: 6, leisure: 3, nightlife: 4 },

  // Culture, sport and entertainment.
  theatre: { jobs: 60, leisure: 30, nightlife: 5, defines: "civic" },
  cinema: { jobs: 25, leisure: 25, nightlife: 5 },
  music_venue: { jobs: 10, leisure: 6, nightlife: 5 },
  museum: { jobs: 30, leisure: 20, defines: "civic" },
  gallery: { jobs: 5, leisure: 5 },
  arts_centre: { jobs: 20, leisure: 10, nightlife: 3 },
  exhibition_centre: { jobs: 80, leisure: 40, defines: "civic" },
  events_venue: { jobs: 10, leisure: 8, nightlife: 3 },
  planetarium: { jobs: 20, leisure: 15 },
  aquarium: { jobs: 20, leisure: 15 },
  library: { jobs: 8, leisure: 4 },
  community_centre: { jobs: 8, leisure: 4 },
  attraction: { jobs: 2, leisure: 6 },
  viewpoint: { leisure: 2 },
  monument: { leisure: 1 },
  castle: { jobs: 5, leisure: 8 },
  manor: { jobs: 5, leisure: 8 },
  monastery: { jobs: 10, leisure: 8 },
  place_of_worship: { jobs: 3, leisure: 3, defines: "civic" },
  park: { jobs: 2, leisure: 15 },
  garden: { leisure: 5 },
  zoo: { jobs: 150, leisure: 80 },
  theme_park: { jobs: 100, leisure: 60 },
  water_park: { jobs: 60, leisure: 40 },
  stadium: { jobs: 50, leisure: 40 },
  sports_centre: { jobs: 15, leisure: 8 },
  fitness_centre: { jobs: 10, leisure: 5 },
  swimming_pool: { jobs: 10, leisure: 6 },
  ice_rink: { jobs: 10, leisure: 6 },
  sports_hall: { jobs: 5, leisure: 4 },
  bowling_alley: { jobs: 10, leisure: 6, nightlife: 2 },
  escape_game: { jobs: 3, leisure: 2, nightlife: 1 },
  amusement_arcade: { jobs: 3, leisure: 3 },
  sauna: { jobs: 4, leisure: 2 },
  dance: { jobs: 3, leisure: 2 },
  resort: { jobs: 20, leisure: 10 },
  beach_resort: { jobs: 5, leisure: 8 },

  // Education.
  kindergarten: { jobs: 30, education: 150, defines: "education" },
  school: { jobs: 80, education: 800, defines: "education" },
  prep_school: { jobs: 10, education: 80 },
  college: { jobs: 100, education: 800, defines: "education" },
  university: { jobs: 400, education: 3000, defines: "education" },
  language_school: { jobs: 5, education: 50 },
  music_school: { jobs: 20, education: 200 },
  driving_school: { jobs: 3, education: 30 },
  training: { jobs: 3, education: 20 },
  childcare: { jobs: 10, education: 50 },
  research_institute: { jobs: 200, defines: "office" },

  // Health and care.
  hospital: { jobs: 800, defines: "health" },
  clinic: { jobs: 80, defines: "health" },
  doctors: { jobs: 15 },
  dentist: { jobs: 6 },
  veterinary: { jobs: 5 },
  social_facility: { jobs: 30 },
  nursing_home: { jobs: 40 },

  // Offices, government and services.
  townhall: { jobs: 100, defines: "civic" },
  courthouse: { jobs: 80, defines: "civic" },
  administrative: { jobs: 100, defines: "office" },
  public_service: { jobs: 30 },
  police: { jobs: 60 },
  fire_station: { jobs: 40, defines: "civic" },
  coworking_space: { jobs: 50 },
  business_center: { jobs: 300, defines: "office" },
  office: { jobs: 50 },
  hotel: { jobs: 40, leisure: 2, defines: "office" },
  hostel: { jobs: 5 },
  prison: { jobs: 100, defines: "civic" },

  // Industry, logistics and utilities. Named industrial and railway areas come
  // as label points; their floor area is counted through the landuse anyway.
  industrial: { jobs: 20, industrial: true },
  railway: { jobs: 30, industrial: true },
  warehouse: { jobs: 30, industrial: true },
  post_depot: { jobs: 80, industrial: true },
  brewery: { jobs: 40, industrial: true },
  distillery: { jobs: 20, industrial: true },
  winery: { jobs: 20, industrial: true },
  sawmill: { jobs: 15, industrial: true },
  quarry: { jobs: 30, industrial: true },
  landfill: { jobs: 20, industrial: true },
  waste_transfer_station: { jobs: 20, industrial: true },
};
