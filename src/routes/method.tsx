import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useModel, type Metrics } from "../lib/data";

export const Route = createFileRoute("/method")({
  head: () => ({
    meta: [
      { title: "How it works — Property Lens London" },
      { name: "description", content: "Where the data comes from, how fair value is estimated, and how accurate it is on sales it never saw." },
    ],
  }),
  component: Method,
});

const p = (x: number) => `${Math.round(x * 100)}%`;

function Method() {
  const model = useModel();
  const m = model.data;
  return (
    <div className="mx-auto max-w-[860px] px-4 py-8 sm:px-6">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold sm:text-4xl">How it works</h1>
      <p className="mt-3 text-lg text-muted-foreground">
        Property Lens estimates what a home should sell for from what similar homes nearby actually sold for, then
        tests that estimate on sales it has never seen.
      </p>

      {m && (
        <section className="mt-10">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">How accurate is it?</h2>
          <p className="mt-2">
            The model learned from sales before {new Date(m.test_from).toLocaleDateString("en-GB", { month: "long", year: "numeric" })} and
            then estimated the {m.test.model.n.toLocaleString("en-GB")} sales that came after. A simple rule of
            thumb, the median price of the same type of home in the same neighbourhood, is the yardstick it has to beat.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-foreground">
                  <th className="py-2 pr-4 font-medium">Method</th>
                  <th className="py-2 pr-4 font-medium">Typical error</th>
                  <th className="py-2 pr-4 font-medium">Within 10%</th>
                  <th className="py-2 font-medium">Within 20%</th>
                </tr>
              </thead>
              <tbody>
                <Row name="Property Lens model" m={m.test.model} strong />
                <Row name="Neighbourhood median (yardstick)" m={m.test.baseline} />
                {Object.entries(m.test.by_type).map(([type, mm]) => (
                  <Row key={type} name={`Model, ${type.toLowerCase()}s only`} m={mm} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Typical error is the median gap between the estimate and the real price. A home is called above or below
            fair value only when its price is further from the estimate than that typical error (±{p(m.fair_band)}), so
            the label means something rather than reflecting ordinary noise.
          </p>
        </section>
      )}

      <Block title="Where the data comes from">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b>Sale prices:</b> HM Land Registry Price Paid Data, every standard residential sale in Islington and
            Hammersmith &amp; Fulham{m ? ` from ${m.first_sale.slice(0, 4)} to ${new Date(m.last_sale).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}` : ""}.
            Repossessions and portfolio transfers are left out.
          </li>
          <li><b>Locations:</b> postcode centres from postcodes.io (Office for National Statistics data).</li>
          <li>
            <b>Safety:</b> street-level crimes from police.uk over the latest 12 months{m?.crime_months ? ` (${m.crime_months})` : ""},
            counted in a 500 m square around each neighbourhood. Locations are deliberately blurred by the police to
            protect privacy, so read it as an area picture, not a street-by-street one.
          </li>
          <li><b>Deprivation:</b> the English Indices of Deprivation 2025, by neighbourhood (LSOA).</li>
          <li><b>Nearby places and main roads:</b> OpenStreetMap.</li>
          <li><b>Travel times:</b> the TfL Journey Planner, leaving at 8:30 on a weekday.</li>
        </ul>
      </Block>

      <Block title="How fair value is estimated">
        <p>
          The model is a regularised regression on the log of the sale price. It weighs the type of home and
          tenure, whether it is new, when it sold (to follow the market), the borough, the neighbourhood, how far
          it is from a station and whether it is on a main road{m?.epc ? ", plus floor area, rooms and energy rating" : ""}.
          Neighbourhoods with few sales are pulled towards the borough average, so one odd sale can&apos;t swing them.
        </p>
        <p>
          Because every part of an estimate comes from one of these factors, each home can show what moved its
          price, for example &quot;Neighbourhood +18%&quot; or &quot;On a busy main road −5%&quot;. Each home is
          valued by a version of the model that did not see its own sale.
        </p>
      </Block>

      <Block title="What it can't tell you">
        <ul className="list-disc space-y-2 pl-5">
          <li>The inside of a home: condition, renovation, views, outdoor space or lease length.</li>
          {!m?.epc && <li>Floor area, which matters a lot; it will be added from Energy Performance Certificates.</li>}
          <li>Live listings: listing sites don&apos;t share their data, so use &quot;Check a listing&quot; for a home you found.</li>
          <li>Rent: there is no public record of what each home rents for.</li>
        </ul>
      </Block>
    </div>
  );
}

function Row({ name, m, strong }: { name: string; m: Metrics; strong?: boolean }) {
  return (
    <tr className="border-b border-border">
      <td className={`py-2 pr-4 ${strong ? "font-semibold" : ""}`}>{name}</td>
      <td className="num py-2 pr-4">±{p(m.median_abs_error)}</td>
      <td className="num py-2 pr-4">{p(m.within_10pct)}</td>
      <td className="num py-2">{p(m.within_20pct)}</td>
    </tr>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 leading-relaxed">{children}</div>
    </section>
  );
}
