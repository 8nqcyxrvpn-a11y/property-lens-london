"""Step 1: download Land Registry Price Paid data, keep the chosen boroughs, and geocode postcodes.

Outputs
  data/processed/sales.csv      one row per standard residential sale
  data/processed/postcodes.csv  one row per postcode: lat, lon, LSOA code
"""

from __future__ import annotations

import csv
import io
import sys
import time

import pandas as pd
import requests

from config import (BOROUGHS, PRICE_PAID_COLUMNS, PRICE_PAID_URL, PROCESSED, RAW, USER_AGENT,
                    YEARS)

SESSION = requests.Session()
SESSION.headers["User-Agent"] = USER_AGENT


def download_year(year: int) -> pd.DataFrame:
    path = RAW / f"pp-{year}.csv"
    if not path.exists():
        url = PRICE_PAID_URL.format(year=year)
        print(f"Downloading {url}", flush=True)
        with SESSION.get(url, stream=True, timeout=600) as response:
            response.raise_for_status()
            with open(path, "wb") as fh:
                for chunk in response.iter_content(1 << 20):
                    fh.write(chunk)
    keep = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.reader(fh):
            if len(row) >= 15 and row[12] in BOROUGHS:
                keep.append(row[:16])
    frame = pd.DataFrame(keep, columns=PRICE_PAID_COLUMNS[: len(keep[0])] if keep else PRICE_PAID_COLUMNS)
    print(f"{year}: {len(frame)} rows in the chosen boroughs", flush=True)
    return frame


def geocode(postcodes: list[str]) -> pd.DataFrame:
    rows = []
    for i in range(0, len(postcodes), 100):
        batch = postcodes[i:i + 100]
        for attempt in range(5):
            try:
                response = SESSION.post("https://api.postcodes.io/postcodes",
                                        json={"postcodes": batch}, timeout=60)
                response.raise_for_status()
                break
            except requests.RequestException as exc:
                print(f"postcodes.io retry {attempt + 1}: {exc}", flush=True)
                time.sleep(3 * (attempt + 1))
        else:
            raise RuntimeError("postcodes.io failed repeatedly")
        for item in response.json()["result"]:
            res = item.get("result")
            if not res:
                rows.append({"postcode": item["query"], "lat": None, "lon": None})
                continue
            codes = res.get("codes") or {}
            rows.append({
                "postcode": item["query"],
                "lat": res.get("latitude"),
                "lon": res.get("longitude"),
                "lsoa_code": codes.get("lsoa21") or codes.get("lsoa"),
                "lsoa_name": res.get("lsoa21") or res.get("lsoa"),
                "ward": res.get("admin_ward"),
                "borough": res.get("admin_district"),
            })
        time.sleep(0.2)
    return pd.DataFrame(rows)


def main() -> int:
    RAW.mkdir(parents=True, exist_ok=True)
    PROCESSED.mkdir(parents=True, exist_ok=True)
    sales = pd.concat([download_year(y) for y in YEARS], ignore_index=True)
    sales["price"] = sales["price"].astype(int)
    sales["date"] = pd.to_datetime(sales["date"]).dt.strftime("%Y-%m-%d")
    before = len(sales)
    # Standard sales of residential homes only: category A excludes repossessions,
    # buy-to-let portfolio and other non-market transfers; type O is "other".
    sales = sales[(sales["ppd_category"] == "A") & (sales["property_type"] != "O")
                  & (sales["postcode"].str.len() > 0)]
    sales = sales[(sales["price"] >= 100_000) & (sales["price"] <= 20_000_000)]
    sales = sales.drop_duplicates("transaction_id")
    print(f"Kept {len(sales)} of {before} rows (standard residential sales, £100k–£20m)", flush=True)
    sales["borough_name"] = sales["district"].map(BOROUGHS)
    for col in ("paon", "saon", "street", "locality"):
        sales[col] = sales[col].fillna("").str.strip()
    sales = sales.sort_values("date")
    sales.to_csv(PROCESSED / "sales.csv", index=False)

    postcodes = sorted(sales["postcode"].unique())
    print(f"Geocoding {len(postcodes)} postcodes", flush=True)
    pc = geocode(postcodes)
    missing = pc["lat"].isna().sum()
    print(f"Geocoded: {len(pc) - missing}, not found (often retired postcodes): {missing}", flush=True)
    pc.to_csv(PROCESSED / "postcodes.csv", index=False)
    print("Sample LSOA fields:", pc.dropna().head(2).to_dict("records"), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
