import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { LeafletMap, type MapPoint } from "../components/LeafletMap";
import {
  BOROUGH_NAME,
  distanceM,
  findPlace,
  monthYear,
  pct,
  safetyWords,
  SHORTCUTS,
  shortMoney,
  TYPE_NAME,
  useAreas,
  useHomes,
  useModel,
  useNearby,
  VERDICT,
  walkMin,
  metres,
  type Geo,
  type Home,
  type Verdict,
} from "../lib/data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Find a home — Property Lens London" },
      {
        name: "description",
        content:
          "Search every home sold in Islington and Hammersmith & Fulham by place, price and size, with fair-value verdicts, street safety and what's nearby.",
      },
    ],
  }),
  component: FindAHome,
});

type Sort = "near" | "newest" | "below" | "price";
interface Filters {
  type: "any" | "flat" | "house";
  maxPrice: number | null;
  minArea: number | null;
  verdict: "any" | Verdict;
  quietOnly: boolean;
  saferOnly: boolean;
  since: string;
  radiusKm: number;
}

const PAGE = 30;

function FindAHome() {
  const homes = useHomes();
  const nearby = useNearby();
  const areas = useAreas();
  const model = useModel();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [place, setPlace] = useState<Geo | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({
    type: "any",
    maxPrice: null,
    minArea: null,
    verdict: "any",
    quietOnly: false,
    saferOnly: false,
    since: "2024-01-01",
    radiusKm: 1.5,
  });
  const [sort, setSort] = useState<Sort>("newest");
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setShown(PAGE);
  };

  async function search(e?: FormEvent, preset?: Geo) {
    e?.preventDefault();
    setSearchError(null);
    if (preset) {
      setPlace(preset);
      setQuery(preset.label);
      setSort("near");
      setShown(PAGE);
      return;
    }
    if (!query.trim()) {
      setPlace(null);
      return;
    }
    setSearching(true);
    try {
      const hit = await findPlace(query);
      if (!hit) setSearchError(`No London place matched "${query}". Try a street, station or postcode.`);
      else {
        setPlace(hit);
        setSort("near");
        setShown(PAGE);
      }
    } catch {
      setSearchError("The place search didn't respond. Try again, or use one of the shortcuts.");
    } finally {
      setSearching(false);
    }
  }

  const results = useMemo(() => {
    if (!homes.data) return [];
    const nb = nearby.data ?? {};
    const ar = areas.data ?? {};
    const out: (Home & { dist?: number })[] = [];
    for (const h of homes.data) {
      if (h.d < filters.since) continue;
      if (filters.type === "flat" && h.t !== "F") continue;
      if (filters.type === "house" && h.t === "F") continue;
      if (filters.maxPrice && h.p > filters.maxPrice) continue;
      if (filters.minArea && (h.m2 ?? 0) < filters.minArea) continue;
      if (filters.verdict !== "any" && h.v !== filters.verdict) continue;
      if (filters.quietOnly && nb[h.pc]?.street_feel !== "quiet") continue;
      if (filters.saferOnly && !((ar[h.l]?.safety_pct ?? 1) <= 0.33)) continue;
      if (place) {
        const dist = distanceM(place.lat, place.lon, h.la, h.lo);
        if (dist > filters.radiusKm * 1000) continue;
        out.push({ ...h, dist });
      } else out.push(h);
    }
    const sorters: Record<Sort, (a: Home & { dist?: number }, b: Home & { dist?: number }) => number> = {
      near: (a, b) => (a.dist ?? 0) - (b.dist ?? 0),
      newest: (a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0),
      below: (a, b) => a.p / a.f - b.p / b.f,
      price: (a, b) => a.p - b.p,
    };
    return out.sort(sorters[sort === "near" && !place ? "newest" : sort]);
  }, [homes.data, nearby.data, areas.data, filters, place, sort]);

  const points: MapPoint[] = useMemo(
    () =>
      results.slice(0, 1500).map((h) => ({
        id: h.id,
        lat: h.la,
        lon: h.lo,
        color: VERDICT[h.v].tone,
        label: `${h.a} · ${shortMoney(h.p)}`,
      })),
    [results],
  );

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { below: 0, fair: 0, above: 0 };
    for (const h of results) c[h.v] += 1;
    return c;
  }, [results]);

  const loading = homes.isPending;
  const failed = homes.isError;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <section className="max-w-3xl">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight sm:text-4xl">
          Was it a fair price, and is it a good place to live?
        </h1>
        <p className="mt-2 text-muted-foreground">
          Every home sold in Islington and Hammersmith &amp; Fulham since 2022
          {model.data ? ` (${model.data.sales.toLocaleString("en-GB")} sales)` : ""}, each with a tested fair-value
          estimate, the reasons behind it, street safety, what&apos;s nearby and how long it takes to get to LSE, UCL
          and King&apos;s.
        </p>
      </section>

      <form onSubmit={(e) => void search(e)} className="mt-6 flex flex-wrap gap-2" role="search">
        <label htmlFor="near" className="sr-only">
          Search near a place
        </label>
        <input
          id="near"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Near a place, street or postcode — e.g. Holloway Road, N7 8DB"
          className="h-11 min-w-0 flex-1 rounded-sm border border-input bg-card px-3 text-base"
        />
        <button
          type="submit"
          className="h-11 rounded-sm bg-primary px-5 font-medium text-primary-foreground disabled:opacity-60"
          disabled={searching}
        >
          {searching ? "Searching…" : "Search"}
        </button>
        {place && (
          <button
            type="button"
            className="h-11 rounded-sm border border-input px-4 text-sm"
            onClick={() => {
              setPlace(null);
              setQuery("");
              setSort("newest");
            }}
          >
            Clear place
          </button>
        )}
      </form>
      <div className="mt-2 flex flex-wrap gap-2 text-sm">
        {SHORTCUTS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => void search(undefined, s)}
            className={`rounded-full border px-3 py-1 ${place?.label === s.label ? "border-foreground bg-foreground text-background" : "border-input bg-card hover:bg-muted"}`}
          >
            Near {s.label}
          </button>
        ))}
      </div>
      {searchError && <p className="mt-2 text-sm text-[var(--above)]">{searchError}</p>}

      <fieldset className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-y border-border py-4 text-sm sm:grid-cols-4 lg:grid-cols-8">
        <legend className="sr-only">Filters</legend>
        <Select label="Type" value={filters.type} onChange={(v) => set("type", v as Filters["type"])}
          options={[["any", "Any"], ["flat", "Flats"], ["house", "Houses"]]} />
        <Select label="Max price" value={String(filters.maxPrice ?? "")}
          onChange={(v) => set("maxPrice", v ? Number(v) : null)}
          options={[["", "Any"], ["500000", "£500k"], ["750000", "£750k"], ["1000000", "£1m"], ["1500000", "£1.5m"], ["2500000", "£2.5m"]]} />
        {model.data?.epc && (
          <Select label="Min size" value={String(filters.minArea ?? "")}
            onChange={(v) => set("minArea", v ? Number(v) : null)}
            options={[["", "Any"], ["50", "50 m²"], ["75", "75 m²"], ["100", "100 m²"], ["150", "150 m²"]]} />
        )}
        <Select label="Value" value={filters.verdict} onChange={(v) => set("verdict", v as Filters["verdict"])}
          options={[["any", "Any"], ["below", "Below fair value"], ["fair", "Fair value"], ["above", "Above fair value"]]} />
        <Select label="Sold since" value={filters.since} onChange={(v) => set("since", v)}
          options={[["2022-01-01", "2022"], ["2024-01-01", "2024"], ["2025-01-01", "2025"], ["2026-01-01", "2026"]]} />
        {place && (
          <Select label="Within" value={String(filters.radiusKm)} onChange={(v) => set("radiusKm", Number(v))}
            options={[["0.5", "500 m"], ["1", "1 km"], ["1.5", "1.5 km"], ["2.5", "2.5 km"], ["4", "4 km"]]} />
        )}
        <Toggle label="Quiet streets only" checked={filters.quietOnly} onChange={(v) => set("quietOnly", v)} />
        <Toggle label="Safer areas only" checked={filters.saferOnly} onChange={(v) => set("saferOnly", v)} />
      </fieldset>

      {loading && <p className="py-16 text-center text-muted-foreground">Loading every sale…</p>}
      {failed && (
        <p className="py-16 text-center">
          The sales data didn&apos;t load. Refresh the page; if it keeps happening, the data is being rebuilt.
        </p>
      )}

      {homes.data && (
        <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <section aria-label="Results">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm">
                <span className="num font-semibold">{results.length.toLocaleString("en-GB")}</span> homes
                {place ? ` within ${metres(filters.radiusKm * 1000)} of ${place.label}` : ""}
                <span className="text-muted-foreground">
                  {" "}
                  · {counts.below} below, {counts.fair} fair, {counts.above} above value
                </span>
              </p>
              <label className="flex items-center gap-2 text-sm">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
                  className="h-8 rounded-sm border border-input bg-card px-2">
                  {place && <option value="near">Nearest</option>}
                  <option value="newest">Most recent</option>
                  <option value="below">Furthest below value</option>
                  <option value="price">Price, low to high</option>
                </select>
              </label>
            </div>
            {results.length === 0 ? (
              <p className="mt-10 text-muted-foreground">
                No homes match. Widen the distance, raise the price limit or switch off a filter.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {results.slice(0, shown).map((h) => (
                  <ResultRow key={h.id} home={h} selected={selected === h.id} onHover={setSelected}
                    safety={areas.data?.[h.l]?.safety_pct ?? null}
                    station={nearby.data?.[h.pc]} placeLabel={place?.label} />
                ))}
              </ul>
            )}
            {shown < results.length && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)}
                className="mt-4 w-full rounded-sm border border-input bg-card py-2.5 text-sm hover:bg-muted">
                Show {Math.min(PAGE, results.length - shown)} more
              </button>
            )}
          </section>
          <section aria-label="Map" className="lg:sticky lg:top-4 lg:self-start">
            <LeafletMap
              className="h-[420px] w-full rounded-sm border border-border lg:h-[calc(100vh-2rem)]"
              points={points}
              center={place ? [place.lat, place.lon] : [51.535, -0.16]}
              zoom={place ? 15 : 12}
              radiusM={place ? filters.radiusKm * 1000 : undefined}
              pins={place ? [{ lat: place.lat, lon: place.lon, label: place.label }] : []}
              selected={selected}
              onSelect={(id) => void navigate({ to: "/home/$id", params: { id } })}
            />
            <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
              {(["below", "fair", "above"] as Verdict[]).map((v) => (
                <span key={v} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VERDICT[v].tone }} />
                  {VERDICT[v].label}
                </span>
              ))}
              {results.length > 1500 && <span>Map shows the first 1,500; narrow the search to see all.</span>}
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

function ResultRow({ home: h, selected, onHover, safety, station, placeLabel }: {
  home: Home & { dist?: number };
  selected: boolean;
  onHover: (id: string | null) => void;
  safety: number | null;
  station: { station_name?: string; station_m?: number; street_feel?: string } | undefined;
  placeLabel: string | undefined;
}) {
  const v = VERDICT[h.v];
  const diff = h.p / h.f - 1;
  const s = safetyWords(safety);
  return (
    <li onMouseEnter={() => onHover(h.id)} onMouseLeave={() => onHover(null)}
      className={selected ? "bg-muted" : undefined}>
      <Link to="/home/$id" params={{ id: h.id }} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 px-2 py-3 hover:bg-muted">
        <div className="min-w-0">
          <div className="truncate font-[family-name:var(--font-display)] text-lg font-semibold">{h.a}</div>
          <div className="text-sm text-muted-foreground">
            {h.pc} · {BOROUGH_NAME[h.b]} · {TYPE_NAME[h.t]}
            {h.m2 ? `, ${h.m2} m²` : ""} · {h.te === "L" ? "leasehold" : "freehold"}
            {h.n ? ", new build" : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="num font-[family-name:var(--font-display)] text-lg font-semibold">{shortMoney(h.p)}</div>
          <div className="text-xs text-muted-foreground">{monthYear(h.d)}</div>
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-medium" style={{ color: v.tone }}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: v.tone }} />
            {v.label} ({pct(diff)})
          </span>
          {station?.station_name && station.station_m !== undefined && (
            <span className="text-muted-foreground">
              {station.station_name}, {walkMin(station.station_m)} min walk
            </span>
          )}
          <span style={{ color: s.tone }}>{s.label}</span>
          {station?.street_feel && <span className="text-muted-foreground">{station.street_feel} street</span>}
          {h.dist !== undefined && placeLabel && (
            <span className="text-muted-foreground">{metres(h.dist)} from {placeLabel}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Select({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-sm border border-input bg-card px-2">
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-end gap-2 pb-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      <span>{label}</span>
    </label>
  );
}
