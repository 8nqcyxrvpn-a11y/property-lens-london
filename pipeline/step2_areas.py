"""Step 2: neighbourhood data for each small area (LSOA) that has sales.

For each LSOA, at the average location of its postcodes:
  - street crime from police.uk over the latest 12 months, in a 500 m x 500 m square
  - the English Indices of Deprivation 2025 deciles (overall, crime, income, living environment)
  - public-transport travel time to each fixed place, from the TfL Journey Planner

Output: data/processed/areas.csv
"""

from __future__ import annotations

import datetime as dt
import io
import math
import sys
import time

import pandas as pd
import requests

from config import IMD_URL, PLACES, PROCESSED, USER_AGENT

SESSION = requests.Session()
SESSION.headers["User-Agent"] = USER_AGENT
HALF_SIDE_M = 250
PERSONAL_SAFETY = ["violent-crime", "robbery", "theft-from-the-person", "public-order",
                   "possession-of-weapons"]


def get_json(url: str, *, params=None, pause: float = 0.0, tries: int = 6):
    for attempt in range(tries):
        try:
            response = SESSION.get(url, params=params, timeout=60)
            if response.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            response.raise_for_status()
            time.sleep(pause)
            return response.json()
        except requests.RequestException as exc:
            print(f"retry {attempt + 1} {url}: {exc}", flush=True)
            time.sleep(3 * (attempt + 1))
    return None


def square(lat: float, lon: float) -> str:
    dlat = HALF_SIDE_M / 111_320
    dlon = HALF_SIDE_M / (111_320 * math.cos(math.radians(lat)))
    pts = [(lat - dlat, lon - dlon), (lat - dlat, lon + dlon), (lat + dlat, lon + dlon),
           (lat + dlat, lon - dlon)]
    return ":".join(f"{a:.6f},{b:.6f}" for a, b in pts)


def crime(areas: pd.DataFrame) -> pd.DataFrame:
    months = [d["date"] for d in get_json("https://data.police.uk/api/crimes-street-dates")][:12]
    print(f"Police data months: {months[-1]} to {months[0]}", flush=True)
    rows = []
    for n, area in enumerate(areas.itertuples(), start=1):
        counts: dict[str, int] = {}
        for month in months:
            data = get_json("https://data.police.uk/api/crimes-street/all-crime",
                            params={"poly": square(area.lat, area.lon), "date": month}, pause=0.08)
            for item in data or []:
                counts[item["category"]] = counts.get(item["category"], 0) + 1
        row = {"lsoa_code": area.lsoa_code, "crime_total": sum(counts.values()),
               "crime_personal_safety": sum(counts.get(c, 0) for c in PERSONAL_SAFETY)}
        for c in ("violent-crime", "robbery", "theft-from-the-person", "anti-social-behaviour",
                  "burglary", "drugs"):
            row[f"crime_{c.replace('-', '_')}"] = counts.get(c, 0)
        rows.append(row)
        if n % 25 == 0:
            print(f"crime: {n}/{len(areas)} areas", flush=True)
    out = pd.DataFrame(rows)
    out.attrs["months"] = f"{months[-1]} to {months[0]}"
    return out


def deprivation() -> pd.DataFrame:
    text = SESSION.get(IMD_URL, timeout=120).text
    imd = pd.read_csv(io.StringIO(text))
    cols = {c.lower(): c for c in imd.columns}

    def pick(*needles):
        for low, orig in cols.items():
            if all(n in low for n in needles):
                return orig
        raise KeyError(needles)

    out = pd.DataFrame({
        "lsoa_code": imd[pick("lsoa code")],
        "imd_decile": imd[pick("index of multiple deprivation", "decile")],
        "imd_income_decile": imd[pick("income decile")],
        "imd_crime_decile": imd[pick("crime decile")],
        "imd_living_env_decile": imd[pick("living environment decile")],
    })
    print(f"IMD rows: {len(out)}", flush=True)
    return out


def next_weekday_8am() -> str:
    day = dt.date.today() + dt.timedelta(days=1)
    while day.weekday() != 1:  # a Tuesday
        day += dt.timedelta(days=1)
    return day.strftime("%Y%m%d")


def travel(areas: pd.DataFrame) -> pd.DataFrame:
    date = next_weekday_8am()
    rows = []
    for n, area in enumerate(areas.itertuples(), start=1):
        row = {"lsoa_code": area.lsoa_code}
        for key, (_, plat, plon) in PLACES.items():
            data = get_json(
                f"https://api.tfl.gov.uk/Journey/JourneyResults/{area.lat:.5f},{area.lon:.5f}/to/{plat},{plon}",
                params={"date": date, "time": "0830", "timeIs": "Departing",
                        "mode": "tube,bus,dlr,overground,elizabeth-line,national-rail,walking"},
                pause=1.3)
            journeys = (data or {}).get("journeys") or []
            if journeys:
                best = min(journeys, key=lambda j: j.get("duration", 999))
                lines = []
                for leg in best.get("legs", []):
                    mode = (leg.get("mode") or {}).get("name", "")
                    if mode in ("walking", ""):
                        continue
                    names = [o.get("name") for o in leg.get("routeOptions", []) if o.get("name")]
                    label = names[0] if names else mode
                    if mode == "tube" and names:
                        label = f"{names[0]} line"
                    elif mode == "bus" and names:
                        label = f"bus {names[0]}"
                    lines.append(label)
                row[f"transit_min_{key}"] = best.get("duration")
                row[f"transit_route_{key}"] = " → ".join(dict.fromkeys(lines)) or "walk"
            else:
                row[f"transit_min_{key}"] = None
                row[f"transit_route_{key}"] = None
        rows.append(row)
        if n % 25 == 0:
            print(f"travel: {n}/{len(areas)} areas", flush=True)
    return pd.DataFrame(rows)


def main() -> int:
    pc = pd.read_csv(PROCESSED / "postcodes.csv").dropna(subset=["lat", "lon", "lsoa_code"])
    areas = (pc.groupby("lsoa_code")
             .agg(lat=("lat", "mean"), lon=("lon", "mean"), lsoa_name=("lsoa_name", "first"),
                  ward=("ward", "first"), borough=("borough", "first"), postcodes=("postcode", "count"))
             .reset_index())
    print(f"{len(areas)} areas", flush=True)
    imd = deprivation()
    crime_df = crime(areas)
    travel_df = travel(areas)
    out = areas.merge(imd, on="lsoa_code", how="left").merge(crime_df, on="lsoa_code", how="left") \
               .merge(travel_df, on="lsoa_code", how="left")
    out["crime_months"] = crime_df.attrs.get("months", "")
    print(f"IMD matched for {out['imd_decile'].notna().sum()} of {len(out)} areas", flush=True)
    out.to_csv(PROCESSED / "areas.csv", index=False)
    print(out.describe().T[["mean", "min", "max"]].to_string(), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
