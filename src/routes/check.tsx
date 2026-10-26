import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { Nameplate } from "../components/Nameplate";
import { ValueBar } from "../components/ValueBar";
import {
  distanceM,
  pct,
  usePlaces,
  useModel,
  type Model,
  type Verdict,
} from "../lib/data";

export const Route = createFileRoute("/check")({
  head: () => ({
    meta: [
      { title: "Check a listing — Property Lens London" },
      {
        name: "description",
        content: "Enter a home you found on a listing site and see whether its asking price is fair, and why.",
      },
    ],
  }),
  component: CheckListing,
});

interface Result {
  postcode: string;
  district: string;
  fair: number;
  verdict: Verdict;
  reasons: [string, number][];
  stationName: string;
  stationM: number;
}

const BOROUGHS: Record<string, string> = { Islington: "Islington", "Hammersmith and Fulham": "Hammersmith & Fulham" };

function estimate(model: Model, x: {
  typeTenure: string;
  newBuild: boolean;
  borough: string;
  lsoa: string;
  stationM: number;
  busy: boolean;
  area: number | null;
  rooms: number | null;
}): { log: number; parts: [string, number][] } {
  const c = model.coef;
  const get = (k: string) => c[k] ?? 0;
  const parts: [string, number][] = [
    ["Type and tenure", get(`cat__type_tenure_${x.typeTenure}`)],
    ["New build", get(`cat__new_build_${x.newBuild ? "Y" : "N"}`)],
    ["Borough", get(`cat__borough_name_${x.borough}`)],
    [
      "Neighbourhood",
      get(`cat__lsoa_code_${x.lsoa}`) + get(`cat__lsoa_flat_${x.lsoa}_${x.typeTenure.startsWith("F") ? 1 : 0}`),
    ],
    ["Distance to a station", get("num__log_station") * Math.log1p(x.stationM)],
    ["On a busy main road", get("num__busy") * (x.busy ? 1 : 0)],
  ];
  if (model.epc && model.fill) {
    const typical = model.fill.log_area_by_type_tenure[x.typeTenure] ?? Math.log(70);
    const logArea = x.area ? Math.log(x.area) : typical;
    const isFlat = x.typeTenure.startsWith("F") ? 1 : 0;
    parts.push(["Floor area", get("num__log_area") * logArea + get("num__log_area_flat") * logArea * isFlat]);
    parts.push(["Number of rooms", get("num__rooms_f") * (x.rooms ?? model.fill.rooms_median)]);
    parts.push(["Energy certificate on record", get("num__has_epc") * (x.area ? 1 : 0)]);
    parts.push(["Energy rating", get("cat__epc_band_unknown")]);
  }
  const market = get(`cat__quarter_${model.latest_quarter}`);
  const log = model.intercept + market + parts.reduce((s, [, v]) => s + v, 0);
  return { log, parts };
}

function CheckListing() {
  const model = useModel();
  const places = usePlaces();
  const [postcode, setPostcode] = useState("");
  const [asking, setAsking] = useState("");
  const [type, setType] = useState("F");
  const [tenure, setTenure] = useState("L");
  const [newBuild, setNewBuild] = useState(false);
  const [busy, setBusy] = useState(false);
  const [area, setArea] = useState("");
  const [rooms, setRooms] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const price = Number(asking.replace(/[£,\s]/g, ""));
    if (!model.data || !places.data) return;
    if (!price || price < 50_000) {
      setError("Enter the asking price in pounds, for example 650000.");
      return;
    }
    setWorking(true);
    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
      if (!res.ok) {
        setError("That postcode wasn't found. Check it on the listing and try again.");
        return;
      }
      const pc = (await res.json()) as {
        result: { postcode: string; latitude: number; longitude: number; admin_district: string; codes: Record<string, string> };
      };
      const borough = BOROUGHS[pc.result.admin_district];
      if (!borough) {
        setError(
          `${pc.result.postcode} is in ${pc.result.admin_district}. Property Lens currently covers Islington and Hammersmith & Fulham only.`,
        );
        return;
      }
      const lsoa = pc.result.codes["lsoa21"] ?? pc.result.codes["lsoa"] ?? "";
      let stationM = Infinity;
      let stationName = "";
      for (const [kind, name, lat, lon] of places.data) {
        if (kind !== "station") continue;
        const d = distanceM(pc.result.latitude, pc.result.longitude, lat, lon);
        if (d < stationM) {
          stationM = d;
          stationName = name;
        }
      }
      const { log, parts } = estimate(model.data, {
        typeTenure: `${type}${tenure}`,
        newBuild,
        borough,
        lsoa,
        stationM,
        busy,
        area: area ? Number(area) : null,
        rooms: rooms ? Number(rooms) : null,
      });
      const fair = Math.round(Math.exp(log) / 1000) * 1000;
      const band = model.data.fair_band;
      const diff = price / fair - 1;
      const verdict: Verdict = diff > band ? "above" : diff < -band ? "below" : "fair";
      const mean = model.data.contrib_mean;
      const typeName: Record<string, string> = { F: "flat", T: "terraced house", S: "semi-detached house", D: "detached house" };
      const named = (l: string): string => {
        if (l === "Type and tenure") return `${tenure === "L" ? "Leasehold" : "Freehold"} ${typeName[type] ?? "home"}`;
        if (l === "New build") return newBuild ? "New build" : "Not a new build";
        if (l === "On a busy main road") return busy ? "On a busy main road" : "Away from busy main roads";
        if (l === "Floor area") return area ? `Floor area (${area} m²)` : "Floor area (typical for this type, not entered)";
        if (l === "Distance to a station") return `Station ${Math.round(stationM / 10) * 10} m away`;
        if (l === "Number of rooms") return rooms ? `${rooms} rooms` : "Rooms (typical, not entered)";
        return l;
      };
      const reasons = parts
        .map(([l, v]) => [l, v - (mean[l] ?? 0)] as [string, number])
        .filter(([l, v]) => Math.abs(v) >= 0.02 && l !== "Energy certificate on record" && l !== "Energy rating")
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 4)
        .map(([l, v]) => [named(l), Math.exp(v) - 1] as [string, number]);
      setResult({ postcode: pc.result.postcode, district: borough, fair, verdict, reasons, stationName, stationM });
    } catch {
      setError("The postcode lookup didn't respond. Try again in a moment.");
    } finally {
      setWorking(false);
    }
  }

  const price = Number(asking.replace(/[£,\s]/g, ""));
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-8 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold sm:text-4xl">Check a listing</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Found a home on Rightmove or Zoopla? Enter its details and see what similar homes nearby have actually sold
        for, adjusted to today&apos;s market. Works for homes in Islington and Hammersmith &amp; Fulham.
      </p>

      <form onSubmit={(e) => void submit(e)} className="mt-6 grid gap-4 sm:grid-cols-2">
        <Field label="Postcode" htmlFor="pc">
          <input id="pc" required value={postcode} onChange={(e) => setPostcode(e.target.value)} placeholder="N7 8DB" className={input} />
        </Field>
        <Field label="Asking price (£)" htmlFor="price">
          <input id="price" required inputMode="numeric" value={asking} onChange={(e) => setAsking(e.target.value)} placeholder="650000" className={input} />
        </Field>
        <Field label="Type" htmlFor="type">
          <select id="type" value={type} onChange={(e) => { setType(e.target.value); setTenure(e.target.value === "F" ? "L" : "F"); }} className={input}>
            <option value="F">Flat</option>
            <option value="T">Terraced house</option>
            <option value="S">Semi-detached house</option>
            <option value="D">Detached house</option>
          </select>
        </Field>
        <Field label="Tenure" htmlFor="tenure">
          <select id="tenure" value={tenure} onChange={(e) => setTenure(e.target.value)} className={input}>
            <option value="L">Leasehold</option>
            <option value="F">Freehold</option>
          </select>
        </Field>
        {model.data?.epc && (
          <Field label="Floor area in m² (from the listing or its floor plan)" htmlFor="area">
            <input id="area" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value)} placeholder="65" className={input} />
          </Field>
        )}
        {model.data?.epc && (
          <Field label="Rooms, excluding kitchen and bathrooms (optional)" htmlFor="rooms">
            <input id="rooms" inputMode="numeric" value={rooms} onChange={(e) => setRooms(e.target.value)} placeholder="3" className={input} />
          </Field>
        )}
        <div className="flex flex-col justify-end gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={newBuild} onChange={(e) => setNewBuild(e.target.checked)} className="h-4 w-4" /> New build
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={busy} onChange={(e) => setBusy(e.target.checked)} className="h-4 w-4" /> On a busy main road
          </label>
        </div>
        <div className="sm:col-span-2">
          <button type="submit" disabled={working || !model.data} className="h-11 rounded-sm bg-primary px-6 font-medium text-primary-foreground disabled:opacity-60">
            {working ? "Checking…" : "Check the price"}
          </button>
        </div>
      </form>
      {error && <p className="mt-4 text-[var(--above)]">{error}</p>}

      {result && model.data && (
        <section className="mt-10 grid gap-8 border-t border-border pt-8 md:grid-cols-[auto_minmax(0,1fr)]">
          <div className="self-start">
            <Nameplate street={result.postcode} district={result.district} />
          </div>
          <div>
            <ValueBar price={price} fair={result.fair} band={model.data.fair_band} verdict={result.verdict} priceLabel="Asking price" />
            {result.reasons.length > 0 && (
              <p className="mt-6 text-sm text-muted-foreground">Compared with the average home sold in these two boroughs:</p>
            )}
            {result.reasons.length > 0 && (
              <ul className="mt-2 space-y-2">
                {result.reasons.map(([label, v]) => (
                  <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                    <span>{label}</span>
                    <span className="num font-semibold" style={{ color: v >= 0 ? "var(--below)" : "var(--above)" }}>{pct(v)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-6 text-sm text-muted-foreground">
              Nearest station: {result.stationName}. The model can&apos;t see inside the home, so condition, views,
              outdoor space and the lease length can justify a price outside the fair range. Typical error on
              unseen sales: ±{Math.round(model.data.test.model.median_abs_error * 100)}%.{" "}
              <Link to="/method" className="underline">How it works</Link>
            </p>
          </div>
        </section>
      )}
    </div>
  );
}

const input = "h-10 w-full rounded-sm border border-input bg-card px-3";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
