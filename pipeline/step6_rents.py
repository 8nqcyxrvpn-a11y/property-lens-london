"""Step 6: official average private rents by borough and number of bedrooms.

Source: ONS Price Index of Private Rents (PIPR), monthly, local authority level.
Output: public/data/rents.json with the latest month for every London borough.
"""

from __future__ import annotations

import io
import json
import re
import sys

import pandas as pd
import requests

from config import PUBLIC, RENTS_FALLBACK_URL, RENTS_PAGE, USER_AGENT

HEADERS = {"User-Agent": USER_AGENT}
CATEGORIES = {  # output key -> words that identify the column header
    "all": ["all categor", "all propert", "all dwelling"],
    "studio": ["studio"],
    "1": ["one bed", "1 bed"],
    "2": ["two bed", "2 bed"],
    "3": ["three bed", "3 bed"],
    "4": ["four or more bed", "four bed", "4 or more bed", "4+ bed", "4 bed"],
}
POSITIONAL = {"all": 7, "1": 11, "2": 15, "3": 19, "4": 23}  # 0-based columns in Table 1 (2026 layout)


def latest_url() -> str:
    try:
        page = requests.get(RENTS_PAGE, headers=HEADERS, timeout=60)
        page.raise_for_status()
        links = re.findall(r'href="(/file\?uri=[^"]+?\.xlsx)"', page.text)
        if links:
            print(f"found {len(links)} xlsx links; using the first: {links[0]}", flush=True)
            return "https://www.ons.gov.uk" + links[0]
    except requests.RequestException as e:
        print(f"dataset page failed ({e}); using the fallback edition", flush=True)
    return RENTS_FALLBACK_URL


def find_table(book: dict[str, pd.DataFrame]) -> tuple[str, pd.DataFrame, int]:
    names = sorted(book, key=lambda n: (n.strip().lower() != "table 1", n))
    for name in names:
        df = book[name]
        for i in range(min(40, len(df))):
            cells = [str(c).strip().lower() for c in df.iloc[i].tolist()]
            if any(c.startswith("area code") for c in cells):
                return name, df, i
    raise SystemExit("No sheet with an 'Area code' header row was found")


def pick_columns(header: list[str]) -> dict[str, int]:
    low = [h.lower() for h in header]
    out: dict[str, int] = {}
    for key, words in CATEGORIES.items():
        for j, h in enumerate(low):
            if any(w in h for w in words) and ("price" in h or "rent" in h) \
                    and not any(x in h for x in ("change", "index", "%")):
                out[key] = j
                break
    if len(out) < 4:  # headers didn't name the categories clearly; fall back to the known layout
        print("headers not recognised; using positional columns", flush=True)
        out = dict(POSITIONAL)
    return out


def main() -> int:
    url = latest_url()
    res = requests.get(url, headers=HEADERS, timeout=180)
    res.raise_for_status()
    book = pd.read_excel(io.BytesIO(res.content), sheet_name=None, header=None)
    print(f"sheets: {list(book)}", flush=True)
    sheet, raw, h = find_table(book)
    header = [str(c).replace("\n", " ").strip() for c in raw.iloc[h].tolist()]
    print(f"sheet {sheet!r}, header row {h}:", flush=True)
    for j, name in enumerate(header):
        print(f"  col {j}: {name}", flush=True)
    data = raw.iloc[h + 1:].reset_index(drop=True)
    low = [x.lower() for x in header]
    c_time = next((j for j, x in enumerate(low) if "time period" in x or x == "date"), 0)
    c_code = next(j for j, x in enumerate(low) if x.startswith("area code"))
    c_name = next((j for j, x in enumerate(low) if x.startswith("area name")), c_code + 1)
    cols = pick_columns(header)
    print(f"columns used: {cols}", flush=True)

    data["_time"] = pd.to_datetime(data[c_time], errors="coerce")
    data = data.dropna(subset=["_time"])
    london = data[data[c_code].astype(str).str.match(r"^(E09|E12000007)")]
    latest = london["_time"].max()
    rows = london[london["_time"] == latest]
    boroughs: dict[str, dict] = {}
    for _, r in rows.iterrows():
        entry: dict[str, object] = {"name": str(r[c_name]).strip()}
        for key, j in cols.items():
            v = pd.to_numeric(r[j], errors="coerce")
            if pd.notna(v) and v > 0:
                entry[key] = int(round(float(v)))
        boroughs[str(r[c_code]).strip()] = entry
    if not boroughs:
        raise SystemExit("No London rows found")
    out = {
        "period": latest.strftime("%B %Y"),
        "source": "ONS Price Index of Private Rents, average monthly rent by local authority and bedrooms",
        "url": url,
        "boroughs": boroughs,
    }
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "rents.json").write_text(json.dumps(out, indent=1))
    for code in ("E09000019", "E09000013", "E12000007"):
        print(f"{code}: {boroughs.get(code)}", flush=True)
    print(f"{len(boroughs)} London areas, {out['period']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
