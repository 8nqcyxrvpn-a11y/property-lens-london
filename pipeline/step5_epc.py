"""Step 5: match each sale to its Energy Performance Certificate (floor area, rooms, energy rating).

Uses the GOV.UK "Get energy performance of buildings data" API with the EPC_API_TOKEN secret:
  search by postcode   /api/domestic/search?postcode=...
  certificate details  /api/certificate?certificate_number=...
A sale is matched when the certificate address contains the sale's flat and house number (and the
first word of the street, when there is one). The most recent certificate is used.

Resumable: caches are committed in data/processed, so a run that hits the time limit continues
where it stopped. Output: data/processed/epc_matched.csv
"""

from __future__ import annotations

import json
import os
import re
import sys
import time

import pandas as pd
import requests

from config import PROCESSED

BASE = "https://api.get-energy-performance-data.communities.gov.uk"
TOKEN = os.environ.get("EPC_API_TOKEN", "")
SEARCH_CACHE = PROCESSED / "epc_search_cache.json"
DETAIL_CACHE = PROCESSED / "epc_detail_cache.json"
TIME_LIMIT = float(os.environ.get("EPC_TIME_LIMIT_MIN", "95")) * 60
START = time.time()
SESSION = requests.Session()
SESSION.headers.update({"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"})


def get(path: str, params: dict) -> dict | None:
    for attempt in range(6):
        try:
            r = SESSION.get(BASE + path, params=params, timeout=60)
            if r.status_code == 404:
                return None
            if r.status_code == 429:
                time.sleep(10 * (attempt + 1))
                continue
            r.raise_for_status()
            time.sleep(0.12)
            return r.json()
        except requests.RequestException as exc:
            print(f"retry {attempt + 1}: {exc}", flush=True)
            time.sleep(3 * (attempt + 1))
    return None


def words(text: str) -> list[str]:
    return re.findall(r"[A-Z0-9]+", (text or "").upper())


def find_number(obj, pattern: re.Pattern) -> float | None:
    """Depth-first search for the first numeric value whose key matches the pattern."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if pattern.search(k) and isinstance(v, (int, float)) and not isinstance(v, bool):
                return float(v)
        for v in obj.values():
            hit = find_number(v, pattern)
            if hit is not None:
                return hit
    elif isinstance(obj, list):
        for v in obj:
            hit = find_number(v, pattern)
            if hit is not None:
                return hit
    return None


AREA = re.compile(r"^total_floor_area$|^totalFloorArea$", re.I)
AREA_FALLBACK = re.compile(r"floor_?area", re.I)
ROOMS = re.compile(r"habitable_room|habitableRoom", re.I)


def out_of_time() -> bool:
    return time.time() - START > TIME_LIMIT


def main() -> int:
    if not TOKEN:
        print("EPC_API_TOKEN is not set; skipping", flush=True)
        return 1
    sales = pd.read_csv(PROCESSED / "sales.csv", dtype=str)
    search = json.loads(SEARCH_CACHE.read_text()) if SEARCH_CACHE.exists() else {}
    detail = json.loads(DETAIL_CACHE.read_text()) if DETAIL_CACHE.exists() else {}

    todo = [pc for pc in sorted(sales["postcode"].unique()) if pc not in search]
    print(f"Postcodes: {len(search)} cached, {len(todo)} to search", flush=True)
    for n, pc in enumerate(todo, start=1):
        if out_of_time():
            break
        certs, page = [], 1
        while True:
            body = get("/api/domestic/search", {"postcode": pc, "page_size": 100, "page": page})
            if not body or not isinstance(body.get("data"), list):
                break
            for c in body["data"]:
                address = " ".join(x for x in [c.get("addressLine1"), c.get("addressLine2"), c.get("addressLine3")] if x)
                certs.append([c["certificateNumber"], address, c.get("registrationDate"), c.get("currentEnergyEfficiencyBand")])
            nxt = (body.get("pagination") or {}).get("nextPage")
            if not nxt or page >= 20:
                break
            page = nxt
        search[pc] = certs
        if n % 200 == 0:
            print(f"searched {n}/{len(todo)} postcodes", flush=True)
            SEARCH_CACHE.write_text(json.dumps(search, separators=(",", ":")))
    SEARCH_CACHE.write_text(json.dumps(search, separators=(",", ":")))

    # Match each sale to the most recent certificate for the same flat and house number.
    matches = {}
    for row in sales.itertuples():
        certs = search.get(row.postcode) or []
        need = words(row.saon if isinstance(row.saon, str) else "") + words(row.paon if isinstance(row.paon, str) else "")
        street = words(row.street if isinstance(row.street, str) else "")[:1]
        best = None
        for number, address, date, band in certs:
            aw = set(words(address))
            if not need or not all(w in aw for w in need):
                continue
            if street and street[0] not in aw and len(need) < 2:
                continue
            if best is None or (date or "") > (best[2] or ""):
                best = (number, address, date, band)
        if best:
            matches[row.transaction_id] = best
    print(f"Matched {len(matches)} of {len(sales)} sales to a certificate", flush=True)

    wanted = sorted({m[0] for m in matches.values()} - set(detail))
    print(f"Certificate details: {len(detail)} cached, {len(wanted)} to fetch", flush=True)
    shown = False
    for n, number in enumerate(wanted, start=1):
        if out_of_time():
            print("Stopping for the time limit; the next run continues from here", flush=True)
            break
        body = get("/api/certificate", {"certificate_number": number})
        data = (body or {}).get("data") or {}
        if data and not shown:
            print("Detail keys:", sorted(k for k in data.keys())[:80], flush=True)
            shown = True
        area = find_number(data, AREA) or find_number(data, AREA_FALLBACK)
        rooms = find_number(data, ROOMS)
        detail[number] = [area, rooms]
        if n % 500 == 0:
            print(f"details {n}/{len(wanted)}", flush=True)
            DETAIL_CACHE.write_text(json.dumps(detail, separators=(",", ":")))
    DETAIL_CACHE.write_text(json.dumps(detail, separators=(",", ":")))

    rows = []
    for tid, (number, _, _, band) in matches.items():
        area, rooms = (detail.get(number) or [None, None])
        if area and 10 <= area <= 1500:
            rows.append({"transaction_id": tid, "floor_area": round(area, 1),
                         "rooms": int(rooms) if rooms and 0 < rooms < 40 else None, "energy_band": band})
    out = pd.DataFrame(rows)
    out.to_csv(PROCESSED / "epc_matched.csv", index=False)
    print(f"Sales with floor area: {len(out)} of {len(sales)} ({len(out) / len(sales):.0%})", flush=True)
    if len(out):
        print(out[["floor_area", "rooms"]].describe().to_string(), flush=True)
    remaining = len(todo) and out_of_time()
    return 0 if not remaining else 0


if __name__ == "__main__":
    sys.exit(main())
