import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const nav = [
  { to: "/", label: "Find a home" },
  { to: "/check", label: "Check a listing" },
  { to: "/method", label: "How it works" },
] as const;

export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight">
              Property Lens
            </span>
            <span className="text-sm text-muted-foreground">London</span>
          </Link>
          <nav aria-label="Main" className="flex gap-1 text-sm">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                activeOptions={{ exact: true }}
                className="rounded-sm px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                activeProps={{ className: "bg-muted font-medium !text-foreground" }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-border bg-card">
        <div className="mx-auto max-w-[1400px] px-4 py-5 text-xs leading-relaxed text-muted-foreground sm:px-6">
          Sale prices: HM Land Registry Price Paid Data. Crime: police.uk. Deprivation: English Indices of
          Deprivation 2025. Places and roads: © OpenStreetMap contributors. Travel times: TfL. Contains public
          sector information licensed under the Open Government Licence v3.0. Estimates are a guide, not a
          valuation. A portfolio project by Razan Hijazi.
        </div>
      </footer>
    </div>
  );
}
