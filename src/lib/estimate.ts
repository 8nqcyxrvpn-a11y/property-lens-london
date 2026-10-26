import { type Area, type Model, type Rents, type Verdict } from "./data";

/* Estimates for a home that is on the market now, worked out in the browser from the published model. */

export interface SaleInput {
  type: "F" | "T" | "S" | "D";
  tenure: "F" | "L";
  newBuild: boolean;
  borough: string;
  lsoa: string;
  stationM: number;
  busy: boolean;
  area: number | null;
  rooms: number | null;
}

export interface Estimate {
  fair: number;
  band: number;
  reasons: [string, number][]; // label, effect as a fraction
  basis: string;
}

const TYPE_WORD: Record<string, string> = { F: "flat", T: "terraced house", S: "semi-detached house", D: "detached house" };

export function verdictFor(price: number, fair: number, band: number): Verdict {
  const diff = price / fair - 1;
  return diff > band ? "above" : diff < -band ? "below" : "fair";
}

/** The sale-price model: the same ridge regression as the sold homes, at today's market level. */
export function estimateSale(model: Model, x: SaleInput): Estimate {
  const c = model.coef;
  const get = (k: string) => c[k] ?? 0;
  const tt = `${x.type}${x.tenure}`;
  const isFlat = x.type === "F" ? 1 : 0;
  const parts: [string, number][] = [
    ["Type and tenure", get(`cat__type_tenure_${tt}`)],
    ["New build", get(`cat__new_build_${x.newBuild ? "Y" : "N"}`)],
    ["Borough", get(`cat__borough_name_${x.borough}`)],
    ["Neighbourhood", get(`cat__lsoa_code_${x.lsoa}`) + get(`cat__lsoa_flat_${x.lsoa}_${isFlat}`)],
    ["Distance to a station", get("num__log_station") * Math.log1p(x.stationM)],
    ["On a busy main road", get("num__busy") * (x.busy ? 1 : 0)],
  ];
  if (model.epc && model.fill) {
    const typical = model.fill.log_area_by_type_tenure[tt] ?? Math.log(70);
    const logArea = x.area ? Math.log(x.area) : typical;
    parts.push(["Floor area", get("num__log_area") * logArea + get("num__log_area_flat") * logArea * isFlat]);
    parts.push(["Number of rooms", get("num__rooms_f") * (x.rooms ?? model.fill.rooms_median)]);
    parts.push(["Energy certificate on record", get("num__has_epc") * (x.area ? 1 : 0)]);
    parts.push(["Energy rating", get("cat__epc_band_unknown")]);
  }
  const log = model.intercept + get(`cat__quarter_${model.latest_quarter}`) + parts.reduce((s, [, v]) => s + v, 0);
  const named = (l: string): string => {
    if (l === "Type and tenure") return `${x.tenure === "L" ? "Leasehold" : "Freehold"} ${TYPE_WORD[x.type] ?? "home"}`;
    if (l === "New build") return x.newBuild ? "New build" : "Not a new build";
    if (l === "On a busy main road") return x.busy ? "On a busy main road" : "Away from busy main roads";
    if (l === "Floor area") return x.area ? `Floor area (${x.area} m²)` : "Floor area (typical for this type, not given)";
    if (l === "Distance to a station") return `Station ${Math.round(x.stationM / 10) * 10} m away`;
    if (l === "Number of rooms") return x.rooms ? `${x.rooms} rooms` : "Rooms (typical, not given)";
    return l;
  };
  const mean = model.contrib_mean;
  const reasons = parts
    .map(([l, v]) => [l, v - (mean[l] ?? 0)] as [string, number])
    .filter(([l, v]) => Math.abs(v) >= 0.02 && l !== "Energy certificate on record" && l !== "Energy rating")
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5)
    .map(([l, v]) => [named(l), Math.exp(v) - 1] as [string, number]);
  return {
    fair: Math.round(Math.exp(log) / 1000) * 1000,
    band: model.fair_band,
    reasons,
    basis: `Compared with the average home sold in these two boroughs. Typical error on unseen sales: ±${Math.round(
      model.test.model.median_abs_error * 100,
    )}%.`,
  };
}

export interface RentInput {
  boroughCode: string;
  boroughName: string;
  beds: number; // 0 = studio, 4 = four or more
  lsoa: string | null; // only inside the two covered boroughs
  type: "F" | "T" | "S" | "D";
  stationM: number | null;
  area: number | null;
}

const TYPICAL_M2 = [32, 50, 70, 90, 120];
const BEDS_WORD = ["studio", "1-bed", "2-bed", "3-bed", "4+ bed"];
/** How strongly rents follow sale prices between neighbourhoods (rents vary about half as much). */
const RENT_ELASTICITY = 0.5;
export const RENT_BAND = 0.2;

/**
 * Typical monthly rent: the official borough average for this many bedrooms, adjusted for the
 * neighbourhood (from the sale-price model), the size and the distance to a station.
 */
export function estimateRent(
  rents: Rents,
  model: Model | undefined,
  areas: Record<string, Area> | undefined,
  x: RentInput,
): Estimate | null {
  const row = rents.boroughs[x.boroughCode];
  if (!row) return null;
  const beds = Math.max(0, Math.min(4, x.beds));
  const key = beds === 0 ? "1" : (String(beds) as "1" | "2" | "3" | "4");
  let base = row[key];
  if (!base) return null;
  const reasons: [string, number][] = [];
  let basisNote = "";
  if (beds === 0) {
    base = base * 0.82;
    basisNote = " Studios use 82% of the one-bed average, as the official figures don't list studios separately.";
  }
  let factor = 1;
  if (model && areas && x.lsoa) {
    const c = model.coef;
    const flat = x.type === "F" ? 1 : 0;
    const eff = (l: string) => (c[`cat__lsoa_code_${l}`] ?? 0) + (c[`cat__lsoa_flat_${l}_${flat}`] ?? 0);
    const borough = areas[x.lsoa]?.borough;
    const peers = Object.entries(areas).filter(([, a]) => a.borough === borough).map(([l]) => eff(l));
    if (peers.length > 5) {
      const avg = peers.reduce((s, v) => s + v, 0) / peers.length;
      const f = Math.exp(RENT_ELASTICITY * (eff(x.lsoa) - avg));
      if (Math.abs(f - 1) >= 0.01) reasons.push([`This neighbourhood versus the ${x.boroughName} average`, f - 1]);
      factor *= f;
    }
    if (x.stationM !== null) {
      const typical = Math.log1p(600);
      const f = Math.exp(RENT_ELASTICITY * (c["num__log_station"] ?? 0) * (Math.log1p(x.stationM) - typical));
      if (Math.abs(f - 1) >= 0.01) reasons.push([`Station ${Math.round(x.stationM / 10) * 10} m away`, f - 1]);
      factor *= f;
    }
  }
  if (x.area) {
    const typical = TYPICAL_M2[beds] ?? 70;
    const f = Math.min(1.35, Math.max(0.75, (x.area / typical) ** 0.4));
    if (Math.abs(f - 1) >= 0.01) reasons.push([`${x.area} m², versus about ${typical} m² for a typical ${BEDS_WORD[beds]}`, f - 1]);
    factor *= f;
  }
  reasons.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return {
    fair: Math.round((base * factor) / 5) * 5,
    band: RENT_BAND,
    reasons,
    basis: `Starting from the official average rent for a ${BEDS_WORD[beds]} in ${x.boroughName}: £${Math.round(
      base,
    ).toLocaleString("en-GB")} a month (ONS, ${rents.period}).${basisNote} This is rougher than the sale estimate, so the fair range is wider (±${Math.round(
      RENT_BAND * 100,
    )}%).`,
  };
}

