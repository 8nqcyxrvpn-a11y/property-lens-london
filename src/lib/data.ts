import { useQuery } from "@tanstack/react-query";

/** One sold home, as exported by pipeline/step4_model.py (short keys keep the file small). */
export interface Home {
  id: string;
  a: string; // address
  pc: string; // postcode
  b: "I" | "H"; // borough
  la: number;
  lo: number;
  l: string; // neighbourhood (LSOA) code
  p: number; // sale price
  d: string; // sale date
  t: "F" | "T" | "S" | "D";
  te: "F" | "L";
  n: 0 | 1; // new build
  f: number; // fair value estimate
  v: Verdict;
  w: [string, number][]; // biggest reasons: [label, effect as a fraction]
  m2?: number;
  r?: number;
  e?: string;
}

export type Verdict = "below" | "fair" | "above";

export interface Nearby {
  station_m?: number;
  station_name?: string;
  supermarket_m?: number;
  supermarket_name?: string;
  supermarket_500m?: number;
  cafe_m?: number;
  cafe_500m?: number;
  starbucks_m?: number;
  starbucks_name?: string;
  gym_m?: number;
  gym_name?: string;
  park_m?: number;
  park_name?: string;
  pharmacy_m?: number;
  main_road_m?: number;
  any_main_road_m?: number;
  street_feel?: "busy" | "moderate" | "quiet";
}

export interface Area {
  lsoa_name: string;
  ward: string;
  borough: string;
  imd_decile: number | null;
  imd_income_decile: number | null;
  imd_crime_decile: number | null;
  imd_living_env_decile: number | null;
  crime_total: number | null;
  crime_personal_safety: number | null;
  crime_violent_crime: number | null;
  crime_robbery: number | null;
  crime_theft_from_the_person: number | null;
  crime_anti_social_behaviour: number | null;
  safety_pct: number | null; // share of covered areas with fewer personal-safety crimes
  crime_months: string;
  [key: string]: string | number | null;
}

export type Place = [kind: string, name: string, lat: number, lon: number];

export interface Metrics {
  median_abs_error: number;
  within_10pct: number;
  within_20pct: number;
  n: number;
}

export interface Model {
  intercept: number;
  coef: Record<string, number>;
  latest_quarter: string;
  fair_band: number;
  test_from: string;
  test: { model: Metrics; baseline: Metrics; baseline_per_m2: Metrics | null; model_sized?: Metrics | null; by_type: Record<string, Metrics> };
  out_of_fold: Metrics;
  sales: number;
  first_sale: string;
  last_sale: string;
  crime_months: string;
  places: Record<string, { name: string; lat: number; lon: number }>;
  verdicts: Record<string, number>;
  epc: boolean;
  contrib_mean: Record<string, number>;
  fill: { log_area_by_type_tenure: Record<string, number>; rooms_median: number } | null;
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`/data/${name}.json`);
  if (!res.ok) throw new Error(`The ${name} data could not be loaded (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

const forever = { staleTime: Infinity, gcTime: Infinity, retry: 1 } as const;
export const useHomes = () => useQuery({ queryKey: ["homes"], queryFn: () => getJson<Home[]>("homes"), ...forever });
export const useNearby = () =>
  useQuery({ queryKey: ["nearby"], queryFn: () => getJson<Record<string, Nearby>>("nearby"), ...forever });
export const useAreas = () =>
  useQuery({ queryKey: ["areas"], queryFn: () => getJson<Record<string, Area>>("areas"), ...forever });
export const usePlaces = () => useQuery({ queryKey: ["places"], queryFn: () => getJson<Place[]>("places"), ...forever });
export const useModel = () => useQuery({ queryKey: ["model"], queryFn: () => getJson<Model>("model"), ...forever });

export const TYPE_NAME: Record<Home["t"], string> = {
  F: "Flat",
  T: "Terraced house",
  S: "Semi-detached house",
  D: "Detached house",
};
export const BOROUGH_NAME: Record<Home["b"], string> = { I: "Islington", H: "Hammersmith & Fulham" };

export const VERDICT: Record<Verdict, { label: string; tone: string }> = {
  below: { label: "Below fair value", tone: "var(--below)" },
  fair: { label: "Fair value", tone: "var(--fair)" },
  above: { label: "Above fair value", tone: "var(--above)" },
};

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
export const money = (n: number) => gbp.format(n);
export const shortMoney = (n: number) =>
  n >= 1_000_000 ? `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2).replace(/\.?0+$/, "")}m` : `£${Math.round(n / 1000)}k`;
export const pct = (x: number, digits = 0) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits)}%`;
export const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(s));
}

/** Rough walking time: straight-line distance x 1.3 for real streets, at 4.8 km/h. */
export const walkMin = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));
export const cycleMin = (m: number) => Math.max(1, Math.round((m * 1.3) / 250));
export const metres = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

export function mapsDirections(fromLat: number, fromLon: number, to: string, mode: "transit" | "walking" = "transit") {
  const params = new URLSearchParams({ api: "1", origin: `${fromLat},${fromLon}`, destination: to, travelmode: mode });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
export const streetView = (lat: number, lon: number) =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`;
export const mapsPlace = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

export interface Geo {
  label: string;
  lat: number;
  lon: number;
}

/** Turn "near Big Ben" or "flats close to UCL" into "Big Ben" / "UCL" before searching. */
export function cleanPlaceQuery(query: string): string {
  return query
    .trim()
    .replace(/^(homes?|flats?|houses?|places?|property|properties|rooms?)\s+/i, "")
    .replace(/^(near(by)?|close to|next to|around|by|walking distance (to|from)|within walking distance of|in)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

/** Find a place in London: postcodes via postcodes.io, anything else via OpenStreetMap search. */
export async function findPlace(query: string): Promise<Geo | null> {
  const q = cleanPlaceQuery(query);
  if (!q) return null;
  if (/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(q)) {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
    if (res.ok) {
      const body = (await res.json()) as { result: { latitude: number; longitude: number; postcode: string } };
      return { label: body.result.postcode, lat: body.result.latitude, lon: body.result.longitude };
    }
  }
  if (/^[A-Za-z]{1,2}\d[A-Za-z\d]?$/.test(q)) {
    const res = await fetch(`https://api.postcodes.io/outcodes/${encodeURIComponent(q)}`);
    if (res.ok) {
      const body = (await res.json()) as { result: { latitude: number; longitude: number; outcode: string } };
      return { label: body.result.outcode, lat: body.result.latitude, lon: body.result.longitude };
    }
  }
  const params = new URLSearchParams({
    q: `${q}, London`,
    format: "jsonv2",
    limit: "1",
    viewbox: "-0.52,51.70,0.34,51.28", // Greater London
    bounded: "1",
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { "Accept-Language": "en" },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as { lat: string; lon: string; name?: string; display_name: string }[];
  const hit = hits[0];
  if (!hit) return null;
  return { label: hit.name || hit.display_name.split(",")[0] || q, lat: Number(hit.lat), lon: Number(hit.lon) };
}

/** Universities students most often commute to from these two boroughs. */
export const UNIVERSITIES: Geo[] = [
  { label: "LSE", lat: 51.51442, lon: -0.11648 },
  { label: "UCL", lat: 51.52456, lon: -0.134 },
  { label: "King's College", lat: 51.5115, lon: -0.116 },
  { label: "City St George's", lat: 51.5277, lon: -0.1025 },
  { label: "Imperial", lat: 51.4988, lon: -0.1749 },
  { label: "SOAS", lat: 51.5225, lon: -0.129 },
];

export const SHORTCUTS: Geo[] = [
  { label: "King's Cross", lat: 51.5308, lon: -0.1238 },
  { label: "Angel", lat: 51.53225, lon: -0.10583 },
  { label: "Holloway Road", lat: 51.55275, lon: -0.11307 },
  { label: "Highbury & Islington", lat: 51.546, lon: -0.1041 },
  { label: "Westfield London", lat: 51.50708, lon: -0.22144 },
  { label: "Hammersmith", lat: 51.4927, lon: -0.2229 },
];

/** Plain-language reading of how many personal-safety crimes an area has, versus the others covered. */
export function safetyWords(p: number | null): { label: string; tone: string } {
  if (p === null) return { label: "No crime data", tone: "var(--fair)" };
  if (p <= 0.33) return { label: "Safer than most of these two boroughs", tone: "var(--below)" };
  if (p <= 0.66) return { label: "Typical for these two boroughs", tone: "var(--fair)" };
  return { label: "Less safe than most of these two boroughs", tone: "var(--above)" };
}

/** IMD deciles: 1 = most deprived 10% of areas in England, 10 = least deprived. */
export function decileWords(d: number | null, kind: "deprivation" | "crime" = "deprivation"): string {
  if (d === null || Number.isNaN(d)) return "not available";
  const [most, more, less, least] =
    kind === "crime"
      ? ["among the highest-crime 20% of areas", "higher crime than average", "lower crime than average", "among the lowest-crime 20% of areas"]
      : ["among the most deprived 20% of areas", "more deprived than average", "less deprived than average", "among the least deprived 20% of areas"];
  if (d <= 2) return `${most} (decile ${d} of 10)`;
  if (d <= 4) return `${more} (decile ${d} of 10)`;
  if (d <= 6) return `around the middle for England (decile ${d} of 10)`;
  if (d <= 8) return `${less} (decile ${d} of 10)`;
  return `${least} (decile ${d} of 10)`;
}

/* ---------- Rents ---------- */

export interface RentRow {
  name: string;
  all?: number;
  studio?: number;
  "1"?: number;
  "2"?: number;
  "3"?: number;
  "4"?: number;
}
export interface Rents {
  period: string;
  source: string;
  url: string;
  boroughs: Record<string, RentRow>;
}
export const useRents = () =>
  useQuery({
    queryKey: ["rents"],
    queryFn: async () => {
      const res = await fetch("/data/rents.json");
      return res.ok ? ((await res.json()) as Rents) : null;
    },
    ...forever,
  });
export const BOROUGH_CODE: Record<string, string> = { Islington: "E09000019", "Hammersmith & Fulham": "E09000013" };
export const perWeek = (pcm: number) => Math.round((pcm * 12) / 52);

/* ---------- Listing sites ---------- */

export const outcode = (postcode: string) => postcode.trim().toUpperCase().split(/\s+/)[0] ?? "";
export function listingLinks(postcode: string, kind: "sale" | "rent") {
  const oc = outcode(postcode).toLowerCase();
  const verb = kind === "sale" ? "for-sale" : "to-rent";
  const links = [
    { label: "Rightmove", href: `https://www.rightmove.co.uk/property-${verb}/${oc.toUpperCase()}.html` },
    { label: "Zoopla", href: `https://www.zoopla.co.uk/${verb}/property/${oc}/` },
    { label: "OnTheMarket", href: `https://www.onthemarket.com/${verb}/property/${oc}/` },
  ];
  if (kind === "rent")
    links.push({ label: "SpareRoom (rooms)", href: `https://www.spareroom.co.uk/flatshare/?search=${encodeURIComponent(oc.toUpperCase())}` });
  return links;
}

/* ---------- Photos ---------- */

/**
 * Google Maps Embed API key, restricted to this site's address in Google Cloud.
 * Embedding Street View this way is free. Leave empty to show a Street View link instead.
 */
export const GOOGLE_EMBED_KEY = "";
export const streetViewEmbed = (lat: number, lon: number) =>
  GOOGLE_EMBED_KEY
    ? `https://www.google.com/maps/embed/v1/streetview?key=${GOOGLE_EMBED_KEY}&location=${lat},${lon}&fov=80&pitch=5`
    : null;

/* ---------- Pasted listings ---------- */

export interface ParsedListing {
  kind?: "sale" | "rent";
  price?: number; // sale price, or monthly rent
  beds?: number; // 0 = studio
  m2?: number;
  postcode?: string;
  address?: string;
  type?: "F" | "T" | "S" | "D";
  tenure?: "F" | "L";
  newBuild?: boolean;
  url?: string;
  found: string[];
}

const num = (s: string) => Number(s.replace(/[,\s]/g, ""));

/** Read the useful facts out of text copied from a Rightmove, Zoopla or agent listing. */
export function parseListing(text: string): ParsedListing {
  const t = text.replace(/\u00a0/g, " ");
  const low = t.toLowerCase();
  const out: ParsedListing = { found: [] };

  const url = t.match(/https?:\/\/[^\s]+/);
  if (url) out.url = url[0];

  const rent = t.match(/£\s?([\d,]+(?:\.\d+)?)\s*(pcm|per calendar month|per month|a month|\/\s?month|pw|per week|a week|\/\s?week)/i);
  if (rent?.[1] && rent[2]) {
    const v = num(rent[1]);
    out.kind = "rent";
    out.price = /pw|week/i.test(rent[2]) ? Math.round((v * 52) / 12) : Math.round(v);
    out.found.push("rent");
  } else {
    const prices = [...t.matchAll(/£\s?([\d,]{5,}(?:\.\d+)?)(?!\s*(?:pcm|pw|per|\/))/gi)].map((m) => num(m[1] ?? "0"));
    const sale = prices.find((p) => p >= 50_000);
    if (sale) {
      out.kind = "sale";
      out.price = sale;
      out.found.push("price");
    } else if (/to rent|to let|let agreed/.test(low)) out.kind = "rent";
    else if (/for sale|offers (in excess|over)|guide price/.test(low)) out.kind = "sale";
  }

  if (/\bstudio\b/.test(low)) {
    out.beds = 0;
    out.found.push("studio");
  } else {
    const beds = low.match(/(\d+)\s*(?:-|\s)?\s*(?:bed(?:room)?s?)\b/) ?? low.match(/bedrooms?\s*[:x×]?\s*(\d+)/);
    if (beds?.[1]) {
      out.beds = Number(beds[1]);
      out.found.push("bedrooms");
    }
  }

  const sqft = low.match(/([\d,]{2,6})\s*(?:sq\.?\s?ft|sqft|square f(?:ee|oo)t|ft²|ft2)/);
  const sqm = low.match(/([\d,.]{2,6})\s*(?:sq\.?\s?m\b|sqm|square met(?:re|er)s?|m²|m2\b)/);
  if (sqm?.[1]) out.m2 = Math.round(num(sqm[1]));
  else if (sqft?.[1]) out.m2 = Math.round(num(sqft[1]) / 10.764);
  if (out.m2 && (out.m2 < 10 || out.m2 > 1500)) delete out.m2;
  if (out.m2) out.found.push("size");

  const pc = t.match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i);
  if (pc?.[1] && pc[2]) {
    out.postcode = `${pc[1]} ${pc[2]}`.toUpperCase();
    out.found.push("postcode");
  }
  const addr = t.split("\n").map((l) => l.trim()).find((l) => /,\s*(london\s*)?[A-Z]{1,2}\d[A-Z\d]?\b/i.test(l) && l.length < 120);
  if (addr) {
    out.address = addr.replace(/^.*?\b(for sale|to rent|to let|for rent)\s+(in|on|at)\s+/i, "");
    if (!out.postcode) out.found.push("address");
  }

  if (/\b(flat|apartment|maisonette|studio|penthouse|duplex)\b/.test(low)) out.type = "F";
  else if (/\bsemi[- ]detached\b/.test(low)) out.type = "S";
  else if (/\bdetached\b/.test(low)) out.type = "D";
  else if (/\b(terrace|terraced|town ?house|end of terrace|house)\b/.test(low)) out.type = "T";
  if (out.type) out.found.push("type");

  if (/share of freehold|leasehold/.test(low)) out.tenure = "L";
  else if (/\bfreehold\b/.test(low)) out.tenure = "F";
  if (/\bnew[- ]build\b|\bnew home\b|brand new development|newly built/.test(low)) out.newBuild = true;
  return out;
}

/* ---------- Shortlist (kept in this browser only) ---------- */

export interface Saved {
  key: string;
  kind: "sale" | "rent";
  label: string;
  postcode: string;
  district: string;
  price: number; // sale price or rent per month
  fair: number;
  verdict: Verdict;
  beds?: number;
  m2?: number;
  url?: string;
  safety: number | null;
  station?: string;
  stationMin?: number;
  street?: string;
  uniMin?: Record<string, number>;
  savedAt: string;
}
const SHORTLIST_KEY = "property-lens-shortlist";
export function loadShortlist(): Saved[] {
  try {
    const raw = window.localStorage.getItem(SHORTLIST_KEY);
    const list = raw ? (JSON.parse(raw) as Saved[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function saveShortlist(list: Saved[]): boolean {
  try {
    window.localStorage.setItem(SHORTLIST_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}
