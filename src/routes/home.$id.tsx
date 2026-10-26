import { createFileRoute, Link } from "@tanstack/react-router";
import { LeafletMap } from "../components/LeafletMap";
import { Nameplate } from "../components/Nameplate";
import { ValueBar } from "../components/ValueBar";
import { NearbyList, OnTheMarket, Safety, Street, StreetPhoto, Travel } from "../components/AreaReport";
import {
  BOROUGH_NAME,
  mapsPlace,
  money,
  monthYear,
  pct,
  streetView,
  TYPE_NAME,
  useAreas,
  useHomes,
  useModel,
  useNearby,
  VERDICT,
  type Home,
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
      <p className="mt-3 inline-block rounded-sm bg-muted px-2 py-1 text-sm">
        A past sale, recorded by the Land Registry: sold in {monthYear(home.d)}. It isn&apos;t on the market now; see
        what&apos;s for rent or sale on this street below.
      </p>
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
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">The street</h2>
          <div className="mt-3"><StreetPhoto lat={home.la} lon={home.lo} label={home.a} /></div>
        </section>
        <OnTheMarket postcode={home.pc} />
        <Safety area={area} />
        <NearbyList nb={nb} />
        <Street nb={nb} />
        <Travel lat={home.la} lon={home.lo} area={area} />
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

