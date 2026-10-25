"""Step 3: what is near each postcode, from OpenStreetMap (via the Overpass API).

For each postcode: nearest station, supermarket, café, Starbucks, gym, park and pharmacy (name and
metres), counts within 500 m, and how close the nearest main road is (busy vs quiet street).

Outputs
  data/processed/nearby.csv   one row per postcode
  data/processed/places.csv   the points of interest themselves (for the map)
"""

from __future__ import annotations

import math
import sys
import time

import numpy as np
import pandas as pd
import requests

from config import PROCESSED, USER_AGENT

OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]


def overpass(query: str) -> dict:
    for attempt in range(6):
        url = OVERPASS[attempt % len(OVERPASS)]
        try:
            response = requests.post(url, data={"data": query}, timeout=400,
                                     headers={"User-Agent": USER_AGENT})
            if response.status_code in (429, 504):
                time.sleep(20 * (attempt + 1))
                continue
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            print(f"overpass retry {attempt + 1}: {exc}", flush=True)
            time.sleep(15 * (attempt + 1))
    raise RuntimeError("Overpass failed")


def classify(tags: dict) -> str | None:
    name = (tags.get("name") or "") + " " + (tags.get("brand") or "")
    if tags.get("amenity") == "cafe":
        return "starbucks" if "starbucks" in name.lower() else "cafe"
    if tags.get("shop") == "supermarket":
        return "supermarket"
    if tags.get("leisure") in ("fitness_centre", "sports_centre"):
        return "gym"
    if tags.get("leisure") == "park":
        return "park"
    if tags.get("amenity") == "pharmacy":
        return "pharmacy"
    if tags.get("railway") == "station" or (tags.get("public_transport") == "station"
                                            and tags.get("railway") != "halt"):
        return "station"
    return None


def main() -> int:
    pc = pd.read_csv(PROCESSED / "postcodes.csv").dropna(subset=["lat", "lon"])
    s, w = pc["lat"].min() - 0.01, pc["lon"].min() - 0.015
    n, e = pc["lat"].max() + 0.01, pc["lon"].max() + 0.015
    bbox = f"{s:.4f},{w:.4f},{n:.4f},{e:.4f}"
    poi_query = f"""[out:json][timeout:300];
(
  nwr["amenity"~"^(cafe|pharmacy)$"]({bbox});
  nwr["shop"="supermarket"]({bbox});
  nwr["leisure"~"^(fitness_centre|sports_centre|park)$"]({bbox});
  nwr["railway"="station"]({bbox});
  nwr["public_transport"="station"]({bbox});
);
out center tags;"""
    data = overpass(poi_query)
    rows = []
    for el in data["elements"]:
        tags = el.get("tags", {})
        kind = classify(tags)
        if not kind:
            continue
        lat = el.get("lat") or (el.get("center") or {}).get("lat")
        lon = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat is None:
            continue
        rows.append({"kind": kind, "name": tags.get("name") or tags.get("brand") or kind.title(),
                     "lat": lat, "lon": lon})
    places = pd.DataFrame(rows).drop_duplicates(["kind", "name", "lat", "lon"])
    # Parks mapped as many small pieces: keep named parks and larger unnamed ones only once.
    print(places["kind"].value_counts().to_string(), flush=True)
    places.to_csv(PROCESSED / "places.csv", index=False)

    road_query = f"""[out:json][timeout:300];
way["highway"~"^(motorway|trunk|primary|secondary)$"]({bbox});
out geom tags;"""
    roads = overpass(road_query)
    segments = []
    for el in roads["elements"]:
        geom = el.get("geometry") or []
        level = el["tags"].get("highway")
        major = level in ("motorway", "trunk", "primary")
        for a, b in zip(geom, geom[1:]):
            segments.append((a["lat"], a["lon"], b["lat"], b["lon"], 1 if major else 0))
    seg = np.array(segments, dtype=float)
    print(f"{len(seg)} main-road segments", flush=True)

    lat0 = math.radians(pc["lat"].mean())
    kx, ky = 111_320 * math.cos(lat0), 111_320

    def xy(lat, lon):
        return np.asarray(lon) * kx, np.asarray(lat) * ky

    px, py = xy(pc["lat"].values, pc["lon"].values)
    out = pc[["postcode"]].copy()
    for kind in ("station", "supermarket", "cafe", "starbucks", "gym", "park", "pharmacy"):
        sub = places[places["kind"] == kind]
        if kind == "cafe":
            sub = places[places["kind"].isin(["cafe", "starbucks"])]
        if sub.empty:
            continue
        qx, qy = xy(sub["lat"].values, sub["lon"].values)
        d = np.sqrt((px[:, None] - qx[None, :]) ** 2 + (py[:, None] - qy[None, :]) ** 2)
        idx = d.argmin(axis=1)
        out[f"{kind}_m"] = d.min(axis=1).round().astype(int)
        out[f"{kind}_name"] = sub["name"].values[idx]
        out[f"{kind}_500m"] = (d <= 500).sum(axis=1)

    ax, ay = xy(seg[:, 0], seg[:, 1])
    bx, by = xy(seg[:, 2], seg[:, 3])
    major = seg[:, 4] == 1
    dist_major = np.empty(len(pc))
    dist_any = np.empty(len(pc))
    for i in range(len(pc)):
        vx, vy = bx - ax, by - ay
        wx, wy = px[i] - ax, py[i] - ay
        t = np.clip((wx * vx + wy * vy) / np.maximum(vx * vx + vy * vy, 1e-9), 0, 1)
        dd = np.hypot(ax + t * vx - px[i], ay + t * vy - py[i])
        dist_any[i] = dd.min()
        dist_major[i] = dd[major].min() if major.any() else 9999
    out["main_road_m"] = dist_major.round().astype(int)
    out["any_main_road_m"] = dist_any.round().astype(int)
    out["street_feel"] = np.where(dist_major < 40, "busy", np.where(dist_any < 40, "moderate", "quiet"))
    out.to_csv(PROCESSED / "nearby.csv", index=False)
    print(out["street_feel"].value_counts().to_string(), flush=True)
    print(out.describe().T[["mean", "50%"]].to_string(), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
