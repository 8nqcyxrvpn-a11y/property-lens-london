import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { LeafletMap } from "../components/LeafletMap";
import { Nameplate } from "../components/Nameplate";
import { ValueBar } from "../components/ValueBar";
import {
  BOROUGH_NAME,
  cycleMin,
  decileWords,
  distanceM,
  mapsDirections,
  mapsPlace,
  metres,
  money,
  monthYear,
  pct,
  safetyWords,
  streetView,
  TYPE_NAME,
  useAreas,
  useHomes,
  useModel,
  useNearby,
  VERDICT,
  walkMin,
  type Area,
  type Home,
  type Nearby,
} from "../lib/data";

export const Route = createFileRoute("/home/$id")({
  head: () => ({ meta: [{ title: "Home — Property Lens London" }] }),
  component: HomePage,
});

function HomePage() {
  const { id } = Route.useParams();
  const homes = useHomes();
  const nearby = useNearby();
  const areas = useAreas();
  const model = useModel();
  const home = homes.data?.find((h) => h.id === id);

  if (homes.isPending) return <p className="py-24 text-center text-muted-foreground">Loading this home…</p>;
  if (!home)
    return (
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <p className="text-lg">This home isn&apos;t in the data any more. Sales are refreshed monthly.</p>
        <Link to="/" className="mt-4 inline-block underline">Back to the search</Link>
      </div>
    );

  const nb = nearby.data?.[home.pc];
  const area = areas.data?.[home.l];
  const band = model.data?.fair_band ?? 0.15;
  const others = (homes.data ?? []).filter((h) => h.id !== home.id && h.pc === home.pc).slice(0, 6);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <Link to="/" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to the search
      </Link>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-6">
        <Nameplate street={home.a} district={`${home.pc} · ${BOROUGH_NAME[home.b]}`} size="lg" />
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="rounded-sm border border-input bg-card px-3 py-2 hover:bg-muted" href={streetView(home.la, home.lo)}
            target="_blank" rel="noreferrer">Street View</a>
          <a className="rounded-sm border border-input bg-card px-3 py-2 hover:bg-muted" href={mapsPlace(home.la, home.lo)}
            target="_blank" rel="noreferrer">Open in Google Maps</a>
        </div>
      </div>
      <p className="mt-3 text-muted-foreground">
        {TYPE_NAME[home.t]}
        {home.m2 ? `, ${home.m2} m²` : ""}
        {home.r ? `, ${home.r} rooms` : ""} · {home.te === "L" ? "Leasehold" : "Freehold"}
        {home.n ? " · New build" : ""}
        {home.e ? ` · Energy rating ${home.e}` : ""} · Sold {monthYear(home.d)}
      </p>

      <section className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <ValueBar price={home.p} fair={home.f} band={band} verdict={home.v} />
          <Why home={home} />
        </div>
        <LeafletMap className="h-[320px] w-full rounded-sm border border-border" points={[
          { id: home.id, lat: home.la, lon: home.lo, color: VERDICT[home.v].tone, label: home.a },
          ...others.map((o) => ({ id: o.id, lat: o.la, lon: o.lo, color: VERDICT[o.v].tone, label: o.a })),
        ]} center={[home.la, home.lo]} zoom={16} selected={home.id} />
      </section>

      <div className="mt-12 grid gap-10 md:grid-cols-2">
        <Safety area={area} />
        <NearbyList nb={nb} />
        <Street nb={nb} />
        <Travel home={home} area={area} />
      </div>

      {others.length > 0 && (
        <section className="mt-12">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">Other sales at this postcode</h2>
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {others.map((o) => (
              <li key={o.id}>
                <Link to="/home/$id" params={{ id: o.id }} className="flex justify-between gap-4 px-2 py-2.5 hover:bg-muted">
                  <span>{o.a}</span>
                  <span className="num text-right">
                    {money(o.p)} <span className="text-muted-foreground">({monthYear(o.d)})</span>{" "}
                    <span style={{ color: VERDICT[o.v].tone }}>{VERDICT[o.v].label.toLowerCase()}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12 max-w-3xl text-sm text-muted-foreground">
        The estimate is what a model trained on other sales would expect for a {TYPE_NAME[home.t].toLowerCase()} like this,
        in this neighbourhood, at that time; it never saw this sale. It can&apos;t see the inside of the home, so a
        price outside the fair range can reflect condition, a view or a renovation rather than a good or bad deal.{" "}
        <Link to="/method" className="underline">How it works</Link>
      </p>
    </div>
  );
}

function Why({ home }: { home: Home }) {
  if (!home.w.length) return null;
  return (
    <div className="mt-8">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">What moves its estimate</h2>
      <p className="mt-1 text-sm text-muted-foreground">Compared with the average home sold in these two boroughs.</p>
      <ul className="mt-3 space-y-2">
        {home.w.map(([label, effect]) => (
          <li key={label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <span>{label}</span>
            <span className="num font-semibold" style={{ color: effect >= 0 ? "var(--below)" : "var(--above)" }}>
              {pct(effect)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-2 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Safety({ area }: { area: Area | undefined }) {
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
      <p>Crime, compared with all of England: {decileWords(area.imd_crime_decile)}.</p>
      <p>Overall deprivation: {decileWords(area.imd_decile)}.</p>
      <p className="text-sm text-muted-foreground">{area.lsoa_name}, {area.ward} ward. Deprivation from the English Indices of Deprivation 2025.</p>
    </Section>
  );
}

function NearbyList({ nb }: { nb: Nearby | undefined }) {
  if (!nb) return <Section title="Nearby"><p className="text-muted-foreground">No nearby data for this postcode.</p></Section>;
  const row = (label: string, name: string | undefined, m: number | undefined, extra?: string) =>
    m === undefined ? null : (
      <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <span>
          <span className="text-muted-foreground">{label}:</span> {name}
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
        {row("Pharmacy", "nearest", nb.pharmacy_m)}
      </ul>
      <p className="text-sm text-muted-foreground">From OpenStreetMap. Walking times are estimates from distance.</p>
    </Section>
  );
}

function Street({ nb }: { nb: Nearby | undefined }) {
  if (!nb?.street_feel) return null;
  const text = {
    busy: "On or right beside a main road (A-road or bigger): expect traffic noise and more people passing.",
    moderate: "Close to a secondary road: some traffic, usually calmer than a high street.",
    quiet: "Away from main roads: likely a quieter, residential street.",
  }[nb.street_feel];
  return (
    <Section title="Quiet or busy">
      <p>
        <span className="font-semibold capitalize">{nb.street_feel} street.</span> {text}
      </p>
      {nb.main_road_m !== undefined && (
        <p className="text-muted-foreground">Nearest main road: {metres(nb.main_road_m)} away.</p>
      )}
    </Section>
  );
}

function Travel({ home, area }: { home: Home; area: Area | undefined }) {
  const model = useModel();
  const places = model.data?.places ?? {};
  const [dest, setDest] = useState("");
  const custom = useMemo(() => (dest.trim() ? mapsDirections(home.la, home.lo, `${dest.trim()}, London`) : null), [dest, home]);
  return (
    <Section title="Getting there">
      <ul className="space-y-3">
        {Object.entries(places).map(([key, p]) => {
          const mins = area?.[`transit_min_${key}`];
          const route = area?.[`transit_route_${key}`];
          const d = distanceM(home.la, home.lo, p.lat, p.lon);
          return (
            <li key={key} className="border-b border-border pb-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{p.name}</span>
                <a className="text-sm underline" target="_blank" rel="noreferrer"
                  href={mapsDirections(home.la, home.lo, `${p.lat},${p.lon}`)}>Directions</a>
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
        Public transport times are TfL journey-planner times from the middle of this neighbourhood, leaving 8:30 on a weekday.
      </p>
    </Section>
  );
}
