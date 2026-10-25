import { money, pct, VERDICT, type Verdict } from "../lib/data";

/**
 * The fair range as a band, with the actual (or asking) price marked against it.
 * The scale runs from 40% below to 40% above the fair value; prices beyond that sit at the edge.
 */
export function ValueBar({ price, fair, band, verdict, priceLabel = "Sold for" }: {
  price: number;
  fair: number;
  band: number;
  verdict: Verdict;
  priceLabel?: string;
}) {
  const span = 0.4;
  const pos = (x: number) => Math.min(100, Math.max(0, ((x / fair - 1 + span) / (2 * span)) * 100));
  const diff = price / fair - 1;
  const v = VERDICT[verdict];
  return (
    <figure className="w-full">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div>
          <div className="text-sm text-muted-foreground">{priceLabel}</div>
          <div className="num font-[family-name:var(--font-display)] text-3xl font-semibold">{money(price)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-muted-foreground">Fair value estimate</div>
          <div className="num font-[family-name:var(--font-display)] text-3xl font-semibold text-muted-foreground">
            {money(fair)}
          </div>
        </div>
      </div>
      <div className="relative mt-4 h-10" aria-hidden="true">
        <div className="absolute inset-x-0 top-4 h-2 rounded-full bg-muted" />
        <div
          className="absolute top-3 h-4 rounded-sm"
          style={{
            left: `${pos(fair * (1 - band))}%`,
            width: `${pos(fair * (1 + band)) - pos(fair * (1 - band))}%`,
            background: "color-mix(in oklch, var(--fair) 25%, transparent)",
            border: "1px solid var(--fair)",
          }}
        />
        <div className="absolute top-2 h-6 w-px bg-[var(--fair)]" style={{ left: `${pos(fair)}%` }} />
        <div
          className="absolute top-0 h-10 w-1.5 -translate-x-1/2 rounded-full"
          style={{ left: `${pos(price)}%`, background: v.tone }}
        />
      </div>
      <figcaption className="mt-1 flex justify-between text-xs text-muted-foreground">
        <span>40% below</span>
        <span>Fair range ±{Math.round(band * 100)}%</span>
        <span>40% above</span>
      </figcaption>
      <p className="mt-3 text-base">
        <span className="font-semibold" style={{ color: v.tone }}>
          {v.label}
        </span>
        <span className="text-muted-foreground">
          {" "}
          — {Math.abs(diff) < 0.005 ? "right at" : `${pct(diff)} ${diff > 0 ? "above" : "below"}`} the estimate.
        </span>
      </p>
    </figure>
  );
}
