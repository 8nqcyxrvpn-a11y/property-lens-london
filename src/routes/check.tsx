import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LeafletMap } from "../components/LeafletMap";
import { Nameplate } from "../components/Nameplate";
import { ValueBar } from "../components/ValueBar";
import { NearbyList, Safety, Street, StreetPhoto, Travel } from "../components/AreaReport";
import {
  BOROUGH_CODE,
  distanceM,
  findPlace,
  loadShortlist,
  money,
  parseListing,
  pct,
  perWeek,
  safetyWords,
  saveShortlist,
  useAreas,
  useHomes,
  useModel,
  useNearby,
  usePlaces,
  useRents,
  VERDICT,
  walkMin,
  type Area,
  type Nearby,
  type ParsedListing,
  type Saved,
  type Verdict,
} from "../lib/data";
import { estimateRent, estimateSale, verdictFor, type Estimate } from "../lib/estimate";

export const Route = createFileRoute("/check")({
  head: () => ({
    meta: [
      { title: "Check a listing — Property Lens London" },
      {
        name: "description",
        content:
          "Paste a home that's for rent or sale now and see whether the price is fair, how safe the area is, what's nearby and how long it takes to get to university.",
      },
    ],
  }),
  component: CheckListing,
});

type Kind = "rent" | "sale";

interface PostcodeResult {
  postcode: string;
  latitude: number;
  longitude: number;
  admin_district: string;
  codes: Record<string, string>;
}

interface Report {
  kind: Kind;
  title: string;
  postcode: string;
  district: string;
  lat: number;
  lon: number;
  price: number;
  estimate: Estimate | null;
  verdict: Verdict | null;
  area: Area | undefined;
  nearby: Nearby | undefined;
  stationName: string;
  stationM: number | null;
  covered: boolean;
  url: string;
  beds: number | null;
  m2: number | null;
}

const COVERED: Record<string, string> = { Islington: "Islington", "Hammersmith and Fulham": "Hammersmith & Fulham" };
const BEDS: [string, string][] = [["0", "Studio"], ["1", "1 bedroom"], ["2", "2 bedrooms"], ["3", "3 bedrooms"], ["4", "4 or more"]];

async function postcodeAt(postcode: string | null, lat?: number, lon?: number): Promise<PostcodeResult | null> {
  const url = postcode
    ? `https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`
    : `https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}&limit=1&radius=500`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as { result: PostcodeResult | PostcodeResult[] | null };
  const r = Array.isArray(body.result) ? body.result[0] : body.result;
  return r ?? null;
}

function CheckListing() {
  const model = useModel();
  const places = usePlaces();
  const homes = useHomes();
  const nearby = useNearby();
  const areas = useAreas();
  const rents = useRents();

  const [kind, setKind] = useState<Kind>("rent");
  const [paste, setPaste] = useState("");
  const [parsed, setParsed] = useState<ParsedListing | null>(null);
  const [where, setWhere] = useState("");
  const [price, setPrice] = useState("");
  const [weekly, setWeekly] = useState(false);
  const [beds, setBeds] = useState("1");
  const [type, setType] = useState<"F" | "T" | "S" | "D">("F");
  const [tenure, setTenure] = useState<"F" | "L">("L");
  const [newBuild, setNewBuild] = useState(false);
  const [area, setArea] = useState("");
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [shortlist, setShortlist] = useState<Saved[]>([]);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => setShortlist(loadShortlist()), []);

  function readListing() {
    const p = parseListing(paste);
    setParsed(p);
    if (p.kind) setKind(p.kind);
    if (p.price) {
      setPrice(String(p.price));
      setWeekly(false);
    }
    if (p.beds !== undefined) setBeds(String(Math.min(4, p.beds)));
    if (p.type) {
      setType(p.type);
      setTenure(p.type === "F" ? "L" : "F");
    }
    if (p.tenure) setTenure(p.tenure);
    if (p.newBuild) setNewBuild(true);
    if (p.m2) setArea(String(p.m2));
    setUrl(p.url ?? "");
    if (p.postcode) setWhere(p.postcode);
    else if (p.address) setWhere(p.address);
  }

  async function check(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setReport(null);
    setSaveNote(null);
    const raw = Number(price.replace(/[£,\s]/g, ""));
    const monthly = kind === "rent" && weekly ? Math.round((raw * 52) / 12) : raw;
    if (!raw || (kind === "sale" && raw < 50_000) || (kind === "rent" && monthly < 200)) {
      setError(kind === "sale" ? "Enter the asking price in pounds, for example 650000." : "Enter the rent, for example 2100 a month.");
      return;
    }
    if (!where.trim()) {
      setError("Enter the postcode, or the street and postcode district from the listing (e.g. Hornsey Road, N7).");
      return;
    }
    setWorking(true);
    try {
      const isPostcode = /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(where.trim());
      let pc: PostcodeResult | null = null;
      let lat: number;
      let lon: number;
      if (isPostcode) {
        pc = await postcodeAt(where.trim());
        if (!pc) {
          setError("That postcode wasn't found. Check it on the listing and try again.");
          return;
        }
        lat = pc.latitude;
        lon = pc.longitude;
      } else {
        const hit = await findPlace(where);
        if (!hit) {
          setError(`"${where}" wasn't found in London. Try the street name with the postcode district, e.g. "Hornsey Road, N7".`);
          return;
        }
        lat = hit.lat;
        lon = hit.lon;
        pc = await postcodeAt(null, lat, lon);
        if (!pc) {
          setError("No postcode was found at that spot. Try the full postcode from the listing.");
          return;
        }
      }
      const district = COVERED[pc.admin_district];
      const covered = Boolean(district);
      const lsoa = pc.codes["lsoa21"] ?? pc.codes["lsoa"] ?? "";

      // Nearest station, and the street details of the nearest postcode we have data for.
      let stationM: number | null = null;
      let stationName = "";
      for (const [k, name, plat, plon] of places.data ?? []) {
        if (k !== "station" || !name) continue;
        const d = distanceM(lat, lon, plat, plon);
        if (stationM === null || d < stationM) {
          stationM = d;
          stationName = name;
        }
      }
      let nb: Nearby | undefined = nearby.data?.[pc.postcode];
      if (!nb && covered && homes.data && nearby.data) {
        let best = 300;
        for (const h of homes.data) {
          const d = distanceM(lat, lon, h.la, h.lo);
          if (d < best && nearby.data[h.pc]) {
            best = d;
            nb = nearby.data[h.pc];
          }
        }
      }
      if (nb?.station_name && nb.station_m !== undefined && covered) {
        // Same station as the "Nearby" list, measured from the nearest home we have.
        stationName = nb.station_name;
      }
      if (!covered) stationM = null;

      const bedsN = Number(beds);
      const m2 = area ? Number(area) : null;
      let estimate: Estimate | null = null;
      if (kind === "sale") {
        if (!covered) {
          setError(
            `${pc.postcode} is in ${pc.admin_district}. Sale prices can be checked in Islington and Hammersmith & Fulham only, where the model was trained. Rents can be checked anywhere in London.`,
          );
          return;
        }
        if (!model.data) return;
        estimate = estimateSale(model.data, {
          type,
          tenure,
          newBuild,
          borough: district ?? "",
          lsoa,
          stationM: stationM ?? 800,
          busy: nb?.street_feel === "busy",
          area: m2,
          rooms: null,
        });
      } else {
        if (!rents.data) {
          setError("The official rent figures haven't loaded yet. Try again in a moment.");
          return;
        }
        const code = district
          ? BOROUGH_CODE[district]
          : Object.entries(rents.data.boroughs).find(([, r]) => r.name === pc.admin_district)?.[0];
        if (!code || !pc.admin_district) {
          setError(`${pc.postcode} isn't in a London borough, so there's no official London rent to compare with.`);
          return;
        }
        estimate = estimateRent(rents.data, model.data, areas.data, {
          boroughCode: code,
          boroughName: district ?? pc.admin_district,
          beds: bedsN,
          lsoa: covered ? lsoa : null,
          type,
          stationM,
          area: m2,
        });
      }
      const value = kind === "rent" ? monthly : raw;
      const bedWord = bedsN === 0 ? "Studio" : `${bedsN}${bedsN >= 4 ? "+" : ""}-bed`;
      setReport({
        kind,
        title: parsed?.address && (where === parsed.postcode || where === parsed.address) ? parsed.address.replace(/,?\s*London\b.*$/i, "").replace(/,\s*[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/i, "") || `${bedWord} ${type === "F" ? "flat" : "house"}, ${pc.postcode}` : `${bedWord} ${type === "F" ? "flat" : "house"}, ${pc.postcode}`,
        postcode: pc.postcode,
        district: district ?? pc.admin_district,
        lat,
        lon,
        price: value,
        estimate,
        verdict: estimate ? verdictFor(value, estimate.fair, estimate.band) : null,
        area: covered ? areas.data?.[lsoa] : undefined,
        nearby: nb,
        stationName,
        stationM,
        covered,
        url: url.trim(),
        beds: bedsN,
        m2,
      });
    } catch {
      setError("The address lookup didn't respond. Try again in a moment.");
    } finally {
      setWorking(false);
    }
  }

  function save() {
    if (!report?.estimate || !report.verdict) return;
    const places = model.data?.places ?? {};
    const uniMin: Record<string, number> = {};
    for (const key of Object.keys(places)) {
      const m = report.area?.[`transit_min_${key}`];
      if (typeof m === "number") uniMin[key] = m;
    }
    const item: Saved = {
      key: `${report.kind}-${report.postcode}-${report.price}-${report.beds ?? ""}`,
      kind: report.kind,
      label: report.title,
      postcode: report.postcode,
      district: report.district,
      price: report.price,
      fair: report.estimate.fair,
      verdict: report.verdict,
      safety: report.area?.safety_pct ?? null,
      uniMin,
      savedAt: new Date().toISOString(),
      ...(report.beds !== null ? { beds: report.beds } : {}),
      ...(report.m2 ? { m2: report.m2 } : {}),
      ...(report.url ? { url: report.url } : {}),
      ...(report.stationName ? { station: report.stationName } : {}),
      ...(report.stationM !== null ? { stationMin: walkMin(report.stationM) } : {}),
      ...(report.nearby?.street_feel ? { street: report.nearby.street_feel } : {}),
    };
    const next = [item, ...shortlist.filter((s) => s.key !== item.key)].slice(0, 30);
    setShortlist(next);
    setSaveNote(saveShortlist(next) ? "Saved to your shortlist below." : "Saved for now; this browser won't keep it after you close the page.");
  }

  function remove(key: string) {
    const next = shortlist.filter((s) => s.key !== key);
    setShortlist(next);
    saveShortlist(next);
  }

  const rentPeriod = rents.data?.period;
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold sm:text-4xl">Check a listing</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Found a flat or room on Rightmove, Zoopla or SpareRoom? Paste the listing and see whether the price is fair,
        how safe the area is, what&apos;s nearby and how long it takes to get to university. Rents can be checked
        anywhere in London; full reports cover Islington and Hammersmith &amp; Fulham.
      </p>

      <div role="tablist" aria-label="Rent or buy" className="mt-6 inline-flex rounded-sm border border-input p-0.5">
        {(["rent", "sale"] as Kind[]).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} type="button" onClick={() => setKind(k)}
            className={`rounded-sm px-5 py-2 text-sm font-medium ${kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>
            {k === "rent" ? "To rent" : "To buy"}
          </button>
        ))}
      </div>

      <section className="mt-5 rounded-sm border border-border bg-card p-4">
        <label htmlFor="paste" className="font-medium">1. Paste the listing (optional)</label>
        <p className="mt-1 text-sm text-muted-foreground">
          On the listing page, select all (Ctrl+A or ⌘A), copy, and paste here. The price, bedrooms, size and address
          are filled in for you below; check them before you continue.
        </p>
        <textarea id="paste" value={paste} onChange={(e) => setPaste(e.target.value)} rows={4}
          placeholder={"e.g. 2 bedroom flat to rent\nHornsey Road, London N7\n£2,350 pcm\n689 sq ft"}
          className="mt-2 w-full rounded-sm border border-input bg-background p-3 text-sm" />
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="button" onClick={readListing} disabled={!paste.trim()}
            className="h-10 rounded-sm border border-foreground px-4 text-sm font-medium hover:bg-muted disabled:opacity-50">
            Read the listing
          </button>
          {parsed && (
            <span className="text-sm text-muted-foreground">
              {parsed.found.length
                ? `Found: ${parsed.found.join(", ")}. Fill in anything missing below.`
                : "Nothing recognisable was found; fill in the details below."}
            </span>
          )}
        </div>
      </section>

      <form onSubmit={(e) => void check(e)} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="font-medium sm:col-span-2 lg:col-span-3">2. Check the details</div>
        <Field label="Postcode, or street and area (e.g. Hornsey Road, N7)" htmlFor="where">
          <input id="where" required value={where} onChange={(e) => setWhere(e.target.value)} placeholder="N7 8DB" className={input} />
        </Field>
        <Field label={kind === "rent" ? "Rent (£)" : "Asking price (£)"} htmlFor="price">
          <div className="flex gap-2">
            <input id="price" required inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)}
              placeholder={kind === "rent" ? "2100" : "650000"} className={input} />
            {kind === "rent" && (
              <select aria-label="Rent period" value={weekly ? "w" : "m"} onChange={(e) => setWeekly(e.target.value === "w")} className={`${input} w-32`}>
                <option value="m">a month</option>
                <option value="w">a week</option>
              </select>
            )}
          </div>
        </Field>
        <Field label="Bedrooms" htmlFor="beds">
          <select id="beds" value={beds} onChange={(e) => setBeds(e.target.value)} className={input}>
            {BEDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Type" htmlFor="type">
          <select id="type" value={type} onChange={(e) => { const t = e.target.value as typeof type; setType(t); setTenure(t === "F" ? "L" : "F"); }} className={input}>
            <option value="F">Flat or studio</option>
            <option value="T">Terraced house</option>
            <option value="S">Semi-detached house</option>
            <option value="D">Detached house</option>
          </select>
        </Field>
        <Field label="Floor area in m² (optional; sq ft is converted when pasted)" htmlFor="area">
          <input id="area" inputMode="numeric" value={area} onChange={(e) => setArea(e.target.value)} placeholder="65" className={input} />
        </Field>
        <Field label="Link to the listing (optional)" htmlFor="url">
          <input id="url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.rightmove.co.uk/properties/…" className={input} />
        </Field>
        {kind === "sale" && (
          <>
            <Field label="Tenure" htmlFor="tenure">
              <select id="tenure" value={tenure} onChange={(e) => setTenure(e.target.value as "F" | "L")} className={input}>
                <option value="L">Leasehold (incl. share of freehold)</option>
                <option value="F">Freehold</option>
              </select>
            </Field>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={newBuild} onChange={(e) => setNewBuild(e.target.checked)} className="h-4 w-4" /> New build
            </label>
          </>
        )}
        <div className="sm:col-span-2 lg:col-span-3">
          <button type="submit" disabled={working || !model.data}
            className="h-11 rounded-sm bg-primary px-6 font-medium text-primary-foreground disabled:opacity-60">
            {working ? "Checking…" : kind === "rent" ? "Check the rent" : "Check the price"}
          </button>
        </div>
      </form>
      {error && <p className="mt-4 text-[var(--above)]">{error}</p>}

      {report && <ReportView report={report} onSave={save} saveNote={saveNote} rentPeriod={rentPeriod} />}

      <Shortlist items={shortlist} onRemove={remove} />
    </div>
  );
}

function ReportView({ report: r, onSave, saveNote, rentPeriod }: {
  report: Report;
  onSave: () => void;
  saveNote: string | null;
  rentPeriod: string | undefined;
}) {
  const rent = r.kind === "rent";
  return (
    <div className="mt-10 border-t border-border pt-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Nameplate street={r.title} district={`${r.postcode} · ${r.district}`} />
        <div className="flex flex-wrap gap-2 text-sm">
          {r.url && (
            <a href={r.url} target="_blank" rel="noreferrer" className="rounded-sm bg-primary px-4 py-2 font-medium text-primary-foreground">
              Open the listing to contact the {rent ? "landlord or agent" : "agent"}
            </a>
          )}
          <button type="button" onClick={onSave} disabled={!r.estimate}
            className="rounded-sm border border-input bg-card px-4 py-2 hover:bg-muted disabled:opacity-50">
            Save to shortlist
          </button>
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        {rent ? "For rent" : "For sale"} now{r.m2 ? ` · ${r.m2} m²` : ""}
        {rent ? ` · ${money(perWeek(r.price))} a week` : ""}
        {saveNote ? ` · ${saveNote}` : ""}
      </p>

      <section className="mt-6 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          {r.estimate && r.verdict ? (
            <>
              <ValueBar price={r.price} fair={r.estimate.fair} band={r.estimate.band} verdict={r.verdict}
                priceLabel={rent ? "Rent" : "Asking price"} fairLabel={rent ? "Typical rent here" : "Fair value estimate"}
                unit={rent ? " a month" : ""} />
              {r.estimate.reasons.length > 0 && (
                <ul className="mt-6 space-y-2">
                  {r.estimate.reasons.map(([label, v]) => (
                    <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
                      <span>{label}</span>
                      <span className="num font-semibold" style={{ color: v >= 0 ? "var(--below)" : "var(--above)" }}>{pct(v)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-sm text-muted-foreground">
                {r.estimate.basis} Neither estimate can see inside the home: condition, furniture, bills included,
                outdoor space or a long lease can justify a price outside the range.{" "}
                <Link to="/method" className="underline">How it works</Link>
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No official {rent ? `rent figure (${rentPeriod ?? "latest"})` : "estimate"} is available for this home.
            </p>
          )}
        </div>
        <div className="space-y-4">
          <StreetPhoto lat={r.lat} lon={r.lon} label={r.title} />
          <LeafletMap className="h-[240px] w-full rounded-sm border border-border"
            points={[{ id: "listing", lat: r.lat, lon: r.lon, color: r.verdict ? VERDICT[r.verdict].tone : "var(--fair)", label: r.title }]}
            center={[r.lat, r.lon]} zoom={15} selected="listing" />
        </div>
      </section>

      {r.covered ? (
        <div className="mt-12 grid gap-10 md:grid-cols-2">
          <Safety area={r.area} />
          <NearbyList nb={r.nearby} />
          <Street nb={r.nearby} />
          <Travel lat={r.lat} lon={r.lon} area={r.area} />
        </div>
      ) : (
        <p className="mt-10 max-w-2xl text-muted-foreground">
          Safety, nearby places, street noise and travel times are only available in Islington and Hammersmith &amp;
          Fulham for now. {r.district} isn&apos;t covered yet.
        </p>
      )}
    </div>
  );
}

function Shortlist({ items, onRemove }: { items: Saved[]; onRemove: (key: string) => void }) {
  const model = useModel();
  const uni = useMemo(() => Object.entries(model.data?.places ?? {}).slice(0, 3), [model.data]);
  if (!items.length) return null;
  return (
    <section className="mt-16 border-t border-border pt-8">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Your shortlist</h2>
      <p className="mt-1 text-sm text-muted-foreground">Kept in this browser only. Nobody else can see it.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-2 pr-3 font-normal">Home</th>
              <th className="py-2 pr-3 font-normal">Price</th>
              <th className="py-2 pr-3 font-normal">Value</th>
              <th className="py-2 pr-3 font-normal">Safety</th>
              <th className="py-2 pr-3 font-normal">Station</th>
              {uni.map(([k, p]) => <th key={k} className="py-2 pr-3 font-normal">To {p.name.split(" (")[0]}</th>)}
              <th className="py-2 font-normal"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => {
              const v = VERDICT[s.verdict];
              const safe = safetyWords(s.safety);
              return (
                <tr key={s.key} className="border-b border-border align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium">{s.label}</div>
                    <div className="text-muted-foreground">{s.kind === "rent" ? "To rent" : "For sale"} · {s.district}{s.street ? ` · ${s.street} street` : ""}</div>
                  </td>
                  <td className="num py-2.5 pr-3">{money(s.price)}{s.kind === "rent" ? " pcm" : ""}</td>
                  <td className="py-2.5 pr-3" style={{ color: v.tone }}>{v.label} ({pct(s.price / s.fair - 1)})</td>
                  <td className="py-2.5 pr-3" style={{ color: safe.tone }}>{s.safety === null ? "–" : safe.label.split(" than")[0]?.replace(" for these two boroughs", "")}</td>
                  <td className="py-2.5 pr-3">{s.station ? `${s.station}, ${s.stationMin} min` : "–"}</td>
                  {uni.map(([k]) => <td key={k} className="num py-2.5 pr-3">{s.uniMin?.[k] !== undefined ? `${s.uniMin[k]} min` : "–"}</td>)}
                  <td className="whitespace-nowrap py-2.5 text-right">
                    {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mr-3 underline">Listing</a>}
                    <button type="button" onClick={() => onRemove(s.key)} className="text-muted-foreground underline">Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
