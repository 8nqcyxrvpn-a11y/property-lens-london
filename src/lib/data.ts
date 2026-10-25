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
  test: { model: Metrics; baseline: Metrics; by_type: Record<string, Metrics> };
  out_of_fold: Metrics;
  sales: number;
  first_sale: string;
  last_sale: string;
  crime_months: string;
  places: Record<string, { name: string; lat: number; lon: number }>;
  verdicts: Record<string, number>;
  epc: boolean;
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

/** Find a place in London: postcodes via postcodes.io, anything else via OpenStreetMap search. */
export async function findPlace(query: string): Promise<Geo | null> {
  const q = query.trim();
  if (!q) return null;
  if (/^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(q)) {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(q)}`);
    if (res.ok) {
      const body = (await res.json()) as { result: { latitude: number; longitude: number; postcode: string } };
      return { label: body.result.postcode, lat: body.result.latitude, lon: body.result.longitude };
    }
  }
  const params = new URLSearchParams({
    q: `${q}, London`,
    format: "jsonv2",
    limit: "1",
    viewbox: "-0.35,51.62,0.05,51.42",
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

export const SHORTCUTS: Geo[] = [
  { label: "LSE", lat: 51.51442, lon: -0.11648 },
  { label: "UCL", lat: 51.52456, lon: -0.134 },
  { label: "King's College", lat: 51.5115, lon: -0.116 },
  { label: "Westfield London", lat: 51.50708, lon: -0.22144 },
  { label: "Holloway Road", lat: 51.55275, lon: -0.11307 },
  { label: "Angel", lat: 51.53225, lon: -0.10583 },
];

/** Plain-language reading of how many personal-safety crimes an area has, versus the others covered. */
export function safetyWords(p: number | null): { label: string; tone: string } {
  if (p === null) return { label: "No crime data", tone: "var(--fair)" };
  if (p <= 0.33) return { label: "Fewer street crimes than most", tone: "var(--below)" };
  if (p <= 0.66) return { label: "Typical for these boroughs", tone: "var(--fair)" };
  return { label: "More street crimes than most", tone: "var(--above)" };
}

/** IMD deciles: 1 = most deprived 10% of areas in England, 10 = least deprived. */
export function decileWords(d: number | null): string {
  if (d === null || Number.isNaN(d)) return "not available";
  if (d <= 2) return `among the most deprived 20% in England (decile ${d})`;
  if (d <= 4) return `more deprived than average (decile ${d})`;
  if (d <= 6) return `around the national middle (decile ${d})`;
  if (d <= 8) return `less deprived than average (decile ${d})`;
  return `among the least deprived 20% in England (decile ${d})`;
}
