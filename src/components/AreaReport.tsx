import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  cycleMin,
  decileWords,
  distanceM,
  listingLinks,
  mapsDirections,
  metres,
  safetyWords,
  streetView,
  streetViewEmbed,
  useModel,
  walkMin,
  type Area,
  type Nearby,
} from "../lib/data";

/* The parts of a home's report that describe its surroundings, shared by sold homes and checked listings. */

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

export function Safety({ area }: { area: Area | undefined }) {
  if (!area) return <Section title="Safety and the area"><p className="text-muted-foreground">No area data for this postcode.</p></Section>;
  const s = safetyWords(area.safety_pct);
  return (
    <Section title="Safety and the area">
      <p>
        <span className="font-semibold" style={{ color: s.tone }}>{s.label}.</span>{" "}
        {area.crime_personal_safety ?? 0} street crimes against people (violence and sexual offences, robbery,
        theft from the person, public order, weapons) were recorded within about 250 m in the last 12 months
        ({area.crime_months}).
      </p>
      <p className="text-muted-foreground">
        Of those, {area.crime_violent_crime ?? 0} were violence and sexual offences and {area.crime_robbery ?? 0} robbery.
        Busy shopping streets and stations record more crime because more people pass through, so walk it at night
        before deciding.
      </p>
      <p>
        Compared with all of England, the official crime measure puts this neighbourhood{" "}
        {decileWords(area.imd_crime_decile, "crime")}. Inner London scores high on this, so the comparison with
        nearby streets above is usually more useful.
      </p>
      <p>Overall deprivation: {decileWords(area.imd_decile)}.</p>
      <p className="text-sm text-muted-foreground">{area.lsoa_name}, {area.ward} ward. Deprivation from the English Indices of Deprivation 2025.</p>
    </Section>
  );
}

export function NearbyList({ nb }: { nb: Nearby | undefined }) {
  if (!nb) return <Section title="Nearby"><p className="text-muted-foreground">No nearby data for this postcode.</p></Section>;
  const row = (label: string, name: string | undefined, m: number | undefined, extra?: string) =>
    m === undefined ? null : (
      <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <span>
          <span className="text-muted-foreground">{label}:</span> {name || "nearest"}
          {extra ? <span className="text-muted-foreground"> {extra}</span> : null}
        </span>
        <span className="num text-muted-foreground">{walkMin(m)} min walk</span>
      </li>
    );
  return (
    <Section title="Nearby">
      <ul className="space-y-2">
        {row("Station", nb.station_name, nb.station_m)}
        {row("Supermarket", nb.supermarket_name, nb.supermarket_m, nb.supermarket_500m ? `(${nb.supermarket_500m} within 500 m)` : undefined)}
        {row("Cafés", `${nb.cafe_500m ?? 0} within 500 m`, nb.cafe_m)}
        {row("Starbucks", nb.starbucks_name, nb.starbucks_m)}
        {row("Gym", nb.gym_name, nb.gym_m)}
        {row("Park", nb.park_name, nb.park_m)}
        {row("Pharmacy", "", nb.pharmacy_m)}
      </ul>
      <p className="text-sm text-muted-foreground">From OpenStreetMap. Walking times are estimates from distance.</p>
    </Section>
  );
}

export function Street({ nb }: { nb: Nearby | undefined }) {
  if (!nb?.street_feel) return null;
  const text = {
    busy: "On or right beside a main road (A-road or bigger): expect traffic noise and more people passing.",
    moderate: "Close to a secondary road: some traffic, usually calmer than a high street.",
    quiet: "Away from main roads: likely a quieter, residential street.",
  }[nb.street_feel];
  return (
    <Section title="Quiet or busy">
      <p>
        <span className="font-semibold">{nb.street_feel.charAt(0).toUpperCase() + nb.street_feel.slice(1)} street.</span> {text}
      </p>
      {nb.main_road_m !== undefined && (
        <p className="text-muted-foreground">Nearest main road: {metres(nb.main_road_m)} away.</p>
      )}
    </Section>
  );
}

export function Travel({ lat, lon, area }: { lat: number; lon: number; area: Area | undefined }) {
  const model = useModel();
  const places = model.data?.places ?? {};
  const [dest, setDest] = useState("");
  const custom = useMemo(() => (dest.trim() ? mapsDirections(lat, lon, `${dest.trim()}, London`) : null), [dest, lat, lon]);
  return (
    <Section title="Getting there">
      <ul className="space-y-3">
        {Object.entries(places).map(([key, p]) => {
          const mins = area?.[`transit_min_${key}`];
          const route = area?.[`transit_route_${key}`];
          const d = distanceM(lat, lon, p.lat, p.lon);
          return (
            <li key={key} className="border-b border-border pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <a className="text-sm underline" target="_blank" rel="noreferrer"
                  href={mapsDirections(lat, lon, `${p.lat},${p.lon}`)}>Directions</a>
              </div>
              <div className="text-sm text-muted-foreground">
                {typeof mins === "number" ? `${mins} min by public transport${route ? ` (${route})` : ""}` : "Public transport time unavailable"}
                {` · about ${walkMin(d)} min walk · ${cycleMin(d)} min by bike`}
              </div>
            </li>
          );
        })}
      </ul>
      <form className="flex gap-2 pt-1" onSubmit={(e: FormEvent) => { e.preventDefault(); if (custom) window.open(custom, "_blank"); }}>
        <label htmlFor="dest" className="sr-only">Directions to another place</label>
        <input id="dest" value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Directions to… e.g. your office"
          className="h-9 min-w-0 flex-1 rounded-sm border border-input bg-card px-2 text-sm" />
        <button type="submit" disabled={!custom} className="h-9 rounded-sm bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50">
          Open route
        </button>
      </form>
      <p className="text-sm text-muted-foreground">
        Public transport times are TfL journey-planner times from the middle of this neighbourhood, leaving 8:30 on a weekday. Walking and cycling times are estimated from distance.
      </p>
    </Section>
  );
}

/** A Street View photo of the street when an embed key is set; otherwise a link to open it. */
export function StreetPhoto({ lat, lon, label }: { lat: number; lon: number; label: string }) {
  const src = streetViewEmbed(lat, lon);
  if (!src)
    return (
      <a href={streetView(lat, lon)} target="_blank" rel="noreferrer"
        className="flex h-[200px] w-full items-center justify-center rounded-sm border border-dashed border-input bg-muted/50 px-4 text-center text-sm hover:bg-muted">
        See the street in Google Street View
      </a>
    );
  return (
    <iframe title={`Street View near ${label}`} src={src} loading="lazy" referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen className="h-[260px] w-full rounded-sm border border-border" />
  );
}

/** Links to current listings in the same postcode district, where agents and landlords can be contacted. */
export function OnTheMarket({ postcode, kind }: { postcode: string; kind?: "sale" | "rent" }) {
  const oc = postcode.trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  const kinds: ("sale" | "rent")[] = kind ? [kind] : ["rent", "sale"];
  return (
    <Section title={kind === "rent" ? "To rent near here now" : kind === "sale" ? "For sale near here now" : "On the market near here"}>
      {kinds.map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-2">
          <span className="w-24 text-sm text-muted-foreground">{k === "rent" ? "To rent" : "For sale"} in {oc}</span>
          {listingLinks(postcode, k).map((l) => (
            <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
              className="rounded-sm border border-input bg-card px-3 py-1.5 text-sm hover:bg-muted">{l.label}</a>
          ))}
        </div>
      ))}
      <p className="text-sm text-muted-foreground">
        Listings, photos and the agent&apos;s or landlord&apos;s contact details are on these sites. Paste any listing into{" "}
        <a href="/check" className="underline">Check a listing</a> to see whether its price is fair.
      </p>
    </Section>
  );
}
